import type { Pool } from "pg";

export interface DeadLetterInput {
  agentWallet: string;
  /** Hex nonce. */
  nonce: string;
  payload: unknown;
  requirements: unknown;
  error: string;
}

export type DeadLetterStatus = "pending" | "replayed" | "abandoned";

export interface DeadLetter {
  id: string;
  agentWallet: string;
  nonce: string;
  payload: unknown;
  requirements: unknown;
  error: string;
  attempts: number;
  status: DeadLetterStatus;
  createdAt: Date;
  updatedAt: Date;
}

/** The facilitator's only state. Everything else lives on chain. */
export interface FacilitatorStore {
  ping(): Promise<void>;
  /** Remembers the readable resource behind a resource id. Keeps the first value seen. */
  upsertResource(resourceIdHex: string, resource: string): Promise<void>;
  /** Inserts a dead letter, or bumps the attempt count of the pending one for the same nonce. */
  recordDeadLetter(input: DeadLetterInput): Promise<{ id: string; attempts: number }>;
  pendingDeadLetters(limit: number): Promise<DeadLetter[]>;
  /** Closes a dead letter. The note is appended to the stored error so the history stays. */
  markDeadLetter(id: string, status: "replayed" | "abandoned", note: string): Promise<void>;
}

interface DeadLetterRow {
  id: string;
  agent_wallet: string;
  nonce: string;
  payload: unknown;
  requirements: unknown;
  error: string;
  attempts: number;
  status: DeadLetterStatus;
  created_at: Date;
  updated_at: Date;
}

export function createStore(pool: Pool): FacilitatorStore {
  return {
    async ping() {
      await pool.query("SELECT 1");
    },

    async upsertResource(resourceIdHex, resource) {
      await pool.query(
        "INSERT INTO resources (resource_id, resource) VALUES ($1, $2) ON CONFLICT (resource_id) DO NOTHING",
        [resourceIdHex, resource],
      );
    },

    async recordDeadLetter(input) {
      const { rows } = await pool.query<{ id: string; attempts: number }>(
        `INSERT INTO settlement_dead_letters (agent_wallet, nonce, payload, requirements, error)
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT (agent_wallet, nonce) DO UPDATE SET
           payload = EXCLUDED.payload,
           requirements = EXCLUDED.requirements,
           error = EXCLUDED.error,
           attempts = settlement_dead_letters.attempts + 1,
           status = 'pending',
           updated_at = now()
         RETURNING id::text AS id, attempts`,
        [
          input.agentWallet,
          input.nonce,
          JSON.stringify(input.payload),
          JSON.stringify(input.requirements),
          input.error,
        ],
      );
      const row = rows[0];
      if (!row) throw new Error("dead letter insert returned no row");
      return row;
    },

    async pendingDeadLetters(limit) {
      const { rows } = await pool.query<DeadLetterRow>(
        `SELECT id::text AS id, agent_wallet, nonce, payload, requirements, error, attempts, status,
                created_at, updated_at
         FROM settlement_dead_letters WHERE status = 'pending' ORDER BY id LIMIT $1`,
        [limit],
      );
      return rows.map((r) => ({
        id: r.id,
        agentWallet: r.agent_wallet,
        nonce: r.nonce,
        payload: r.payload,
        requirements: r.requirements,
        error: r.error,
        attempts: r.attempts,
        status: r.status,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      }));
    },

    async markDeadLetter(id, status, note) {
      await pool.query(
        `UPDATE settlement_dead_letters
         SET status = $2, error = error || E'\n' || $3, updated_at = now() WHERE id = $1`,
        [id, status, note],
      );
    },
  };
}
