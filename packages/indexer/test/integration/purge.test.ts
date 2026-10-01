/**
 * The RPC node purges old ledger data. solana-test-validator keeps 10,000 shreds by default and
 * this test makes it keep far less, so signatures of early settlements stop being listed.
 *
 * 1. The indexer indexes a few settlements and is killed. Settlements keep landing until the
 *    node purged the slot of its checkpoint. A restart must resume and index everything.
 * 2. The table is emptied and the indexer starts for the first time, late, after hundreds of
 *    slots of settlements. It must index every receipt on chain.
 */
import { readFileSync, rmSync } from "node:fs";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  type Chain,
  compareWithChain,
  counts,
  db,
  enabled,
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

const LEDGER_SHREDS = process.env.IT_LEDGER_SHREDS ?? "500";
const MIN_SLOTS = 300;

let validator: Validator | undefined;
const indexers: IndexerProc[] = [];

async function historyStart(c: Chain): Promise<number> {
  const [a, b] = await Promise.all([c.conn.getMinimumLedgerSlot(), c.conn.getFirstAvailableBlock()]);
  return Math.max(a, b);
}

function linesWith(file: string, text: string): string[] {
  return readFileSync(file, "utf8")
    .split("\n")
    .filter((l) => l.includes(text));
}

describe.skipIf(!enabled)("indexer against a validator that purges its ledger", () => {
  beforeAll(async () => {
    await prepareDatabase();
  }, 60_000);

  afterAll(async () => {
    for (const i of indexers) if (i.proc.exitCode === null) i.proc.kill("SIGKILL");
    if (validator) await stopValidator(validator);
    await db.pool?.end();
    if (process.env.IT_KEEP !== "1") rmSync(workDir, { recursive: true, force: true });
  }, 60_000);

  it("resumes past a purged checkpoint and a late first start indexes every receipt", async () => {
    validator = await startValidator("purging", ["--limit-ledger-size", LEDGER_SHREDS]);
    const chain = await setupChain();
    const okSigs: string[] = [];
    const land = async () => {
      const r = await settle(chain, 1500n + BigInt(okSigs.length));
      if (!r.ok) throw new Error(`settlement ${r.signature} failed on chain`);
      okSigs.push(r.signature);
    };

    for (let i = 0; i < 6; i++) await land();
    const firstSlot = (await chain.conn.getSignatureStatuses([okSigs[0] ?? ""])).value[0]?.slot;
    if (firstSlot === undefined) throw new Error("first settlement has no status");

    const early = startIndexer("early");
    indexers.push(early);
    const atKill = await waitFor("the early indexer to index the first settlements", async () => {
      const c = await counts();
      return c.receipts === okSigs.length && c.checkpoint?.last_signature === okSigs.at(-1)
        ? c
        : undefined;
    });
    early.proc.kill("SIGKILL");
    await early.exited;
    const checkpointSlot = Number(atKill.checkpoint?.last_slot);
    log(`early indexer killed with ${atKill.receipts} receipts, checkpoint slot ${checkpointSlot}`);

    // Keep settling until at least MIN_SLOTS slots of settlements exist and the node purged
    // the checkpoint slot.
    const deadline = Date.now() + 15 * 60_000;
    for (;;) {
      await land();
      const slot = await chain.conn.getSlot("confirmed");
      const start = await historyStart(chain);
      if (slot - firstSlot >= MIN_SLOTS && start > checkpointSlot) {
        log(
          `settled ${okSigs.length} over slots ${firstSlot} to ${slot}. The node now serves history from slot ${start}`,
        );
        break;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `The node did not purge slot ${checkpointSlot} in time. History starts at ${start}, tip ${slot}.`,
        );
      }
    }
    const listed = await chain.conn.getSignaturesForAddress(
      chain.agentWallet,
      { limit: 1000 },
      "confirmed",
    );
    log(
      `getSignaturesForAddress now lists ${listed.length} of ${okSigs.length + 1} wallet transactions. The oldest settlements are gone from the node`,
    );
    expect(listed.length).toBeLessThan(okSigs.length);

    // 1. Restart past a purged checkpoint.
    const restarted = startIndexer("after-purge");
    indexers.push(restarted);
    await waitFor(
      "the restarted indexer to index every settlement",
      async () => {
        const c = await counts();
        return c.receipts === okSigs.length && c.checkpoint?.last_signature === okSigs.at(-1)
          ? c
          : undefined;
      },
      180_000,
    );
    await waitFor("readiness", ready, 30_000);
    const landed = await landedReceipts(chain, okSigs);
    const first = await compareWithChain(chain, landed, { allowNullSignature: true });
    expect(first.compared).toBe(okSigs.length);
    const servedFrom = await historyStart(chain);
    for (const r of first.withoutSignature) expect(Number(r.slot)).toBeLessThan(servedFrom);
    log(
      `after restart ${first.compared} receipts match the chain field by field. ${first.withoutSignature.length} were restored from accounts without a signature`,
    );
    const resumeLine = linesWith(restarted.logFile, "Resuming from")[0];
    const gapLine = linesWith(restarted.logFile, "HISTORY GAP")[0];
    log(`restart log ${resumeLine}`);
    log(`restart log ${gapLine}`);
    expect(gapLine).toBeDefined();
    expect(linesWith(restarted.logFile, '"outcome":"error"').length).toBe(0);
    restarted.proc.kill("SIGTERM");
    expect(await restarted.exited).toBe(0);

    // 2. First start, late. Nothing in Postgres, hundreds of slots of history, most purged.
    await db.pool.query("TRUNCATE receipts, indexer_checkpoints");
    for (let i = 0; i < 3; i++) await land();
    const late = startIndexer("late-first-start");
    indexers.push(late);
    await waitFor(
      "the late indexer to index every receipt",
      async () => {
        const c = await counts();
        return c.receipts === okSigs.length && c.checkpoint?.last_signature === okSigs.at(-1)
          ? c
          : undefined;
      },
      180_000,
    );
    const second = await compareWithChain(chain, await landedReceipts(chain, okSigs), {
      allowNullSignature: true,
    });
    expect(second.compared).toBe(okSigs.length);
    const lateGap = linesWith(late.logFile, "HISTORY GAP")[0];
    log(`late first start log ${lateGap}`);
    expect(lateGap).toContain('"fromSlot":0');
    log(
      `late first start indexed all ${second.compared} receipts. ${second.withoutSignature.length} restored from accounts, the rest from transactions`,
    );
    const metrics = await (
      await fetch(`http://127.0.0.1:${process.env.IT_INDEXER_PORT ?? 14023}/metrics`)
    ).text();
    for (const name of [
      "turnstile_indexer_history_gaps_total",
      "turnstile_indexer_history_gap_slots_total",
      "turnstile_indexer_receipts_backfilled_total",
      "turnstile_indexer_receipts_indexed_total",
    ]) {
      log(`metric ${metrics.split("\n").find((l) => l.startsWith(name))}`);
    }
    late.proc.kill("SIGTERM");
    expect(await late.exited).toBe(0);
  }, 1_500_000);
});
