import type { Pool, PoolClient } from "pg";
import type { SettledReceipt } from "./source.js";

export interface Checkpoint {
  stream: string;
  /** Newest settlement program signature fully processed. Null before the first one. */
  lastSignature: string | null;
  /** Slot of `lastSignature`, or the configured start slot before the first one. */
  lastSlot: number;
  /** Genesis hash of the ledger the checkpoint belongs to. Null for rows older than migration 003. */
  genesisHash: string | null;
  updatedAt: Date;
}

/** A receipt ready to insert, with the transaction that produced it. */
export interface ReceiptRecord extends SettledReceipt {
  signature: string;
}

export interface CommitInput {
  stream: string;
  /** The checkpoint signature the batch was computed from. The commit refuses if it moved. */
  expectedSignature: string | null;
  genesisHash: string;
  network: string;
  receipts: ReceiptRecord[];
  next: { lastSignature: string; lastSlot: number };
}

export interface CommitResult {
  /** Receipts actually inserted. Rows that already existed are skipped and not counted. */
  inserted: number;
}

export interface ResetResult {
  /** Receipts of the old ledger that were deleted. */
  purged: number;
}

/** The checkpoint moved under this batch, most likely another indexer on the same stream. */
export class CheckpointConflictError extends Error {
  override name = "CheckpointConflictError";
}

export interface CheckpointStore {
  load(stream: string): Promise<Checkpoint | null>;
  /** Creates the checkpoint row when it does not exist yet and returns the current row. */
  ensure(stream: string, startSlot: number, genesisHash: string): Promise<Checkpoint>;
  /** Records the genesis hash on a row that predates it. */
  adoptGenesis(stream: string, genesisHash: string): Promise<void>;
  /**
   * Starts a stream over on a new ledger. Deletes the receipts of this network that came from
   * any other ledger and rewinds the checkpoint to the start slot, in one transaction.
   */
  reset(
    stream: string,
    network: string,
    genesisHash: string,
    startSlot: number,
  ): Promise<ResetResult>;
  /** Writes a batch of receipts and advances the checkpoint in one transaction. */
  commit(input: CommitInput): Promise<CommitResult>;
}

/** The part of pg.Pool the store uses. Tests wrap it to inject failures. */
export type Queryable = Pick<Pool, "query" | "connect">;

interface CheckpointRow {
  stream: string;
  last_signature: string | null;
  last_slot: string;
  genesis_hash: string | null;
  updated_at: Date;
}

function toCheckpoint(r: CheckpointRow): Checkpoint {
  return {
    stream: r.stream,
    lastSignature: r.last_signature,
    lastSlot: Number(r.last_slot),
    genesisHash: r.genesis_hash,
    updatedAt: r.updated_at,
  };
}

const SELECT_CHECKPOINT =
  "SELECT stream, last_signature, last_slot, genesis_hash, updated_at FROM indexer_checkpoints WHERE stream = $1";

/** 17 columns per row keeps a batch of 1000 receipts well under the Postgres parameter limit. */
const INSERT_RECEIPTS = `
INSERT INTO receipts (receipt_address, signature, slot, block_time, agent_wallet, owner,
  session_key, recipient, recipient_token, mint, amount, resource_id, resource, nonce,
  fee_payer, network, genesis_hash)
SELECT r.receipt_address, r.signature, r.slot, to_timestamp(r.unix_timestamp), r.agent_wallet,
  r.owner, r.session_key, r.recipient, r.recipient_token, r.mint, r.amount, r.resource_id,
  res.resource, r.nonce, r.fee_payer, $15, $16
FROM unnest($1::text[], $2::text[], $3::bigint[], $4::bigint[], $5::text[], $6::text[],
  $7::text[], $8::text[], $9::text[], $10::text[], $11::numeric[], $12::text[], $13::text[],
  $14::text[]) WITH ORDINALITY
  AS r(receipt_address, signature, slot, unix_timestamp, agent_wallet, owner, session_key,
    recipient, recipient_token, mint, amount, resource_id, nonce, fee_payer, ord)
LEFT JOIN resources res ON res.resource_id = r.resource_id
ORDER BY r.ord
ON CONFLICT (receipt_address) DO NOTHING`;

async function inTransaction<T>(db: Queryable, fn: (client: PoolClient) => Promise<T>): Promise<T> {
  const client = await db.connect();
  let broken: Error | undefined;
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    try {
      await client.query("ROLLBACK");
    } catch (rollbackErr) {
      // The connection is unusable. Drop it from the pool and report both failures.
      broken = rollbackErr instanceof Error ? rollbackErr : new Error(String(rollbackErr));
      const first = err instanceof Error ? err.message : String(err);
      throw new Error(`${first}. Rolling back also failed (${broken.message}).`, { cause: err });
    }
    throw err;
  } finally {
    client.release(broken);
  }
}

export function createCheckpointStore(db: Queryable): CheckpointStore {
  return {
    async load(stream) {
      const { rows } = await db.query<CheckpointRow>(SELECT_CHECKPOINT, [stream]);
      const row = rows[0];
      return row ? toCheckpoint(row) : null;
    },

    async ensure(stream, startSlot, genesisHash) {
      await db.query(
        `INSERT INTO indexer_checkpoints (stream, last_signature, last_slot, genesis_hash)
         VALUES ($1, NULL, $2, $3) ON CONFLICT (stream) DO NOTHING`,
        [stream, startSlot, genesisHash],
      );
      const { rows } = await db.query<CheckpointRow>(SELECT_CHECKPOINT, [stream]);
      const row = rows[0];
      if (!row) {
        throw new Error(
          `Checkpoint row for stream ${stream} vanished right after it was created. Check for another process deleting indexer_checkpoints rows.`,
        );
      }
      return toCheckpoint(row);
    },

    async adoptGenesis(stream, genesisHash) {
      await db.query(
        "UPDATE indexer_checkpoints SET genesis_hash = $2, updated_at = now() WHERE stream = $1 AND genesis_hash IS NULL",
        [stream, genesisHash],
      );
    },

    async reset(stream, network, genesisHash, startSlot) {
      return inTransaction(db, async (client) => {
        const purged = await client.query(
          "DELETE FROM receipts WHERE network = $1 AND genesis_hash IS DISTINCT FROM $2",
          [network, genesisHash],
        );
        await client.query(
          `INSERT INTO indexer_checkpoints (stream, last_signature, last_slot, genesis_hash, updated_at)
           VALUES ($1, NULL, $2, $3, now())
           ON CONFLICT (stream) DO UPDATE SET last_signature = NULL, last_slot = $2,
             genesis_hash = $3, updated_at = now()`,
          [stream, startSlot, genesisHash],
        );
        return { purged: purged.rowCount ?? 0 };
      });
    },

    async commit(input) {
      return inTransaction(db, async (client) => {
        const locked = await client.query<CheckpointRow>(`${SELECT_CHECKPOINT} FOR UPDATE`, [
          input.stream,
        ]);
        const current = locked.rows[0];
        if (!current) {
          throw new CheckpointConflictError(
            `Checkpoint row for stream ${input.stream} is missing. It is created on the first tick, so another process removed it. The batch was not written.`,
          );
        }
        if (
          current.last_signature !== input.expectedSignature ||
          current.genesis_hash !== input.genesisHash
        ) {
          throw new CheckpointConflictError(
            `Checkpoint for stream ${input.stream} moved to ${current.last_signature ?? "nothing"} while this batch expected ${input.expectedSignature ?? "nothing"}. Another indexer is probably running on the same stream. The batch was not written and the next tick starts from the new checkpoint.`,
          );
        }
        let inserted = 0;
        if (input.receipts.length > 0) {
          const rs = input.receipts;
          const res = await client.query(INSERT_RECEIPTS, [
            rs.map((r) => r.receiptAddress),
            rs.map((r) => r.signature),
            rs.map((r) => r.slot.toString()),
            rs.map((r) => r.unixTimestamp.toString()),
            rs.map((r) => r.agentWallet),
            rs.map((r) => r.owner),
            rs.map((r) => r.sessionKey),
            rs.map((r) => r.recipient),
            rs.map((r) => r.recipientToken),
            rs.map((r) => r.mint),
            rs.map((r) => r.amount.toString()),
            rs.map((r) => r.resourceId),
            rs.map((r) => r.nonce),
            rs.map((r) => r.feePayer),
            input.network,
            input.genesisHash,
          ]);
          inserted = res.rowCount ?? 0;
        }
        await client.query(
          `UPDATE indexer_checkpoints SET last_signature = $2, last_slot = $3, updated_at = now()
           WHERE stream = $1`,
          [input.stream, input.next.lastSignature, input.next.lastSlot],
        );
        return { inserted };
      });
    },
  };
}
