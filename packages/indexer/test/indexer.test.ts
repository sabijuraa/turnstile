import type { Pool } from "pg";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { FakeLedger, makeReceipt } from "./fake-source.js";
import {
  checkpointRow,
  closePool,
  crashingPool,
  drain,
  NETWORK,
  receiptRows,
  resetDb,
  STREAM,
  testIndexer,
  testPool,
} from "./helpers.js";

let pool: Pool;

beforeEach(async () => {
  pool = await testPool();
  await resetDb(pool);
});
afterAll(closePool);

async function expectExactlyOnce(ledger: FakeLedger): Promise<void> {
  const rows = await receiptRows(pool);
  const expected = ledger
    .allReceipts()
    .map((r) => r.receiptAddress)
    .sort();
  expect(rows.map((r) => r.receipt_address).sort()).toEqual(expected);
}

describe("empty history", () => {
  it("creates the checkpoint with the genesis hash and reports idle", async () => {
    const ledger = new FakeLedger();
    ledger.tip = 55;
    const { indexer } = testIndexer(ledger, pool);
    const r = await indexer.tick();
    expect(r).toMatchObject({
      outcome: "idle",
      resumedBy: "start",
      processed: 0,
      receiptsInserted: 0,
      remaining: 0,
      tipSlot: 55,
      lagSlots: 0,
      checkpoint: { lastSignature: null, lastSlot: 0 },
    });
    expect(await checkpointRow(pool)).toEqual({
      last_signature: null,
      last_slot: "0",
      genesis_hash: ledger.genesis,
    });
    expect(indexer.status().lastSuccessAt).not.toBeNull();
  });
});

describe("pagination and ordering", () => {
  it("walks several pages back to the checkpoint and processes oldest first", async () => {
    const ledger = new FakeLedger();
    const txs = ledger.addMany(25);
    const { indexer } = testIndexer(ledger, pool, { batchSize: 10 });

    const first = await indexer.tick();
    // 25 signatures at 10 per page needs 3 pages to reach the start of history.
    expect(ledger.calls.signatures).toBe(3);
    expect(first).toMatchObject({
      outcome: "progress",
      processed: 10,
      receiptsInserted: 10,
      remaining: 15,
      checkpoint: { lastSignature: txs[9]?.signature, lastSlot: txs[9]?.slot },
    });
    // The oldest ten were fetched, in order.
    expect(ledger.fetched).toEqual(txs.slice(0, 10).map((t) => t.signature));
    expect(first.lagSlots).toBe(ledger.tip - (txs[9]?.slot ?? 0));

    const second = await indexer.tick();
    expect(second.checkpoint?.lastSignature).toBe(txs[19]?.signature);
    expect(second.resumedBy).toBe("signature");
    const third = await indexer.tick();
    expect(third).toMatchObject({ processed: 5, remaining: 0, lagSlots: 0 });
    expect(third.checkpoint?.lastSignature).toBe(txs[24]?.signature);
    expect((await indexer.tick()).outcome).toBe("idle");

    expect(ledger.fetched).toEqual(txs.map((t) => t.signature));
    await expectExactlyOnce(ledger);
  });

  it("stops paging at the checkpoint when new work spans more than one page", async () => {
    const ledger = new FakeLedger();
    ledger.addMany(4);
    const { indexer } = testIndexer(ledger, pool, { batchSize: 3 });
    await drain(indexer);
    const newer = ledger.addMany(7);
    ledger.calls.signatures = 0;
    const r = await indexer.tick();
    // 7 new signatures at 3 per page is 3 pages. The node stops at the checkpoint.
    expect(ledger.calls.signatures).toBe(3);
    expect(r.checkpoint?.lastSignature).toBe(newer[2]?.signature);
    await drain(indexer);
    await expectExactlyOnce(ledger);
  });

  it("indexes every PaymentSettled event of a transaction", async () => {
    const ledger = new FakeLedger();
    ledger.add({ receipts: 3 });
    ledger.add({ receipts: 1 });
    const { indexer } = testIndexer(ledger, pool);
    const r = await indexer.tick();
    expect(r).toMatchObject({ processed: 2, receiptsSeen: 4, receiptsInserted: 4 });
    await expectExactlyOnce(ledger);
  });

  it("skips failed transactions without fetching them and moves past them", async () => {
    const ledger = new FakeLedger();
    const ok1 = ledger.add();
    const bad = ledger.add({ failed: true });
    const ok2 = ledger.add();
    const bad2 = ledger.add({ failed: true });
    const { indexer, metrics } = testIndexer(ledger, pool);
    const r = await indexer.tick();
    expect(r).toMatchObject({ processed: 4, skippedFailed: 2, receiptsInserted: 2 });
    expect(r.checkpoint?.lastSignature).toBe(bad2.signature);
    expect(ledger.fetched).toEqual([ok1.signature, ok2.signature]);
    expect(ledger.fetched).not.toContain(bad.signature);
    const text = await metrics.registry.metrics();
    expect(text).toContain(
      'turnstile_indexer_transactions_processed_total{stream="settlement:localnet",status="failed"} 2',
    );
  });

  it("writes every column in the formats the console backend reads", async () => {
    const ledger = new FakeLedger();
    const tx = ledger.add();
    const receipt = tx.receipts[0];
    if (!receipt) throw new Error("fixture has no receipt");
    await pool.query("INSERT INTO resources (resource_id, resource) VALUES ($1, $2)", [
      receipt.resourceId,
      "https://demo.turnstile.dev/v1/summarize",
    ]);
    const { indexer } = testIndexer(ledger, pool);
    await indexer.tick();
    const [row] = await receiptRows(pool);
    expect(row).toMatchObject({
      receipt_address: receipt.receiptAddress,
      signature: tx.signature,
      slot: String(tx.slot),
      agent_wallet: receipt.agentWallet,
      owner: receipt.owner,
      session_key: receipt.sessionKey,
      recipient: receipt.recipient,
      recipient_token: receipt.recipientToken,
      mint: receipt.mint,
      amount: receipt.amount.toString(),
      resource_id: receipt.resourceId,
      resource: "https://demo.turnstile.dev/v1/summarize",
      nonce: receipt.nonce,
      fee_payer: receipt.feePayer,
      network: NETWORK,
      genesis_hash: ledger.genesis,
    });
    expect(row?.resource_id).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.nonce).toMatch(/^[0-9a-f]{64}$/);
    expect(row?.block_time.getTime()).toBe(Number(receipt.unixTimestamp) * 1000);
  });

  it("ignores history older than the start slot", async () => {
    const ledger = new FakeLedger();
    ledger.add({ slot: 10 });
    ledger.add({ slot: 20 });
    const kept = [ledger.add({ slot: 30 }), ledger.add({ slot: 40 })];
    const { indexer } = testIndexer(ledger, pool, { startSlot: 30 });
    await drain(indexer);
    const rows = await receiptRows(pool);
    expect(rows.map((r) => r.signature)).toEqual(kept.map((t) => t.signature));
  });
});

describe("no gaps and no duplicates", () => {
  it("re-running over indexed history inserts nothing new", async () => {
    const ledger = new FakeLedger();
    ledger.addMany(12, { receipts: 2 });
    const a = testIndexer(ledger, pool);
    await drain(a.indexer);
    expect((await receiptRows(pool)).length).toBe(24);

    // Throw the checkpoint away and index everything again from scratch.
    await pool.query("DELETE FROM indexer_checkpoints");
    const b = testIndexer(ledger, pool);
    const results = await drain(b.indexer);
    expect(results.reduce((n, r) => n + r.receiptsSeen, 0)).toBe(24);
    expect(results.reduce((n, r) => n + r.receiptsInserted, 0)).toBe(0);
    await expectExactlyOnce(ledger);
  });

  it("a crash between the receipt insert and the checkpoint update replays the batch exactly once", async () => {
    const ledger = new FakeLedger();
    const txs = ledger.addMany(6, { receipts: 2 });
    // Every receipt insert happens, then the checkpoint update throws inside the transaction.
    const faulty = crashingPool(pool, /^\s*UPDATE indexer_checkpoints SET last_signature/);
    const crashed = testIndexer(ledger, faulty);
    const r = await crashed.indexer.tick();
    expect(r.outcome).toBe("error");
    expect(r.error).toMatchObject({ kind: "database", message: "simulated crash" });
    // The transaction rolled back. No receipt without its checkpoint.
    expect(await receiptRows(pool)).toEqual([]);
    expect((await checkpointRow(pool))?.last_signature).toBeNull();

    // A fresh process picks up the same batch.
    const restarted = testIndexer(ledger, pool);
    await drain(restarted.indexer);
    await expectExactlyOnce(ledger);
    expect((await checkpointRow(pool))?.last_signature).toBe(txs[5]?.signature);
  });

  it("a crash after the commit resumes past the committed batch", async () => {
    const ledger = new FakeLedger();
    const txs = ledger.addMany(15);
    const first = testIndexer(ledger, pool, { batchSize: 5 });
    await first.indexer.tick();
    // The process dies here. A new one starts with no memory.
    const second = testIndexer(ledger, pool, { batchSize: 5 });
    ledger.fetched = [];
    await drain(second.indexer);
    expect(ledger.fetched).toEqual(txs.slice(5).map((t) => t.signature));
    await expectExactlyOnce(ledger);
  });

  it("refuses a batch when another indexer moved the checkpoint first", async () => {
    const ledger = new FakeLedger();
    ledger.addMany(3);
    const a = testIndexer(ledger, pool);
    await a.indexer.tick();
    ledger.addMany(2);
    // Something else advances the checkpoint while `b` computes its batch.
    const b = testIndexer(ledger, pool);
    const orig = ledger.receiptAccounts.bind(ledger);
    ledger.receiptAccounts = async (addresses) => {
      await pool.query(
        "UPDATE indexer_checkpoints SET last_signature = 'moved' WHERE stream = $1",
        [STREAM],
      );
      return orig(addresses);
    };
    const r = await b.indexer.tick();
    expect(r.outcome).toBe("error");
    expect(r.error?.kind).toBe("conflict");
    expect((await receiptRows(pool)).length).toBe(3);
  });
});

describe("RPC failures", () => {
  it("backs off without moving the checkpoint and surfaces the error", async () => {
    const ledger = new FakeLedger();
    ledger.addMany(3);
    const { indexer, metrics } = testIndexer(ledger, pool);
    ledger.fail("signatures", new Error("fetch failed"), 2);
    const r1 = await indexer.tick();
    const r2 = await indexer.tick();
    expect(r1.outcome).toBe("error");
    expect(r1.error?.kind).toBe("rpc");
    expect(r1.error?.message).toMatch(/getSignaturesForAddress failed \(fetch failed\)/);
    expect(r2.outcome).toBe("error");
    expect(indexer.status()).toMatchObject({ consecutiveFailures: 2, lastSuccessAt: null });
    const text = await metrics.registry.metrics();
    expect(text).toContain(
      'turnstile_indexer_ticks_total{stream="settlement:localnet",outcome="error"} 2',
    );
    expect(text).toContain(
      'turnstile_indexer_tick_errors_total{stream="settlement:localnet",kind="rpc"} 2',
    );
    expect(text).toContain(
      'turnstile_indexer_consecutive_failures{stream="settlement:localnet"} 2',
    );

    const r3 = await indexer.tick();
    expect(r3.outcome).toBe("progress");
    expect(indexer.status().consecutiveFailures).toBe(0);
    await expectExactlyOnce(ledger);
  });

  it("writes nothing when a transaction fetch fails halfway through a batch", async () => {
    const ledger = new FakeLedger();
    ledger.addMany(10);
    const { indexer } = testIndexer(ledger, pool);
    ledger.fail("transaction", new Error("429 Too Many Requests"), 1, 4);
    const r = await indexer.tick();
    expect(r.outcome).toBe("error");
    expect(r.error?.message).toMatch(/getTransaction .* failed \(429 Too Many Requests\)/);
    expect(await receiptRows(pool)).toEqual([]);
    await drain(indexer);
    await expectExactlyOnce(ledger);
  });

  it("commits up to a transaction the node does not return yet and retries it", async () => {
    const ledger = new FakeLedger();
    const txs = ledger.addMany(6);
    const late = txs[3];
    if (!late) throw new Error("fixture");
    ledger.unavailable.add(late.signature);
    const { indexer } = testIndexer(ledger, pool);
    const r = await indexer.tick();
    expect(r).toMatchObject({ outcome: "progress", processed: 3, remaining: 3 });
    expect(r.checkpoint?.lastSignature).toBe(txs[2]?.signature);

    const stuck = await indexer.tick();
    expect(stuck.outcome).toBe("error");
    expect(stuck.error?.message).toMatch(/did not return the transaction/);

    ledger.unavailable.clear();
    await drain(indexer);
    await expectExactlyOnce(ledger);
  });
});

describe("resume edge cases", () => {
  it("falls back to a slot resume when the node forgot the checkpoint signature", async () => {
    const ledger = new FakeLedger();
    const old = ledger.addMany(4);
    const a = testIndexer(ledger, pool);
    await drain(a.indexer);
    const checkpoint = old[3];
    if (!checkpoint) throw new Error("fixture");
    // A second transaction in the checkpoint slot landed after the checkpoint signature.
    const sameSlot = ledger.add({ slot: checkpoint.slot });
    const newer = ledger.addMany(3);
    // The node pruned its history up to and including the checkpoint signature.
    for (const t of old) ledger.forgotten.add(t.signature);

    const b = testIndexer(ledger, pool);
    const r = await b.indexer.tick();
    expect(r.resumedBy).toBe("slot");
    expect(r.checkpoint?.lastSignature).toBe(newer[2]?.signature);
    const text = await b.metrics.registry.metrics();
    expect(text).toContain('turnstile_indexer_slot_resumes_total{stream="settlement:localnet"} 1');
    expect(ledger.fetched).toContain(sameSlot.signature);
    await expectExactlyOnce(ledger);
    // Once a known signature is stored, the next tick resumes by signature again.
    expect((await b.indexer.tick()).outcome).toBe("idle");
  });

  it("starts over when the local validator was reset", async () => {
    const ledger = new FakeLedger();
    ledger.addMany(5);
    const a = testIndexer(ledger, pool);
    await drain(a.indexer);
    expect((await receiptRows(pool)).length).toBe(5);

    // A fresh ledger with a new genesis and its own, shorter history.
    const fresh = new FakeLedger();
    fresh.addMany(2);
    const b = testIndexer(fresh, pool);
    const r = await b.indexer.tick();
    expect(r).toMatchObject({ outcome: "progress", reset: true, resumedBy: "start" });
    // The node never saw the old checkpoint signature, so nothing asked about it.
    expect(fresh.calls.signatureKnown).toBe(0);
    await expectExactlyOnce(fresh);
    expect((await checkpointRow(pool))?.genesis_hash).toBe(fresh.genesis);
    const text = await b.metrics.registry.metrics();
    expect(text).toContain('turnstile_indexer_ledger_resets_total{stream="settlement:localnet"} 1');
  });

  it("adopts the genesis hash on a checkpoint written before it was stored", async () => {
    const ledger = new FakeLedger();
    ledger.addMany(2);
    await pool.query(
      "INSERT INTO indexer_checkpoints (stream, last_signature, last_slot) VALUES ($1, NULL, 0)",
      [STREAM],
    );
    const { indexer } = testIndexer(ledger, pool);
    const r = await indexer.tick();
    expect(r.reset).toBe(false);
    expect((await checkpointRow(pool))?.genesis_hash).toBe(ledger.genesis);
  });

  it("keeps streams apart so the work can be partitioned", async () => {
    const ledger = new FakeLedger();
    ledger.addMany(3);
    const a = testIndexer(ledger, pool, { stream: "settlement:localnet:a" });
    const b = testIndexer(ledger, pool, { stream: "settlement:localnet:b" });
    await drain(a.indexer);
    const r = await b.indexer.tick();
    expect(r.receiptsSeen).toBe(3);
    expect(r.receiptsInserted).toBe(0);
    expect((await checkpointRow(pool, "settlement:localnet:a"))?.last_signature).toBe(
      (await checkpointRow(pool, "settlement:localnet:b"))?.last_signature,
    );
  });
});

describe("integrity", () => {
  it("refuses a batch whose event disagrees with the receipt account", async () => {
    const ledger = new FakeLedger();
    const tx = ledger.add();
    const receipt = tx.receipts[0];
    if (!receipt) throw new Error("fixture");
    ledger.accountOverrides.set(receipt.receiptAddress, {
      ...receipt,
      amount: receipt.amount + 1n,
    });
    const { indexer } = testIndexer(ledger, pool);
    const r = await indexer.tick();
    expect(r.outcome).toBe("error");
    expect(r.error?.kind).toBe("integrity");
    expect(r.error?.message).toMatch(/disagrees with its account on amount/);
    expect(await receiptRows(pool)).toEqual([]);
  });

  it("refuses an event whose receipt address is not the PDA of its wallet and nonce", async () => {
    const ledger = new FakeLedger();
    const tx = ledger.add();
    const other = makeReceipt(tx.slot);
    const first = tx.receipts[0];
    if (!first) throw new Error("fixture");
    tx.receipts[0] = { ...first, receiptAddress: other.receiptAddress };
    const { indexer } = testIndexer(ledger, pool);
    const r = await indexer.tick();
    expect(r.error?.kind).toBe("integrity");
    expect(r.error?.message).toMatch(/but the receipt PDA/);
  });

  it("indexes from the event alone when the receipt account cannot be read", async () => {
    const ledger = new FakeLedger();
    const tx = ledger.add();
    const receipt = tx.receipts[0];
    if (!receipt) throw new Error("fixture");
    ledger.accountOverrides.set(receipt.receiptAddress, null);
    const { indexer, metrics } = testIndexer(ledger, pool);
    const r = await indexer.tick();
    expect(r.receiptsInserted).toBe(1);
    expect(await metrics.registry.metrics()).toContain(
      'turnstile_indexer_missing_receipt_accounts_total{stream="settlement:localnet"} 1',
    );
  });
});

describe("purged history", () => {
  it("restores receipts from live accounts when a first start finds history purged", async () => {
    const ledger = new FakeLedger();
    const txs = ledger.addMany(20);
    const cut = txs[12];
    const closedTx = txs[4];
    if (!cut || !closedTx) throw new Error("fixture");
    // A receipt in the purged range was closed before the indexer ever saw it.
    const closed = closedTx.receipts[0]?.receiptAddress ?? "";
    ledger.closed.add(closed);
    ledger.purgeBefore(cut.slot);

    const { indexer, metrics } = testIndexer(ledger, pool);
    const first = await indexer.tick();
    expect(first).toMatchObject({
      outcome: "progress",
      resumedBy: "backfill",
      gap: { fromSlot: 0, toSlot: cut.slot, restored: 19 },
      checkpoint: { lastSignature: null, lastSlot: cut.slot },
    });
    await drain(indexer);

    const rows = await receiptRows(pool);
    const expected = ledger
      .allReceipts()
      .map((r) => r.receiptAddress)
      .filter((a) => a !== closed)
      .sort();
    expect(rows.map((r) => r.receipt_address).sort()).toEqual(expected);
    // Transactions the node still serves gave their rows a signature. Purged ones stay null.
    const bySig = new Map(txs.map((t) => [t.receipts[0]?.receiptAddress, t]));
    for (const row of rows) {
      const tx = bySig.get(row.receipt_address);
      expect(row.signature).toBe(tx && tx.slot >= cut.slot ? tx.signature : null);
    }
    expect((await checkpointRow(pool))?.last_signature).toBe(txs[19]?.signature);
    const text = await metrics.registry.metrics();
    expect(text).toContain('turnstile_indexer_history_gaps_total{stream="settlement:localnet"} 1');
    expect(text).toContain(
      `turnstile_indexer_history_gap_slots_total{stream="settlement:localnet"} ${cut.slot}`,
    );
    expect(text).toContain(
      'turnstile_indexer_receipts_backfilled_total{stream="settlement:localnet"} 19',
    );
    expect(text).toContain(
      'turnstile_indexer_receipts_indexed_total{stream="settlement:localnet"} 19',
    );
  });

  it("moves on when the node refuses a purged checkpoint signature it still reports as known", async () => {
    const ledger = new FakeLedger();
    const old = ledger.addMany(5);
    const a = testIndexer(ledger, pool);
    await drain(a.indexer);
    const newer = ledger.addMany(10);
    const cut = newer[3];
    const checkpoint = old[4];
    if (!cut || !checkpoint) throw new Error("fixture");
    ledger.purgeBefore(cut.slot);
    // The status cache still answers for the purged checkpoint, so only the paging call fails.
    ledger.statusCache.add(checkpoint.signature);

    const b = testIndexer(ledger, pool);
    const r = await b.indexer.tick();
    expect(r).toMatchObject({
      outcome: "progress",
      resumedBy: "backfill",
      gap: { fromSlot: checkpoint.slot, toSlot: cut.slot },
    });
    const results = await drain(b.indexer);
    expect(results.every((x) => x.outcome !== "error")).toBe(true);
    await expectExactlyOnce(ledger);
    expect((await checkpointRow(pool))?.last_signature).toBe(newer[9]?.signature);
    expect(await b.metrics.registry.metrics()).toContain(
      'turnstile_indexer_slot_resumes_total{stream="settlement:localnet"} 1',
    );
  });

  it("resumes by slot without a backfill when only the checkpoint signature is gone", async () => {
    const ledger = new FakeLedger();
    const old = ledger.addMany(3);
    const a = testIndexer(ledger, pool);
    await drain(a.indexer);
    const checkpoint = old[2];
    if (!checkpoint) throw new Error("fixture");
    ledger.addMany(4);
    ledger.forgotten.add(checkpoint.signature);
    ledger.statusCache.add(checkpoint.signature);
    ledger.historyStart = checkpoint.slot;

    // The same process keeps running. Its cached checkpoint signature is refused too.
    const r = await a.indexer.tick();
    expect(r.resumedBy).toBe("slot");
    expect(r.gap).toBeUndefined();
    expect(ledger.calls.liveReceipts).toBe(0);
    await drain(a.indexer);
    await expectExactlyOnce(ledger);
  });

  it("does not backfill when the start slot is inside the history the node serves", async () => {
    const ledger = new FakeLedger();
    const txs = ledger.addMany(6);
    const start = txs[3];
    if (!start) throw new Error("fixture");
    ledger.purgeBefore(txs[1]?.slot ?? 0);
    const { indexer } = testIndexer(ledger, pool, { startSlot: start.slot });
    const r = await indexer.tick();
    expect(r.resumedBy).toBe("start");
    expect(ledger.calls.liveReceipts).toBe(0);
    expect((await receiptRows(pool)).map((row) => row.signature)).toEqual(
      txs.slice(3).map((t) => t.signature),
    );
  });
});
