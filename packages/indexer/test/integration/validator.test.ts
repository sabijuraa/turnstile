/**
 * End to end against a real solana-test-validator with the Turnstile programs loaded and a real
 * Postgres. Produces settlements with the shared client, runs the built indexer as a separate
 * process, kills it with SIGKILL while settlements keep landing, restarts it and compares the
 * receipts table with the receipt accounts on chain, field by field.
 *
 * Run with `pnpm --filter @turnstile/indexer test:integration` after `pnpm build`.
 */
import { readFileSync, rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  compareWithChain,
  counts,
  db,
  enabled,
  HTTP_PORT,
  type IndexerProc,
  landedReceipts,
  log,
  prepareDatabase,
  ready,
  settle,
  setupChain,
  startIndexer,
  startValidator,
  stopValidator,
  type Validator,
  waitFor,
  workDir,
} from "./harness.js";

const validators: Validator[] = [];
const indexers: IndexerProc[] = [];

describe.skipIf(!enabled)("indexer against a real validator", () => {
  beforeAll(async () => {
    await prepareDatabase();
  }, 60_000);

  afterAll(async () => {
    for (const i of indexers) if (i.proc.exitCode === null) i.proc.kill("SIGKILL");
    for (const v of validators) await stopValidator(v);
    await db.pool?.end();
    if (process.env.IT_KEEP !== "1") rmSync(workDir, { recursive: true, force: true });
  }, 60_000);

  it("survives a SIGKILL mid-stream with no gap and no duplicate", async () => {
    validators.push(await startValidator("ledger-a"));
    const chain = await setupChain();
    const okSigs: string[] = [];
    let failed = 0;
    const produce = async (n: number) => {
      for (let i = 0; i < n; i++) {
        // Every seventh payment is over the per-call cap and lands as a failed transaction.
        const over = (okSigs.length + failed) % 7 === 6;
        const r = await settle(chain, over ? 60_000n : BigInt(1000 + i * 17));
        if (r.ok) okSigs.push(r.signature);
        else failed++;
      }
    };

    await produce(10);
    log(`before start ${okSigs.length} settled, ${failed} failed on chain`);

    const first = startIndexer("first");
    indexers.push(first);
    // Keep settlements landing while the indexer runs, then kill it mid-stream.
    const producing = produce(20);
    const atKill = await waitFor("the indexer to get part of the way", async () => {
      const c = await counts();
      return c.receipts >= 12 ? c : undefined;
    });
    first.proc.kill("SIGKILL");
    const code = await first.exited;
    log(
      `SIGKILL sent. Exit ${code}, signal ${first.proc.signalCode}. At kill ${atKill.receipts} receipts stored, checkpoint slot ${atKill.checkpoint?.last_slot}`,
    );
    await producing;
    await produce(8);
    const afterKill = await counts();
    const totalOk = okSigs.length;
    log(
      `while dead ${afterKill.receipts} receipts stored of ${totalOk} settled, ${failed} failed transactions on chain`,
    );
    expect(first.proc.signalCode).toBe("SIGKILL");
    expect(afterKill.receipts).toBeLessThan(totalOk);

    const second = startIndexer("second");
    indexers.push(second);
    await waitFor("the restarted indexer to catch up", async () => {
      const c = await counts();
      return c.receipts === totalOk && c.checkpoint?.last_signature ? c : undefined;
    });
    await waitFor("readiness", ready, 20_000);
    // Give it a few idle ticks to prove nothing else is written.
    await new Promise((r) => setTimeout(r, 1000));
    const finalCounts = await counts();
    expect(finalCounts.receipts).toBe(totalOk);

    const landed = await landedReceipts(chain, okSigs);
    const { compared } = await compareWithChain(chain, landed);
    log(`compared ${compared} receipts field by field with their on-chain accounts. All equal.`);
    expect(compared).toBe(totalOk);

    const metrics = await (await fetch(`http://127.0.0.1:${HTTP_PORT}/metrics`)).text();
    const line = (name: string) =>
      metrics
        .split("\n")
        .filter((l) => l.startsWith(name))
        .join(" | ");
    log(`metrics after restart ${line("turnstile_indexer_receipts_indexed_total")}`);
    log(`metrics after restart ${line("turnstile_indexer_ticks_total")}`);
    log(`metrics after restart ${line("turnstile_indexer_lag_slots")}`);
    const secondLog = readFileSync(second.logFile, "utf8");
    const firstTick = secondLog.split("\n").find((l) => l.includes('"msg":"tick"'));
    log(`first tick after restart ${firstTick}`);
    expect(firstTick).toContain('"resumedBy":"signature"');

    second.proc.kill("SIGTERM");
    expect(await second.exited).toBe(0);
    await stopValidator(validators.pop() as Validator);
  }, 300_000);

  it("starts over when the validator is reset to a new genesis", async () => {
    const before = await counts();
    expect(before.receipts).toBeGreaterThan(0);
    validators.push(await startValidator("ledger-b"));
    const chain = await setupChain();
    const sigs: string[] = [];
    for (let i = 0; i < 4; i++) sigs.push((await settle(chain, 2000n + BigInt(i))).signature);

    const proc = startIndexer("after-reset");
    indexers.push(proc);
    await waitFor("the indexer to index the new ledger", async () => {
      const c = await counts();
      return c.receipts === 4 && c.checkpoint?.last_signature === sigs[3] ? c : undefined;
    });
    const { compared } = await compareWithChain(chain, await landedReceipts(chain, sigs));
    expect(compared).toBe(4);
    const text = readFileSync(proc.logFile, "utf8");
    const reset = text.split("\n").find((l) => l.includes("LEDGER RESET DETECTED"));
    log(`reset log line ${reset}`);
    expect(reset).toContain(`"purgedReceipts":${before.receipts}`);
    proc.proc.kill("SIGTERM");
    expect(await proc.exited).toBe(0);
  }, 300_000);
});
