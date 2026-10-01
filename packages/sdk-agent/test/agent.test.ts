import { createHash } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  canonicalResource,
  decodeHeader,
  type PaymentPayload,
  type PolicyState,
  resourceId,
  SETTLEMENT_PROGRAM_ID,
} from "@turnstile/shared";
import bs58 from "bs58";
import { afterEach, describe, expect, it, vi } from "vitest";

// The chain reader is covered by the integration test against a real validator.
vi.mock("../src/chain.js", () => ({
  chainWalletStateSource: () => ({
    load: () => Promise.reject(new Error("unit tests pass their own state source")),
  }),
}));

import {
  createAgent,
  type PaymentEvent,
  PaymentRejectedError,
  PaymentRequirementsError,
  PolicyRefusedError,
  type WalletSnapshot,
} from "../src/index.js";
import { type FakeServer, type FakeServerOptions, startFakeServer } from "./fake-server.js";

const PRICE = 5_000n;
const mint = Keypair.generate().publicKey;
const payTo = Keypair.generate().publicKey;
const walletAddress = Keypair.generate().publicKey;
const session = Keypair.generate();

let server: FakeServer | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

function policy(overrides: Partial<PolicyState> = {}, allowed: string[] = []): PolicyState {
  return {
    perCallCap: 10_000n,
    dailyCap: 30_000n,
    sessionKeys: [{ key: session.publicKey, expiresAt: 0n, active: true }],
    allowList: allowed.map((r) => ({ resourceId: resourceId(r), recipient: payTo })),
    spendBuckets: [],
    ...overrides,
  };
}

function snapshot(p: PolicyState, vaultBalance = 100_000n): WalletSnapshot {
  return {
    address: walletAddress,
    owner: Keypair.generate().publicKey,
    mint,
    vault: Keypair.generate().publicKey,
    policy: { ...p, vaultBalance },
  };
}

async function setup(
  opts: Partial<FakeServerOptions> = {},
  makePolicy: (paid: string) => PolicyState = (paid) => policy({}, [paid]),
  agentOpts: Partial<Parameters<typeof createAgent>[0]> = {},
) {
  server = await startFakeServer({ mint, payTo, price: PRICE, ...opts });
  const paid = canonicalResource(`${server.url}/v1/summarize`);
  const loads = { count: 0 };
  const events: PaymentEvent[] = [];
  const agent = createAgent({
    agentWallet: walletAddress,
    sessionKey: session.secretKey,
    stateSource: {
      load: async () => {
        loads.count++;
        return snapshot(makePolicy(paid));
      },
    },
    policyTtlMs: 60_000,
    onPayment: (e) => events.push(e),
    ...agentOpts,
  });
  return { agent, paid, loads, events, srv: server };
}

/** Builds the 260 signed bytes by hand, independent of the shared encoder. */
function expectedMessage(p: PaymentPayload): Buffer {
  const a = p.payload.authorization;
  const u64 = Buffer.alloc(8);
  u64.writeBigUInt64LE(BigInt(a.amount));
  const i64 = Buffer.alloc(8);
  i64.writeBigInt64LE(BigInt(a.expiresAt));
  return Buffer.concat([
    Buffer.from("TURNSTILE_PAYMENT_V1", "ascii"),
    SETTLEMENT_PROGRAM_ID.toBuffer(),
    new PublicKey(a.agentWallet).toBuffer(),
    new PublicKey(a.sessionKey).toBuffer(),
    new PublicKey(a.recipient).toBuffer(),
    new PublicKey(a.mint).toBuffer(),
    u64,
    Buffer.from(a.resourceId, "hex"),
    Buffer.from(a.nonce, "hex"),
    i64,
  ]);
}

describe("agent.fetch paying a 402", () => {
  it("signs the exact authorization, retries once and surfaces the payment", async () => {
    const { agent, paid, events, srv } = await setup();
    const res = await agent.fetch(`${srv.url}/v1/summarize`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-trace": "abc" },
      body: JSON.stringify({ text: "hello" }),
    });
    expect(res.status).toBe(200);
    expect(srv.requests).toHaveLength(2);
    const [first, second] = srv.requests;
    expect(first?.headers["payment-signature"]).toBeUndefined();
    expect(second?.headers["x-trace"]).toBe("abc");
    expect(second?.body).toBe(JSON.stringify({ text: "hello" }));

    const payload = decodeHeader<PaymentPayload>(String(second?.headers["payment-signature"]));
    const a = payload.payload.authorization;
    expect(a).toMatchObject({
      agentWallet: walletAddress.toBase58(),
      sessionKey: session.publicKey.toBase58(),
      recipient: payTo.toBase58(),
      mint: mint.toBase58(),
      amount: "5000",
      resourceId: createHash("sha256").update(`turnstile:resource:${paid}`).digest("hex"),
      nonce: payload.accepted.extra.nonce,
      expiresAt: payload.accepted.extra.expiresAt,
    });
    const message = expectedMessage(payload);
    expect(message.length).toBe(260);
    expect(
      ed25519.verify(bs58.decode(payload.payload.signature), message, session.publicKey.toBytes()),
    ).toBe(true);
    expect(srv.verified).toHaveLength(1);

    expect(res.payment).toMatchObject({
      amount: "5000",
      resource: paid,
      network: "solana:localnet",
    });
    expect(res.payment?.receipt).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/);
    expect(await res.json()).toEqual({
      echo: JSON.stringify({ text: "hello" }),
      contentType: "application/json",
    });
    expect(events.map((e) => e.type)).toEqual(["settled"]);
  });

  it("reads requirements from the body when the header is absent", async () => {
    const { agent, srv } = await setup({ bodyOnly: true });
    const res = await agent.fetch(
      new Request(`${srv.url}/v1/summarize`, { method: "POST", body: "x" }),
    );
    expect(res.status).toBe(200);
    expect(res.payment?.amount).toBe("5000");
    expect(srv.requests).toHaveLength(2);
  });

  it("passes a response that is not a 402 straight through", async () => {
    const { agent, srv, loads } = await setup();
    const res = await agent.fetch(`${srv.url}/free`);
    expect(await res.json()).toEqual({ free: true });
    expect(res.payment).toBeUndefined();
    expect(loads.count).toBe(0);
  });
});

describe("refusal before signing", () => {
  it("refuses a price above the per-call cap and sends nothing", async () => {
    const { agent, srv, events } = await setup({}, (paid) =>
      policy({ perCallCap: 4_000n }, [paid]),
    );
    const err = await agent.fetch(`${srv.url}/v1/summarize`, { method: "POST" }).catch((e) => e);
    expect(err).toBeInstanceOf(PolicyRefusedError);
    expect(err).toMatchObject({ reason: "PerCallCapExceeded", amount: 5_000n });
    expect(srv.requests).toHaveLength(1);
    expect(srv.verified).toHaveLength(0);
    expect(events).toEqual([
      expect.objectContaining({ type: "refused", reason: "PerCallCapExceeded" }),
    ]);
  });

  it("refuses a resource that is not on the allow-list", async () => {
    const { agent, srv } = await setup({}, () => policy({}, ["https://other.example/v1/x"]));
    const err = await agent.fetch(`${srv.url}/v1/summarize`).catch((e) => e);
    expect(err).toMatchObject({ name: "PolicyRefusedError", reason: "ResourceNotAllowed" });
    expect(srv.requests).toHaveLength(1);
  });

  it("refuses a revoked session key", async () => {
    const { agent, srv } = await setup({}, (paid) =>
      policy({ sessionKeys: [{ key: session.publicKey, expiresAt: 0n, active: false }] }, [paid]),
    );
    const err = await agent.fetch(`${srv.url}/v1/summarize`).catch((e) => e);
    expect(err).toMatchObject({ reason: "SessionKeyRevoked" });
    expect(srv.requests).toHaveLength(1);
  });

  it("counts its own settled payments toward the daily cap between chain reads", async () => {
    const { agent, srv, loads } = await setup({}, (paid) => policy({ dailyCap: 15_000n }, [paid]));
    for (let i = 0; i < 3; i++) {
      const res = await agent.fetch(`${srv.url}/v1/summarize`, { method: "POST" });
      expect(res.status).toBe(200);
    }
    const err = await agent.fetch(`${srv.url}/v1/summarize`, { method: "POST" }).catch((e) => e);
    expect(err).toMatchObject({ reason: "DailyCapExceeded" });
    expect(err.message).toContain("above the daily cap of 15000");
    // Three paid calls of two requests each, then one unpaid 402 that was refused.
    expect(srv.requests).toHaveLength(7);
    expect(srv.verified).toHaveLength(3);
    expect(loads.count).toBe(1);
  });

  it("applies the local maxPerCall even with the chain policy check off", async () => {
    const { agent, srv } = await setup({}, (paid) => policy({}, [paid]), {
      maxPerCall: "0.004",
      localPolicyCheck: false,
    });
    const err = await agent.fetch(`${srv.url}/v1/summarize`).catch((e) => e);
    expect(err).toMatchObject({ reason: "LocalCapExceeded" });
    expect(err.message).toContain("0.005");
    expect(srv.requests).toHaveLength(1);
  });

  it("refuses requirements that expired before signing", async () => {
    const { agent, srv } = await setup({
      tamper: (r) => ({
        ...r,
        extra: { ...r.extra, expiresAt: String(Math.floor(Date.now() / 1000) - 1) },
      }),
    });
    const err = await agent.fetch(`${srv.url}/v1/summarize`).catch((e) => e);
    expect(err).toMatchObject({ reason: "AuthorizationExpired" });
    expect(srv.requests).toHaveLength(1);
  });

  it("refuses requirements that ask for a signature valid longer than 300 seconds by default", async () => {
    const { agent, events, srv } = await setup({
      tamper: (r) => ({
        ...r,
        extra: { ...r.extra, expiresAt: String(Math.floor(Date.now() / 1000) + 3600) },
      }),
    });
    const err = await agent.fetch(`${srv.url}/v1/summarize`).catch((e) => e);
    expect(err).toBeInstanceOf(PolicyRefusedError);
    expect(err).toMatchObject({ reason: "AuthorizationTtlTooLong", code: "policy_refused" });
    expect(err.message).toContain("at most 300 seconds");
    expect(events).toEqual([expect.objectContaining({ type: "refused", reason: "AuthorizationTtlTooLong" })]);
    // Nothing was signed, so the server saw only the unpaid request.
    expect(srv.requests).toHaveLength(1);
    expect(srv.verified).toHaveLength(0);
  });

  it("signs an expiry exactly at maxAuthorizationTtlSeconds and refuses one second more", async () => {
    const fixedNow = 1_800_000_000_000;
    const nowUnix = fixedNow / 1000;
    let ahead = 120;
    const { agent, srv } = await setup(
      {
        tamper: (r) => ({ ...r, extra: { ...r.extra, expiresAt: String(nowUnix + ahead) } }),
      },
      (paid) => policy({}, [paid]),
      { maxAuthorizationTtlSeconds: 120, now: () => fixedNow },
    );
    const ok = await agent.fetch(`${srv.url}/v1/summarize`);
    expect(ok.status).toBe(200);
    expect(srv.verified).toHaveLength(1);

    ahead = 121;
    const err = await agent.fetch(`${srv.url}/v1/summarize`).catch((e) => e);
    expect(err).toMatchObject({ reason: "AuthorizationTtlTooLong" });
    expect(err.message).toContain("valid for 121 seconds");
    expect(srv.verified).toHaveLength(1);
  });

  it("rejects a maxAuthorizationTtlSeconds that is not a positive whole number", () => {
    for (const bad of [0, -5, 1.5, Number.NaN]) {
      expect(() =>
        createAgent({
          agentWallet: walletAddress,
          sessionKey: session.secretKey,
          stateSource: { load: async () => snapshot(policy()) },
          maxAuthorizationTtlSeconds: bad,
        }),
      ).toThrow(/maxAuthorizationTtlSeconds must be a positive whole number/);
    }
  });
});

describe("hostile or unusable requirements", () => {
  it("refuses a resource id that is not the hash of the resource", async () => {
    const other = Buffer.from(resourceId("https://other.example/v1/x")).toString("hex");
    const { agent, srv } = await setup({
      tamper: (r) => ({ ...r, extra: { ...r.extra, resourceId: other } }),
    });
    const err = await agent.fetch(`${srv.url}/v1/summarize`).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentRequirementsError);
    expect(err.reason).toBe("resource_id_mismatch");
    expect(srv.requests).toHaveLength(1);
  });

  it("refuses a requirement for another settlement program", async () => {
    const { agent, srv } = await setup({
      tamper: (r) => ({
        ...r,
        extra: { ...r.extra, settlementProgram: Keypair.generate().publicKey.toBase58() },
      }),
    });
    const err = await agent.fetch(`${srv.url}/v1/summarize`).catch((e) => e);
    expect(err).toMatchObject({ reason: "untrusted_program" });
    expect(srv.requests).toHaveLength(1);
  });

  it("refuses a requirement in another mint", async () => {
    const { agent, srv } = await setup({
      tamper: (r) => ({ ...r, asset: Keypair.generate().publicKey.toBase58() }),
    });
    const err = await agent.fetch(`${srv.url}/v1/summarize`).catch((e) => e);
    expect(err).toMatchObject({ reason: "no_matching_requirement" });
    expect(srv.requests).toHaveLength(1);
  });

  it("reports a 402 with no requirements at all", async () => {
    const fetchImpl: typeof fetch = async () => new Response("nope", { status: 402 });
    const agent = createAgent({
      agentWallet: walletAddress,
      sessionKey: session,
      fetch: fetchImpl,
      stateSource: { load: async () => snapshot(policy()) },
    });
    const err = await agent.fetch("http://127.0.0.1:9/v1/x").catch((e) => e);
    expect(err).toMatchObject({ name: "PaymentRequirementsError", reason: "missing_requirements" });
  });
});

describe("rejection after signing", () => {
  it("throws PaymentRejectedError with the reason and the signed payload", async () => {
    const { agent, srv, events, loads } = await setup(
      { mode: "reject", rejectReason: "DailyCapExceeded" },
      (paid) => policy({}, [paid]),
      { localPolicyCheck: false },
    );
    const err = await agent.fetch(`${srv.url}/v1/summarize`, { method: "POST" }).catch((e) => e);
    expect(err).toBeInstanceOf(PaymentRejectedError);
    expect(err).toMatchObject({
      reason: "DailyCapExceeded",
      status: 402,
      message: "The facilitator refused the payment with DailyCapExceeded.",
    });
    expect(err.authorization.amount).toBe(5_000n);
    expect(srv.verified[0]?.payload).toEqual(err.paymentPayload);
    expect(srv.requests).toHaveLength(2);
    expect(events.map((e) => e.type)).toEqual(["rejected"]);
    // A rejection drops the cached wallet so the next call reads the chain again.
    await agent.fetch(`${srv.url}/v1/summarize`).catch(() => undefined);
    expect(loads.count).toBe(2);
  });
});

describe("createAgent options", () => {
  it("rejects a malformed secret key", () => {
    expect(() =>
      createAgent({
        agentWallet: walletAddress,
        sessionKey: new Uint8Array(10),
        stateSource: { load: async () => snapshot(policy()) },
      }),
    ).toThrow(/64 byte/);
  });

  it("needs a chain reader when no state source is given", () => {
    expect(() => createAgent({ agentWallet: walletAddress, sessionKey: session })).toThrow(
      /rpcUrl or connection/,
    );
  });

  it("rejects a malformed maxPerCall", () => {
    expect(() =>
      createAgent({
        agentWallet: walletAddress,
        sessionKey: session,
        maxPerCall: "0.0000001",
        stateSource: { load: async () => snapshot(policy()) },
      }),
    ).toThrow(/maxPerCall/);
  });
});
