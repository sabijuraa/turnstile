import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SETTLEMENT_PROGRAM_ID } from "@turnstile/shared";
import { createPool } from "@turnstile/shared/db";
import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import type { TickResult } from "../src/indexer.js";
import { createLogger } from "../src/logger.js";
import { createRunner, nextDelay } from "../src/runner.js";
import { FakeLedger } from "./fake-source.js";
import { closePool, receiptRows, resetDb, testIndexer, testPool } from "./helpers.js";

let pool: Pool;

beforeEach(async () => {
  pool = await testPool();
  await resetDb(pool);
});
afterAll(closePool);

describe("readiness", () => {
  it("is not ready before the first successful tick, ready after, and not ready when stale", async () => {
    const ledger = new FakeLedger();
    ledger.addMany(2);
    const clock = { now: 1_000_000 };
    const t = testIndexer(ledger, pool, { clock: () => clock.now });
    const app = createApp({
      indexer: t.indexer,
      pool,
      metrics: t.metrics,
      logger: createLogger("silent"),
      readyStaleMs: 30_000,
      clock: () => clock.now,
    });

    const before = await app.request("/readyz");
    expect(before.status).toBe(503);
    expect(await before.json()).toMatchObject({
      status: "unavailable",
      failed: ["indexer"],
      checks: {
        database: { ok: true },
        indexer: { ok: false, lastSuccessAt: null, error: /No tick has succeeded yet/ },
      },
    });

    await t.indexer.tick();
    const ready = await app.request("/readyz");
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      status: "ready",
      checks: { indexer: { ok: true, consecutiveFailures: 0, lagSlots: 0 } },
    });

    // The RPC goes away and ticks keep failing for longer than the limit.
    ledger.fail("genesisHash", new Error("connect ECONNREFUSED 127.0.0.1:8899"), 100);
    clock.now += 31_000;
    await t.indexer.tick();
    const stale = await app.request("/readyz");
    expect(stale.status).toBe(503);
    const body = (await stale.json()) as {
      checks: { indexer: { error: string; consecutiveFailures: number } };
    };
    expect(body.checks.indexer.consecutiveFailures).toBe(1);
    expect(body.checks.indexer.error).toMatch(/31 s ago, over the 30 s limit/);
    expect(body.checks.indexer.error).toMatch(/getGenesisHash failed \(connect ECONNREFUSED/);
  });

  it("names the database when Postgres is down", async () => {
    const down = createPool("postgres://nobody:nothing@127.0.0.1:1/none", 1);
    const t = testIndexer(new FakeLedger(), pool);
    await t.indexer.tick();
    const app = createApp({
      indexer: t.indexer,
      pool: down,
      metrics: t.metrics,
      logger: createLogger("silent"),
      readyStaleMs: 30_000,
    });
    const res = await app.request("/readyz");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      failed: ["database"],
      checks: { database: { ok: false, error: /ECONNREFUSED/ }, indexer: { ok: true } },
    });
    await down.end();
  });

  it("serves health and the indexer metrics", async () => {
    const ledger = new FakeLedger();
    ledger.addMany(3);
    const t = testIndexer(ledger, pool);
    await t.indexer.tick();
    const app = createApp({
      indexer: t.indexer,
      pool,
      metrics: t.metrics,
      logger: createLogger("silent"),
      readyStaleMs: 30_000,
    });
    expect(await (await app.request("/healthz")).json()).toEqual({
      status: "ok",
      service: "indexer",
    });
    const text = await (await app.request("/metrics")).text();
    expect(text).toContain(
      'turnstile_indexer_receipts_indexed_total{stream="settlement:localnet"} 3',
    );
    expect(text).toContain(
      'turnstile_indexer_ticks_total{stream="settlement:localnet",outcome="progress"} 1',
    );
    expect(text).toContain('turnstile_indexer_lag_slots{stream="settlement:localnet"} 0');
    expect(text).toContain("turnstile_indexer_tick_duration_seconds_bucket");
    const missing = await app.request("/nope");
    expect(missing.status).toBe(404);
  });
});

describe("runner", () => {
  const result = (outcome: TickResult["outcome"], remaining = 0) =>
    ({ outcome, remaining }) as TickResult;

  it("runs backlog at once, polls when idle and backs off exponentially on errors", () => {
    expect(nextDelay(result("progress", 5), 0, 1000, 30_000)).toBe(0);
    expect(nextDelay(result("progress", 0), 0, 1000, 30_000)).toBe(1000);
    expect(nextDelay(result("idle"), 0, 1000, 30_000)).toBe(1000);
    expect(nextDelay(result("error"), 1, 1000, 30_000)).toBe(1000);
    expect(nextDelay(result("error"), 3, 1000, 30_000)).toBe(4000);
    expect(nextDelay(result("error"), 50, 1000, 30_000)).toBe(30_000);
  });

  it("keeps ticking through errors until it has indexed everything, then stops cleanly", async () => {
    const ledger = new FakeLedger();
    ledger.addMany(25);
    ledger.fail("signatures", new Error("fetch failed"), 2);
    const t = testIndexer(ledger, pool, { batchSize: 10 });
    const seen: TickResult[] = [];
    let resolveIdle: () => void = () => undefined;
    const idle = new Promise<void>((r) => {
      resolveIdle = r;
    });
    const runner = createRunner({
      indexer: t.indexer,
      pollMs: 20,
      maxBackoffMs: 40,
      logger: createLogger("silent"),
      onTick: (r) => {
        seen.push(r);
        if (r.outcome === "idle") resolveIdle();
      },
    });
    runner.start();
    await idle;
    await runner.stop();
    expect(runner.running).toBe(false);
    expect(seen.slice(0, 2).map((r) => r.outcome)).toEqual(["error", "error"]);
    expect(seen.filter((r) => r.outcome === "progress").length).toBe(3);
    expect((await receiptRows(pool)).length).toBe(25);
  });
});

describe("config", () => {
  it("names every bad variable", () => {
    expect(() =>
      loadConfig({ TURNSTILE_NETWORK: "mainnet", INDEXER_BATCH: "5000", INDEXER_POLL_MS: "x" }),
    ).toThrowError(
      /DATABASE_URL is not set[\s\S]*TURNSTILE_NETWORK must be localnet or devnet[\s\S]*INDEXER_POLL_MS must be a whole number[\s\S]*INDEXER_BATCH must be between 1 and 1000/,
    );
  });

  it("uses the runtime contract defaults and reads the settlement id from the deployment file", () => {
    const file = join(tmpdir(), `turnstile-indexer-deploy-${process.pid}.json`);
    const settlement = "11111111111111111111111111111111";
    writeFileSync(file, JSON.stringify({ network: "localnet", programs: { settlement } }));
    const c = loadConfig({
      DATABASE_URL: "postgres://turnstile:turnstile@127.0.0.1:5433/turnstile",
      TURNSTILE_NETWORK: "localnet",
      DEPLOYMENT_FILE: file,
      INDEXER_START_SLOT: "42",
    });
    expect(c).toMatchObject({
      port: 4023,
      network: "localnet",
      networkId: "solana:localnet",
      rpcUrl: "http://127.0.0.1:8899",
      stream: "settlement:localnet",
      startSlot: 42,
      pollMs: 1000,
      batchSize: 200,
      readyStaleMs: 60_000,
    });
    expect(c.settlementProgram.toBase58()).toBe(settlement);

    const d = loadConfig({
      DATABASE_URL: "postgres://u:p@h/db",
      TURNSTILE_NETWORK: "devnet",
      INDEXER_STREAM: "settlement:devnet:shard-1",
    });
    expect(d.stream).toBe("settlement:devnet:shard-1");
    expect(d.startSlot).toBeUndefined();
    expect(d.settlementProgram.equals(SETTLEMENT_PROGRAM_ID)).toBe(true);
  });

  it("rejects a deployment file that does not exist", () => {
    expect(() =>
      loadConfig({
        DATABASE_URL: "postgres://u:p@h/db",
        DEPLOYMENT_FILE: "/nowhere/localnet.json",
      }),
    ).toThrowError(/does not exist\. Deploy the programs first/);
  });
});
