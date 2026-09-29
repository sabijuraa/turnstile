import { Keypair } from "@solana/web3.js";
import {
  bucketIndex,
  bytesToHex,
  type PaymentRequirements,
  receiptAddress,
  resourceId,
  type SettlementResponse,
  type SupportedResponse,
  type VerifyResponse,
} from "@turnstile/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import {
  addWallet,
  buildPayload,
  closePool,
  type Harness,
  harness,
  issue,
  jsonPost,
  MINT,
  RESOURCE,
  resetDb,
  testPool,
} from "./helpers.js";

let h: Harness;

beforeEach(async () => {
  await resetDb(await testPool());
  h = await harness();
});

afterAll(async () => {
  await closePool();
});

const nowUnix = (): bigint => BigInt(Math.floor(h.clock.now.getTime() / 1000));

async function verify(body: unknown): Promise<VerifyResponse> {
  const res = await h.app.request("/verify", jsonPost(body));
  expect(res.status).toBe(200);
  return (await res.json()) as VerifyResponse;
}

async function settle(body: unknown): Promise<SettlementResponse> {
  const res = await h.app.request("/settle", jsonPost(body));
  expect(res.status).toBe(200);
  return (await res.json()) as SettlementResponse;
}

describe("GET /supported", () => {
  it("lists the turnstile-policy scheme on the configured network and mint", async () => {
    const res = await h.app.request("/supported");
    expect(res.status).toBe(200);
    const body = (await res.json()) as SupportedResponse;
    expect(body.kinds).toHaveLength(1);
    expect(body.kinds[0]).toMatchObject({
      x402Version: 2,
      scheme: "turnstile-policy",
      network: "solana:localnet",
      extra: { asset: MINT.toBase58() },
    });
  });
});

describe("POST /requirements", () => {
  it("issues requirements with a fresh nonce, resource id and expiry", async () => {
    const agent = addWallet(h.chain);
    const a = await issue(h, agent, { resource: `${RESOURCE}/?lang=en` });
    const b = await issue(h, agent);
    expect(a.resource).toBe(RESOURCE);
    expect(a.amount).toBe("5000");
    expect(a.asset).toBe(MINT.toBase58());
    expect(a.payTo).toBe(agent.payTo.toBase58());
    expect(a.maxTimeoutSeconds).toBe(60);
    expect(a.mimeType).toBe("application/json");
    expect(a.extra.resourceId).toBe(bytesToHex(resourceId(RESOURCE)));
    expect(a.extra.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(a.extra.nonce).not.toBe(b.extra.nonce);
    expect(a.extra.expiresAt).toBe(String(Math.floor(h.clock.now.getTime() / 1000) + 60));
    expect(a.extra.displayAmount).toBe("0.005 tUSDC");
    expect(a.extra.facilitator).toBe("http://facilitator.test");
    const { rows } = await h.pool.query("SELECT resource_id, resource FROM resources");
    expect(rows).toEqual([{ resource_id: a.extra.resourceId, resource: RESOURCE }]);
  });

  it("accepts an amount in base units and a custom timeout", async () => {
    const agent = addWallet(h.chain);
    const r = await issue(h, agent, { price: undefined, amount: "1234", maxTimeoutSeconds: 30 });
    expect(r.amount).toBe("1234");
    expect(r.extra.displayAmount).toBe("0.001234 tUSDC");
    expect(r.maxTimeoutSeconds).toBe(30);
  });

  it("refuses a payTo that is not a public key", async () => {
    const res = await h.app.request(
      "/requirements",
      jsonPost({ resource: RESOURCE, price: "0.01", payTo: "not-a-key", description: "x" }),
    );
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("invalid_request");
    expect(body.error.message).toContain("payTo must be a base58 Solana address");
  });

  it("refuses a foreign asset, both amount and price, and too many decimals", async () => {
    const payTo = Keypair.generate().publicKey.toBase58();
    const base = { resource: RESOURCE, payTo, description: "x" };
    const foreign = await h.app.request(
      "/requirements",
      jsonPost({ ...base, price: "1", asset: Keypair.generate().publicKey.toBase58() }),
    );
    expect(foreign.status).toBe(400);
    expect(((await foreign.json()) as { error: { code: string } }).error.code).toBe(
      "unsupported_asset",
    );
    const both = await h.app.request(
      "/requirements",
      jsonPost({ ...base, price: "1", amount: "1" }),
    );
    expect(both.status).toBe(400);
    const precise = await h.app.request("/requirements", jsonPost({ ...base, price: "0.0000001" }));
    expect(precise.status).toBe(400);
    expect(((await precise.json()) as { error: { code: string } }).error.code).toBe(
      "invalid_price",
    );
    const zero = await h.app.request("/requirements", jsonPost({ ...base, amount: "0" }));
    expect(zero.status).toBe(400);
  });

  it("caps the body size and requires JSON", async () => {
    const big = await h.app.request(
      "/requirements",
      jsonPost({ resource: RESOURCE, description: "x".repeat(70 * 1024) }),
    );
    expect(big.status).toBe(413);
    const text = await h.app.request("/requirements", { method: "POST", body: "hello" });
    expect(text.status).toBe(415);
  });
});

describe("POST /verify", () => {
  it("accepts a correctly signed payment inside policy", async () => {
    const agent = addWallet(h.chain);
    const req = await issue(h, agent);
    const { payload } = buildPayload(req, agent);
    const res = await verify({ paymentPayload: payload, paymentRequirements: req });
    expect(res).toEqual({ isValid: true, payer: agent.wallet.toBase58() });
    expect(h.chain.simulations).toBe(1);
    expect(h.chain.submits).toBe(0);
  });

  it("refuses a malformed payload", async () => {
    const agent = addWallet(h.chain);
    const req = await issue(h, agent);
    const res = await verify({ paymentPayload: { hello: 1 }, paymentRequirements: req });
    expect(res.isValid).toBe(false);
    expect(res.invalidReason).toBe("invalid_payload");
    expect(res.invalidMessage).toMatch(/x402Version/);
  });

  it("refuses when the accepted terms differ from the server requirements", async () => {
    const agent = addWallet(h.chain);
    const req = await issue(h, agent);
    const { payload } = buildPayload(req, agent);
    const cheaper: PaymentRequirements = { ...req, amount: "1" };
    const res = await verify({
      paymentPayload: { ...payload, accepted: cheaper },
      paymentRequirements: req,
    });
    expect(res.invalidReason).toBe("requirements_mismatch");
  });

  it("refuses an authorization for a different amount than required", async () => {
    const agent = addWallet(h.chain);
    const req = await issue(h, agent);
    const { payload } = buildPayload(req, agent, { amount: 1n });
    const res = await verify({ paymentPayload: payload, paymentRequirements: req });
    expect(res.invalidReason).toBe("authorization_mismatch");
  });

  it("refuses requirements this facilitator did not issue", async () => {
    const agent = addWallet(h.chain);
    const req = await issue(h, agent);
    const foreign = { ...req, network: "solana:mainnet" };
    const { payload } = buildPayload(foreign, agent);
    const res = await verify({ paymentPayload: payload, paymentRequirements: foreign });
    expect(res.invalidReason).toBe("unsupported_requirements");
  });

  it("refuses an expired authorization", async () => {
    const agent = addWallet(h.chain);
    const req = await issue(h, agent);
    const { payload } = buildPayload(req, agent);
    h.clock.now = new Date(h.clock.now.getTime() + 61_000);
    const res = await verify({ paymentPayload: payload, paymentRequirements: req });
    expect(res.invalidReason).toBe("authorization_expired");
    expect(res.invalidMessage).toContain("Request the resource again");
  });

  it("refuses a signature from a key other than the named session key", async () => {
    const agent = addWallet(h.chain);
    const req = await issue(h, agent);
    const { payload } = buildPayload(req, agent);
    const forged = buildPayload(req, agent, { signer: Keypair.generate() });
    payload.payload.signature = forged.payload.payload.signature;
    const res = await verify({ paymentPayload: payload, paymentRequirements: req });
    expect(res.invalidReason).toBe("invalid_signature");
  });

  it("names the policy rule a payment breaks, before simulating", async () => {
    const cases: [string, Parameters<typeof addWallet>[1]][] = [
      ["PerCallCapExceeded", { perCallCap: 4_999n }],
      [
        "DailyCapExceeded",
        { dailyCap: 5_000n, spendBuckets: [{ index: bucketIndex(nowUnix()), amount: 1n }] },
      ],
      ["ResourceNotAllowed", { allowList: [] }],
      ["InsufficientFunds", { vaultBalance: 10n }],
    ];
    for (const [reason, policy] of cases) {
      const agent = addWallet(h.chain, policy);
      const req = await issue(h, agent);
      const { payload } = buildPayload(req, agent);
      const res = await verify({ paymentPayload: payload, paymentRequirements: req });
      expect(res.invalidReason, reason).toBe(reason);
      expect(res.invalidMessage).toBeTruthy();
    }
    const agent = addWallet(h.chain);
    const wallet = h.chain.wallets.get(agent.wallet.toBase58());
    if (!wallet?.policy.sessionKeys[0]) throw new Error("fixture missing");
    wallet.policy.sessionKeys[0].active = false;
    const req = await issue(h, agent);
    const res = await verify({
      paymentPayload: buildPayload(req, agent).payload,
      paymentRequirements: req,
    });
    expect(res.invalidReason).toBe("SessionKeyRevoked");
    expect(h.chain.simulations).toBe(0);
  });

  it("refuses an unknown wallet", async () => {
    const agent = addWallet(h.chain);
    h.chain.wallets.clear();
    const req = await issue(h, agent);
    const res = await verify({
      paymentPayload: buildPayload(req, agent).payload,
      paymentRequirements: req,
    });
    expect(res.invalidReason).toBe("wallet_not_found");
  });

  it("lets the program have the final word through simulation", async () => {
    const agent = addWallet(h.chain);
    h.chain.simulateHook = () => "DailyCapExceeded";
    const req = await issue(h, agent);
    const res = await verify({
      paymentPayload: buildPayload(req, agent).payload,
      paymentRequirements: req,
    });
    expect(res.invalidReason).toBe("DailyCapExceeded");
  });

  it("answers 503 when the chain is unreachable", async () => {
    const agent = addWallet(h.chain);
    const req = await issue(h, agent);
    h.chain.down = true;
    const res = await h.app.request(
      "/verify",
      jsonPost({ paymentPayload: buildPayload(req, agent).payload, paymentRequirements: req }),
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("chain_unavailable");
  });

  it("returns 400 when the requirements are malformed", async () => {
    const res = await h.app.request(
      "/verify",
      jsonPost({ paymentPayload: {}, paymentRequirements: { scheme: "exact" } }),
    );
    expect(res.status).toBe(400);
  });
});

describe("POST /settle", () => {
  it("settles once and returns the transaction and receipt", async () => {
    const agent = addWallet(h.chain);
    const req = await issue(h, agent);
    const { payload, auth } = buildPayload(req, agent);
    const res = await settle({ paymentPayload: payload, paymentRequirements: req });
    const [receipt] = receiptAddress(auth.agentWallet, auth.nonce);
    expect(res.success).toBe(true);
    expect(res.transaction).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64,88}$/);
    expect(res.receipt).toBe(receipt.toBase58());
    expect(res.payer).toBe(agent.wallet.toBase58());
    expect(res.network).toBe("solana:localnet");
    expect(res.alreadySettled).toBeUndefined();
    expect(h.chain.wallets.get(agent.wallet.toBase58())?.policy.vaultBalance).toBe(49_995_000n);
  });

  it("answers a repeat with the original receipt and no second debit", async () => {
    const agent = addWallet(h.chain);
    const req = await issue(h, agent);
    const { payload } = buildPayload(req, agent);
    const first = await settle({ paymentPayload: payload, paymentRequirements: req });
    // Even after the authorization expired, the replay resolves to the same settlement.
    h.clock.now = new Date(h.clock.now.getTime() + 3_600_000);
    const second = await settle({ paymentPayload: payload, paymentRequirements: req });
    expect(second).toMatchObject({
      success: true,
      alreadySettled: true,
      transaction: first.transaction,
      receipt: first.receipt,
    });
    expect(h.chain.submits).toBe(1);
    expect(h.chain.wallets.get(agent.wallet.toBase58())?.policy.vaultBalance).toBe(49_995_000n);
  });

  it("verify reports NonceAlreadyUsed for a settled payment", async () => {
    const agent = addWallet(h.chain);
    const req = await issue(h, agent);
    const { payload } = buildPayload(req, agent);
    await settle({ paymentPayload: payload, paymentRequirements: req });
    const res = await verify({ paymentPayload: payload, paymentRequirements: req });
    expect(res.invalidReason).toBe("NonceAlreadyUsed");
  });

  it("turns concurrent settles of one nonce into one debit and idempotent successes", async () => {
    const agent = addWallet(h.chain);
    const req = await issue(h, agent);
    const { payload } = buildPayload(req, agent);
    h.chain.submitDelayMs = 20;
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        settle({ paymentPayload: payload, paymentRequirements: req }),
      ),
    );
    expect(results.every((r) => r.success)).toBe(true);
    expect(new Set(results.map((r) => r.transaction)).size).toBe(1);
    expect(results.filter((r) => !r.alreadySettled)).toHaveLength(1);
    expect(h.chain.receipts.size).toBe(1);
    expect(h.chain.wallets.get(agent.wallet.toBase58())?.policy.vaultBalance).toBe(49_995_000n);
  });

  it("returns a policy rejection without queueing it", async () => {
    const agent = addWallet(h.chain, { perCallCap: 1n });
    const req = await issue(h, agent);
    const res = await settle({
      paymentPayload: buildPayload(req, agent).payload,
      paymentRequirements: req,
    });
    expect(res).toMatchObject({
      success: false,
      errorReason: "PerCallCapExceeded",
      transaction: "",
      payer: agent.wallet.toBase58(),
    });
    expect(res.errorMessage).toContain("per-call cap");
    const { rows } = await h.pool.query("SELECT count(*)::int AS n FROM settlement_dead_letters");
    expect(rows[0].n).toBe(0);
    expect(h.chain.submits).toBe(0);
  });

  it("returns a program rejection from the send by name", async () => {
    const agent = addWallet(h.chain);
    h.chain.submitHook = () => ({
      ok: false,
      kind: "rejected",
      reason: "SessionKeyExpired",
      detail: "custom program error 6002",
    });
    const req = await issue(h, agent);
    const res = await settle({
      paymentPayload: buildPayload(req, agent).payload,
      paymentRequirements: req,
    });
    expect(res.errorReason).toBe("SessionKeyExpired");
  });

  it("writes an unknown outcome to the dead letters and counts attempts", async () => {
    const agent = addWallet(h.chain);
    h.chain.submitHook = () => ({ ok: false, kind: "unknown", detail: "fetch failed" });
    const req = await issue(h, agent);
    const { payload, auth } = buildPayload(req, agent);
    const body = { paymentPayload: payload, paymentRequirements: req };
    const first = await settle(body);
    expect(first).toMatchObject({ success: false, errorReason: "settlement_failed" });
    await settle(body);
    const { rows } = await h.pool.query(
      "SELECT agent_wallet, nonce, attempts, status, error, payload, requirements FROM settlement_dead_letters",
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      agent_wallet: agent.wallet.toBase58(),
      nonce: bytesToHex(auth.nonce),
      attempts: 2,
      status: "pending",
      error: "fetch failed",
      payload,
      requirements: req,
    });
    const metrics = await h.metrics.registry.metrics();
    expect(metrics).toContain('turnstile_facilitator_dead_letters_total{stage="settle"} 2');
    expect(metrics).toContain('turnstile_facilitator_settlements_total{outcome="dead_lettered"} 2');
  });

  it("treats a timed out send that landed as settled", async () => {
    const agent = addWallet(h.chain);
    h.chain.submitHook = (auth) => ({
      ok: false,
      kind: "unknown",
      detail: "confirmation timed out",
      signature: h.chain.land(auth),
    });
    const req = await issue(h, agent);
    const res = await settle({
      paymentPayload: buildPayload(req, agent).payload,
      paymentRequirements: req,
    });
    expect(res.success).toBe(true);
    expect(res.alreadySettled).toBe(true);
    expect(res.transaction.length).toBeGreaterThan(60);
    const { rows } = await h.pool.query("SELECT count(*)::int AS n FROM settlement_dead_letters");
    expect(rows[0].n).toBe(0);
  });

  it("refuses a forged signature even for a settled nonce", async () => {
    const agent = addWallet(h.chain);
    const req = await issue(h, agent);
    const { payload } = buildPayload(req, agent);
    await settle({ paymentPayload: payload, paymentRequirements: req });
    const forged = buildPayload(req, agent, { signer: Keypair.generate() });
    payload.payload.signature = forged.payload.payload.signature;
    const res = await settle({ paymentPayload: payload, paymentRequirements: req });
    expect(res).toMatchObject({ success: false, errorReason: "invalid_signature" });
  });
});

describe("health and metrics", () => {
  it("reports ready, and unavailable when the chain is down", async () => {
    const ok = await h.app.request("/readyz");
    expect(ok.status).toBe(200);
    expect(await ok.json()).toMatchObject({
      status: "ready",
      feePayer: h.chain.feePayer.toBase58(),
    });
    h.chain.down = true;
    const down = await h.app.request("/readyz");
    expect(down.status).toBe(503);
    expect(await down.json()).toMatchObject({ status: "unavailable", failed: ["solana"] });
    expect((await h.app.request("/healthz")).status).toBe(200);
  });

  it("counts requests by route and verify results by reason", async () => {
    const agent = addWallet(h.chain, { allowList: [] });
    const req = await issue(h, agent);
    await verify({ paymentPayload: buildPayload(req, agent).payload, paymentRequirements: req });
    const text = await (await h.app.request("/metrics")).text();
    expect(text).toContain(
      'turnstile_facilitator_http_requests_total{method="POST",route="/requirements",status="200"} 1',
    );
    expect(text).toContain(
      'turnstile_facilitator_verify_results_total{result="ResourceNotAllowed"} 1',
    );
  });

  it("answers unknown paths with a JSON 404", async () => {
    const res = await h.app.request("/nope");
    expect(res.status).toBe(404);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_found");
  });
});
