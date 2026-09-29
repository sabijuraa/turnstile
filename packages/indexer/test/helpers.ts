import { SETTLEMENT_PROGRAM_ID } from "@turnstile/shared";
import { createPool, migrate } from "@turnstile/shared/db";
import type { Pool, PoolClient, QueryResult } from "pg";
import { createIndexer, type Indexer, type IndexerDeps } from "../src/indexer.js";
import { createLogger } from "../src/logger.js";
import { createMetrics, type IndexerMetrics } from "../src/metrics.js";
import type { ReceiptSource } from "../src/source.js";
import { createCheckpointStore, type Queryable } from "../src/store.js";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://turnstile_indexer_test:turnstile_indexer_test@127.0.0.1:5432/turnstile_indexer_test";

export const STREAM = "settlement:localnet";
export const NETWORK = "solana:localnet";

let sharedPool: Pool | undefined;
let migrated = false;

export async function testPool(): Promise<Pool> {
  if (!sharedPool) sharedPool = createPool(TEST_DATABASE_URL, 5);
  if (!migrated) {
    await migrate(sharedPool);
    migrated = true;
  }
  return sharedPool;
}

export async function closePool(): Promise<void> {
  await sharedPool?.end();
  sharedPool = undefined;
  migrated = false;
}

export async function resetDb(pool: Pool): Promise<void> {
  await pool.query("TRUNCATE receipts, resources, indexer_checkpoints");
}

export interface TestIndexer {
  indexer: Indexer;
  metrics: IndexerMetrics;
}

export function testIndexer(
  source: ReceiptSource,
  db: Queryable,
  overrides: Partial<IndexerDeps> = {},
): TestIndexer {
  const metrics = createMetrics(false);
  const indexer = createIndexer({
    source,
    store: createCheckpointStore(db),
    stream: STREAM,
    network: NETWORK,
    settlementProgram: SETTLEMENT_PROGRAM_ID,
    batchSize: 10,
    logger: createLogger("silent"),
    metrics,
    ...overrides,
  });
  return { indexer, metrics };
}

/** Runs ticks until the indexer reports idle or an error, and returns every result. */
export async function drain(indexer: Indexer, maxTicks = 100) {
  const results = [];
  for (let i = 0; i < maxTicks; i++) {
    const r = await indexer.tick();
    results.push(r);
    if (r.outcome !== "progress") return results;
  }
  throw new Error(`Indexer still had work after ${maxTicks} ticks`);
}

/**
 * Wraps a pool so the first query whose text matches `pattern` throws, as a crash at that
 * point would. The surrounding transaction then rolls back like it would on a real crash.
 */
export function crashingPool(pool: Pool, pattern: RegExp, times = 1): Queryable {
  let left = times;
  const trip = (text: unknown) => {
    if (left > 0 && typeof text === "string" && pattern.test(text)) {
      left--;
      throw new Error("simulated crash");
    }
  };
  return {
    query: pool.query.bind(pool) as Pool["query"],
    connect: (async () => {
      const client = await pool.connect();
      const original = client.query.bind(client) as (
        text: unknown,
        values?: unknown,
      ) => Promise<QueryResult>;
      const wrapped = async (text: unknown, values?: unknown) => {
        trip(text);
        return original(text, values);
      };
      return Object.assign(Object.create(client) as PoolClient, {
        query: wrapped,
        release: client.release.bind(client),
      });
    }) as Pool["connect"],
  };
}

export interface ReceiptRow {
  receipt_address: string;
  signature: string;
  slot: string;
  block_time: Date;
  agent_wallet: string;
  owner: string;
  session_key: string;
  recipient: string;
  recipient_token: string;
  mint: string;
  amount: string;
  resource_id: string;
  resource: string | null;
  nonce: string;
  fee_payer: string;
  network: string;
  genesis_hash: string | null;
}

export async function receiptRows(pool: Pool): Promise<ReceiptRow[]> {
  const { rows } = await pool.query<ReceiptRow>(
    "SELECT * FROM receipts ORDER BY slot, receipt_address",
  );
  return rows;
}

export async function checkpointRow(pool: Pool, stream = STREAM) {
  const { rows } = await pool.query<{
    last_signature: string | null;
    last_slot: string;
    genesis_hash: string | null;
  }>("SELECT last_signature, last_slot, genesis_hash FROM indexer_checkpoints WHERE stream = $1", [
    stream,
  ]);
  return rows[0] ?? null;
}
