import pg from "pg";

/** A row of the indexer's receipts table, as node-postgres returns it. */
export interface ReceiptRow {
  receipt_address: string;
  signature: string;
  /** BIGINT comes back as a string. */
  slot: string;
  block_time: Date;
  agent_wallet: string;
  owner: string;
  session_key: string;
  recipient: string;
  recipient_token: string;
  mint: string;
  /** NUMERIC comes back as a string. */
  amount: string;
  resource_id: string;
  resource: string | null;
  nonce: string;
  fee_payer: string;
  network: string;
}

export function createPool(databaseUrl: string): pg.Pool {
  return new pg.Pool({ connectionString: databaseUrl, max: 2 });
}

/** Waits until the indexer has stored every receipt address, then returns the rows in order. */
export async function waitForReceiptRows(
  pool: pg.Pool,
  addresses: string[],
  timeoutMs = 60_000,
): Promise<ReceiptRow[]> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const { rows } = await pool.query<ReceiptRow>(
      "SELECT * FROM receipts WHERE receipt_address = ANY($1::text[])",
      [addresses],
    );
    if (rows.length === addresses.length) {
      const byAddress = new Map(rows.map((r) => [r.receipt_address, r]));
      return addresses.map((a) => byAddress.get(a) as ReceiptRow);
    }
    if (Date.now() > deadline) {
      const found = new Set(rows.map((r) => r.receipt_address));
      const missing = addresses.filter((a) => !found.has(a));
      throw new Error(
        `The indexer did not store ${missing.join(", ")} within ${timeoutMs / 1000} s. Check the indexer /readyz and its logs.`,
      );
    }
    await new Promise((r) => setTimeout(r, 500));
  }
}
