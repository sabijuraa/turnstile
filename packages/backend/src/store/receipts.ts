import {
  bytesToHex,
  canonicalResource,
  explorerTxUrl,
  formatUnits,
  type NetworkConfig,
  resourceId,
} from "@turnstile/shared";
import type { Pool } from "pg";
import { z } from "zod";
import { ApiError } from "../errors.js";
import { pubkeySchema } from "../validation.js";

export const sortSchema = z.enum(["newest", "oldest", "amount_desc", "amount_asc"], {
  error: "must be one of newest, oldest, amount_desc or amount_asc",
});
export type ReceiptSort = z.infer<typeof sortSchema>;

const isoDate = z.iso
  .datetime({ offset: true, error: "must be an ISO 8601 timestamp such as 2026-09-01T00:00:00Z" })
  .or(z.iso.date({ error: "must be an ISO 8601 date or timestamp" }))
  .transform((v) => new Date(v));

export const receiptFilterSchema = z.object({
  agent: pubkeySchema.optional(),
  resource: z.string().trim().min(1).max(2048).optional(),
  from: isoDate.optional(),
  to: isoDate.optional(),
  search: z.string().trim().min(1).max(200).optional(),
  sort: sortSchema.default("newest"),
});

export const receiptListSchema = receiptFilterSchema.extend({
  cursor: z.string().max(512).optional(),
  limit: z.coerce
    .number({ error: "must be a number" })
    .int("must be a whole number")
    .min(1, "must be at least 1")
    .max(200, "must be 200 or less")
    .default(50),
});

export type ReceiptFilter = z.infer<typeof receiptFilterSchema>;

export interface ReceiptView {
  receiptAddress: string;
  signature: string;
  slot: string;
  blockTime: string;
  agentWallet: string;
  agentLabel: string | null;
  owner: string;
  sessionKey: string;
  recipient: string;
  recipientToken: string;
  mint: string;
  /** Base units as a decimal string. */
  amount: string;
  /** Exact decimal in whole stablecoin units. */
  displayAmount: string;
  resourceId: string;
  resource: string | null;
  nonce: string;
  feePayer: string;
  network: string;
  status: "settled";
  explorerUrl: string;
}

interface ReceiptRow {
  receipt_address: string;
  signature: string;
  slot: string;
  block_time: Date;
  block_time_text: string;
  agent_wallet: string;
  agent_label: string | null;
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
}

export function toReceiptView(r: ReceiptRow, network: NetworkConfig): ReceiptView {
  return {
    receiptAddress: r.receipt_address,
    signature: r.signature,
    slot: r.slot,
    blockTime: r.block_time.toISOString(),
    agentWallet: r.agent_wallet,
    agentLabel: r.agent_label,
    owner: r.owner,
    sessionKey: r.session_key,
    recipient: r.recipient,
    recipientToken: r.recipient_token,
    mint: r.mint,
    amount: r.amount,
    displayAmount: formatUnits(BigInt(r.amount)),
    resourceId: r.resource_id,
    resource: r.resource,
    nonce: r.nonce,
    feePayer: r.fee_payer,
    network: r.network,
    status: "settled",
    explorerUrl: explorerTxUrl(network, r.signature),
  };
}

/** Accepts a 64 character hex resource id, a URL or a canonical resource string. */
export function resolveResourceId(value: string): string {
  if (/^[0-9a-fA-F]{64}$/.test(value)) return value.toLowerCase();
  let resource = value;
  if (/^https?:\/\//i.test(value)) {
    try {
      resource = canonicalResource(value);
    } catch {
      resource = value;
    }
  }
  return bytesToHex(resourceId(resource));
}

function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (m) => `\\${m}`);
}

interface Cursor {
  s: ReceiptSort;
  k: string;
  a: string;
}

export function encodeCursor(c: Cursor): string {
  return Buffer.from(JSON.stringify(c), "utf8").toString("base64url");
}

function decodeCursor(value: string, sort: ReceiptSort): Cursor {
  const invalid = new ApiError(
    400,
    "invalid_cursor",
    "cursor is not valid for this query. Drop the cursor to start from the first page.",
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(Buffer.from(value, "base64url").toString("utf8"));
  } catch {
    throw invalid;
  }
  const shape = z.object({ s: sortSchema, k: z.string().max(64), a: z.string().max(64) });
  const result = shape.safeParse(parsed);
  if (!result.success || result.data.s !== sort) throw invalid;
  if (sort === "newest" || sort === "oldest") {
    if (Number.isNaN(Date.parse(result.data.k))) throw invalid;
  } else if (!/^\d+$/.test(result.data.k)) {
    throw invalid;
  }
  return result.data;
}

const ORDER: Record<ReceiptSort, { column: string; dir: "ASC" | "DESC"; cast: string }> = {
  newest: { column: "r.block_time", dir: "DESC", cast: "timestamptz" },
  oldest: { column: "r.block_time", dir: "ASC", cast: "timestamptz" },
  amount_desc: { column: "r.amount", dir: "DESC", cast: "numeric" },
  amount_asc: { column: "r.amount", dir: "ASC", cast: "numeric" },
};

const SELECT = `SELECT r.receipt_address, r.signature, r.slot::text AS slot, r.block_time,
  r.block_time::text AS block_time_text, r.agent_wallet, l.label AS agent_label, r.owner,
  r.session_key, r.recipient, r.recipient_token, r.mint, r.amount::text AS amount, r.resource_id,
  COALESCE(r.resource, res.resource) AS resource, r.nonce, r.fee_payer, r.network
FROM receipts r
LEFT JOIN resources res ON res.resource_id = r.resource_id
LEFT JOIN agent_labels l ON l.agent_wallet = r.agent_wallet AND l.owner = r.owner`;

export function buildReceiptWhere(
  owner: string,
  f: ReceiptFilter,
): { clauses: string[]; params: unknown[] } {
  const params: unknown[] = [owner];
  const clauses = ["r.owner = $1"];
  const add = (sql: (n: string) => string, value: unknown) => {
    params.push(value);
    clauses.push(sql(`$${params.length}`));
  };
  if (f.agent) add((n) => `r.agent_wallet = ${n}`, f.agent);
  if (f.resource) add((n) => `r.resource_id = ${n}`, resolveResourceId(f.resource));
  if (f.from) add((n) => `r.block_time >= ${n}`, f.from);
  if (f.to) add((n) => `r.block_time < ${n}`, f.to);
  if (f.search) {
    const term = escapeLike(f.search);
    params.push(`${term}%`, `%${term}%`);
    const prefix = `$${params.length - 1}`;
    const contains = `$${params.length}`;
    clauses.push(
      `(r.signature ILIKE ${prefix} OR r.receipt_address ILIKE ${prefix}
        OR r.agent_wallet ILIKE ${prefix} OR r.recipient ILIKE ${prefix} OR r.nonce ILIKE ${prefix}
        OR COALESCE(r.resource, res.resource) ILIKE ${contains} OR l.label ILIKE ${contains})`,
    );
  }
  return { clauses, params };
}

export interface ReceiptPage {
  receipts: ReceiptView[];
  nextCursor: string | null;
}

/** One page of the owner's receipts in keyset order. */
export async function listReceipts(
  pool: Pool,
  network: NetworkConfig,
  owner: string,
  f: ReceiptFilter,
  opts: { limit: number; cursor?: string | undefined },
): Promise<ReceiptPage> {
  if (f.from && f.to && f.from.getTime() >= f.to.getTime()) {
    throw new ApiError(400, "invalid_query", "from must be earlier than to.");
  }
  const { clauses, params } = buildReceiptWhere(owner, f);
  const order = ORDER[f.sort];
  if (opts.cursor) {
    const cursor = decodeCursor(opts.cursor, f.sort);
    params.push(cursor.k, cursor.a);
    const cmp = order.dir === "DESC" ? "<" : ">";
    clauses.push(
      `(${order.column}, r.receipt_address) ${cmp} ($${params.length - 1}::${order.cast}, $${params.length})`,
    );
  }
  params.push(opts.limit + 1);
  const sql = `${SELECT}
WHERE ${clauses.join(" AND ")}
ORDER BY ${order.column} ${order.dir}, r.receipt_address ${order.dir}
LIMIT $${params.length}`;
  const { rows } = await pool.query<ReceiptRow>(sql, params);
  const page = rows.slice(0, opts.limit);
  const last = page[page.length - 1];
  const more = rows.length > opts.limit && last !== undefined;
  return {
    receipts: page.map((r) => toReceiptView(r, network)),
    nextCursor: more
      ? encodeCursor({
          s: f.sort,
          k: f.sort === "newest" || f.sort === "oldest" ? last.block_time_text : last.amount,
          a: last.receipt_address,
        })
      : null,
  };
}
