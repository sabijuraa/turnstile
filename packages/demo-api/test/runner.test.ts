import { Keypair, type PublicKey } from "@solana/web3.js";
import {
  type Agent,
  type PaidResponse,
  PaymentRejectedError,
  type WalletSnapshot,
} from "@turnstile/sdk-agent";
import {
  authorizationToWire,
  hexToBytes,
  type PaymentAuthorization,
  randomNonce,
  signAuthorization,
} from "@turnstile/shared";
import { createPool, migrate, type Pool } from "@turnstile/shared/db";
import bs58 from "bs58";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { buildCatalog } from "../src/catalog.js";
import { createLogger } from "../src/logger.js";
import { createRunnerMetrics } from "../src/metrics.js";
import { createRunnerApp } from "../src/runner/app.js";
import type {
  CreateWalletParams,
  DemoChain,
  DirectSettlement,
  WalletReading,
} from "../src/runner/demo-chain.js";
import { DemoRunError } from "../src/runner/demo-chain.js";
import type { RunEvent } from "../src/runner/events.js";
import { DemoRunner } from "../src/runner/run.js";
import { RunStore } from "../src/runner/store.js";
import { summarize } from "../src/text/summarize.js";

const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://turnstile_demo_test:turnstile_demo_test@127.0.0.1:5432/turnstile_demo_test";

const owner = Keypair.generate();
const session = Keypair.generate();
const mint = Keypair.generate().publicKey;
const recipient = Keypair.generate().publicKey;
const catalog = buildCatalog({
  publicUrl: "http://127.0.0.1:4021",
  network: "solana:localnet",
  asset: mint.toBase58(),
  assetDecimals: 6,
  payTo: recipient.toBase58(),
  facilitatorUrl: "http://127.0.0.1:4020",
  price: "0.005",
  priceBaseUnits: 5000n,
});

/** A chain that keeps the policy in memory and enforces the daily cap like the program. */
class FakeChain implements DemoChain {
  created: CreateWalletParams[] = [];
  direct: PaymentAuthorization[] = [];
  withdrawals = 0;
  spent = 0n;
  vault = 0n;
  dailyCap = 0n;
  ownerFunds = 1_000_000n;
  enforce = true;
  wallet: PublicKey = Keypair.generate().publicKey;

  async checkOwnerFunds(required: bigint): Promise<void> {
    if (this.ownerFunds < required) {
      throw new DemoRunError("owner_underfunded", "The demo owner holds too little tUSDC.");
    }
  }
  async nextWalletId(hint: bigint): Promise<bigint> {
    return hint;
  }
  async createWallet(p: CreateWalletParams) {
    this.created.push(p);
    this.vault = p.funding;
    this.dailyCap = p.dailyCap;
    this.spent = 0n;
    this.wallet = Keypair.generate().publicKey;
    return {
      agentWallet: this.wallet,
      walletId: p.id,
      vault: Keypair.generate().publicKey,
      signature: "setup-sig",
    };
  }
  async readWallet(): Promise<WalletReading> {
    return { rollingSpend: this.spent, dailyCap: this.dailyCap, vaultBalance: this.vault };
  }
  async settleDirect(auth: PaymentAuthorization): Promise<DirectSettlement> {
    this.direct.push(auth);
    if (!this.enforce) return { refused: false, signature: "oops-sig" };
    return {
      refused: true,
      signature: "failed-sig",
      errorName: "DailyCapExceeded",
      logs: ["Program log: AnchorError occurred. Error Code: DailyCapExceeded."],
    };
  }
  async withdrawAll() {
    this.withdrawals++;
    const amount = this.vault;
    this.vault = 0n;
    return { amount, signature: "withdraw-sig" };
  }
}

/** An agent that pays until the fake chain's daily cap would be crossed, then gets a 402. */
function fakeAgentFactory(chain: FakeChain, gate?: () => Promise<void>) {
  return (agentWallet: PublicKey): Agent => ({
    agentWallet,
    sessionPublicKey: session.publicKey,
    wallet: async () => ({}) as WalletSnapshot,
    async fetch(input, init): Promise<PaidResponse> {
      await gate?.();
      const body = JSON.parse(String(init?.body)) as { text: string; sentences: number };
      const route = catalog.routes[0];
      if (!route) throw new Error("catalog has no routes");
      const auth: PaymentAuthorization = {
        agentWallet,
        sessionKey: session.publicKey,
        recipient,
        mint,
        amount: 5000n,
        resourceId: hexToBytes(route.resourceId),
        nonce: randomNonce(),
        expiresAt: BigInt(Math.floor(Date.now() / 1000) + 60),
      };
      if (chain.spent + auth.amount > chain.dailyCap) {
        const sig = signAuthorization(auth, session.secretKey);
        throw new PaymentRejectedError("DailyCapExceeded", "refused", 402, auth, sig, {
          x402Version: 2,
          resource: String(input),
          accepted: {} as never,
          payload: { authorization: authorizationToWire(auth), signature: bs58.encode(sig) },
        });
      }
      chain.spent += auth.amount;
      chain.vault -= auth.amount;
      const res = new Response(
        JSON.stringify(summarize(body.text, { sentences: body.sentences })),
        {
          status: 200,
          headers: { "content-type": "application/json" },
        },
      );
      Object.defineProperty(res, "payment", {
        value: {
          receipt: Keypair.generate().publicKey.toBase58(),
          transaction: `tx-${chain.spent}`,
          amount: "5000",
          resource: route.resource,
          network: "solana:localnet",
          payer: agentWallet.toBase58(),
          nonce: "00",
          alreadySettled: false,
        },
      });
      return res as PaidResponse;
    },
  });
}

let pool: Pool;
beforeAll(async () => {
  pool = createPool(TEST_DATABASE_URL, 5);
  await migrate(pool);
});
afterAll(async () => {
  await pool.end();
});
beforeEach(async () => {
  await pool.query("TRUNCATE demo_runs CASCADE");
});

function harness(opts: { gate?: () => Promise<void>; keepaliveMs?: number } = {}) {
  const chain = new FakeChain();
  const store = new RunStore(pool);
  const logger = createLogger("silent", "demo-agent");
  const metrics = createRunnerMetrics(false);
  const runner = new DemoRunner({
    store,
    chain,
    logger,
    metrics,
    owner: owner.publicKey,
    sessionKey: session.publicKey,
    mint,
    mintDecimals: 6,
    network: "solana:localnet",
    loadCatalog: async () => catalog,
    makeAgent: fakeAgentFactory(chain, opts.gate),
    demoApiUrl: "http://127.0.0.1:4021",
  });
  const app = createRunnerApp({
    runner,
    store,
    logger,
    metrics,
    webOrigins: ["http://localhost:3000"],
    readiness: { database: () => pool.query("SELECT 1") },
    keepaliveMs: opts.keepaliveMs ?? 15_000,
  });
  return { chain, store, runner, app, metrics };
}

/** Reads a whole SSE response into events. */
async function readSse(res: Response): Promise<RunEvent[]> {
  const text = await res.text();
  return text
    .split("\n\n")
    .map((block) => block.split("\n").find((l) => l.startsWith("data: ")))
    .filter((l): l is string => l !== undefined)
    .map((l) => JSON.parse(l.slice(6)) as RunEvent);
}

describe("demo runner", () => {
  it("runs six paid calls, proves the seventh refusal on chain and withdraws", async () => {
    const { app, runner, chain } = harness();
    const start = await app.request("/runs", { method: "POST" });
    expect(start.status).toBe(202);
    const { runId } = (await start.json()) as { runId: string };

    const busy = await app.request("/runs", { method: "POST" });
    expect(busy.status).toBe(409);
    expect(await busy.json()).toMatchObject({ error: { code: "run_in_progress" }, runId });

    await runner.idle();
    const latest = await app.request("/runs/latest");
    const { run, events } = (await latest.json()) as {
      run: { id: string; status: string };
      events: RunEvent[];
    };
    expect(run).toMatchObject({ id: runId, status: "finished" });
    expect(events.map((e) => e.type)).toEqual([
      "run.started",
      ...Array(6).fill("call.settled"),
      "call.refused",
      "run.finished",
    ]);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);

    const created = chain.created[0];
    expect(created).toMatchObject({ perCallCap: 10_000n, dailyCap: 30_000n, funding: 100_000n });
    expect(created?.sessionKey.equals(session.publicKey)).toBe(true);
    expect(created?.allowList).toHaveLength(2);
    expect(created?.allowList.every((e) => e.recipient.equals(recipient))).toBe(true);

    const settled = events.filter((e) => e.type === "call.settled") as RunEvent<"call.settled">[];
    expect(settled.map((e) => e.data.rollingSpend.display)).toEqual([
      "0.005",
      "0.01",
      "0.015",
      "0.02",
      "0.025",
      "0.03",
    ]);
    expect(settled[0]?.data.summaryExcerpt.length).toBeGreaterThan(20);

    const refused = events[7] as RunEvent<"call.refused">;
    expect(refused.data).toMatchObject({
      index: 7,
      reason: "DailyCapExceeded",
      facilitatorReason: "DailyCapExceeded",
      failedTransaction: "failed-sig",
      amount: { baseUnits: "5000", display: "0.005" },
    });
    expect(chain.direct).toHaveLength(1);

    const finished = events[8] as RunEvent<"run.finished">;
    expect(finished.data).toMatchObject({
      settledCalls: 6,
      refusedCalls: 1,
      totalSpent: { display: "0.03" },
      withdrawn: { display: "0.07" },
      withdrawTransaction: "withdraw-sig",
    });
    expect(finished.data.receipts).toHaveLength(6);
    expect(chain.withdrawals).toBe(1);
  });

  it("streams events live over SSE and ends the stream after the last one", async () => {
    let release: () => void = () => undefined;
    const opened = new Promise<void>((r) => {
      release = r;
    });
    const { app, runner } = harness({ gate: () => opened });
    const { runId } = (await (await app.request("/runs", { method: "POST" })).json()) as {
      runId: string;
    };
    const stream = await app.request(`/runs/${runId}/events`);
    expect(stream.headers.get("content-type")).toContain("text/event-stream");
    release();
    const events = await readSse(stream);
    expect(events[0]?.type).toBe("run.started");
    expect(events.at(-1)?.type).toBe("run.finished");
    expect(events).toHaveLength(9);
    await runner.idle();

    // Resuming with Last-Event-ID sends only what came after.
    const resumed = await readSse(
      await app.request(`/runs/${runId}/events`, { headers: { "Last-Event-ID": "7" } }),
    );
    expect(resumed.map((e) => e.seq)).toEqual([8, 9]);
  });

  it("reports an underfunded owner as a failed run without creating a wallet", async () => {
    const { app, runner, chain } = harness();
    chain.ownerFunds = 10n;
    await app.request("/runs", { method: "POST" });
    await runner.idle();
    const { run, events } = (await (await app.request("/runs/latest")).json()) as {
      run: { status: string };
      events: RunEvent[];
    };
    expect(run.status).toBe("failed");
    expect(events).toHaveLength(1);
    expect(events[0]).toMatchObject({ type: "run.failed", data: { reason: "owner_underfunded" } });
    expect(chain.created).toHaveLength(0);
  });

  it("fails loudly when the chain accepts a payment the facilitator refused", async () => {
    const { app, runner, chain } = harness();
    chain.enforce = false;
    await app.request("/runs", { method: "POST" });
    await runner.idle();
    const { events } = (await (await app.request("/runs/latest")).json()) as { events: RunEvent[] };
    expect(events.at(-1)).toMatchObject({
      type: "run.failed",
      data: { reason: "limit_not_enforced", withdrawTransaction: "withdraw-sig" },
    });
  });

  it("marks a run left running by a previous process as interrupted", async () => {
    const { runner, store, app } = harness();
    const stale = await store.createRun(
      "00000000-0000-4000-8000-000000000001",
      "x",
      "solana:localnet",
    );
    const recovered = await runner.recoverInterrupted();
    expect(recovered?.id).toBe(stale.id);
    const body = (await (await app.request(`/runs/${stale.id}`)).json()) as {
      run: { status: string };
      events: RunEvent[];
    };
    expect(body.run.status).toBe("failed");
    expect(body.events[0]).toMatchObject({ type: "run.failed", data: { reason: "interrupted" } });
  });

  it("serves the policy, CORS for the web origin and clear 404s", async () => {
    const { app } = harness();
    const policy = await app.request("/policy", { headers: { Origin: "http://localhost:3000" } });
    expect(policy.headers.get("access-control-allow-origin")).toBe("http://localhost:3000");
    expect(await policy.json()).toMatchObject({
      perCallCap: { display: "0.01" },
      dailyCap: { display: "0.03" },
      funding: { display: "0.1" },
      pricePerCall: { display: "0.005" },
      allowList: [
        { resource: "http://127.0.0.1:4021/v1/summarize", recipient: recipient.toBase58() },
        { resource: "http://127.0.0.1:4021/v1/keywords", recipient: recipient.toBase58() },
      ],
    });
    expect((await app.request("/runs/latest")).status).toBe(404);
    expect((await app.request("/runs/not-a-run/events")).status).toBe(404);
    expect((await app.request("/readyz")).status).toBe(200);
  });
});
