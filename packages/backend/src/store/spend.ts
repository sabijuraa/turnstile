import { formatUnits } from "@turnstile/shared";
import type { Pool } from "pg";
import type { Window } from "./range.js";

export interface SpendPoint {
  start: string;
  amount: string;
  displayAmount: string;
  count: number;
}

export interface SpendSeries {
  range: Window["range"];
  bucket: Window["bucket"];
  from: string;
  to: string;
  series: SpendPoint[];
  totals: { amount: string; displayAmount: string; count: number };
}

/** Spend per bucket over the window, with every empty bucket present as zero. */
export async function spendSeries(
  pool: Pool,
  owner: string,
  w: Window,
  agent?: string,
): Promise<SpendSeries> {
  const params: unknown[] = [owner, w.from, w.bucketCount, w.stepMs / 1000];
  let agentClause = "";
  if (agent) {
    params.push(agent);
    agentClause = `AND r.agent_wallet = $${params.length}`;
  }
  const { rows } = await pool.query<{ start: Date; amount: string; count: string }>(
    `WITH buckets AS (
       SELECT $2::timestamptz + (i * make_interval(secs => $4::double precision)) AS start
       FROM generate_series(0, $3::int - 1) AS i
     )
     SELECT b.start, COALESCE(sum(r.amount), 0)::text AS amount, count(r.receipt_address)::text AS count
     FROM buckets b
     LEFT JOIN receipts r
       ON r.owner = $1 ${agentClause}
      AND r.block_time >= b.start
      AND r.block_time < b.start + make_interval(secs => $4::double precision)
     GROUP BY b.start
     ORDER BY b.start`,
    params,
  );
  let total = 0n;
  let count = 0;
  const series = rows.map((r) => {
    const amount = BigInt(r.amount);
    total += amount;
    count += Number(r.count);
    return {
      start: r.start.toISOString(),
      amount: r.amount,
      displayAmount: formatUnits(amount),
      count: Number(r.count),
    };
  });
  return {
    range: w.range,
    bucket: w.bucket,
    from: w.from.toISOString(),
    to: w.to.toISOString(),
    series,
    totals: { amount: total.toString(), displayAmount: formatUnits(total), count },
  };
}
