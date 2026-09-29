import { formatUnits, networkByName } from "@turnstile/shared";
import { Hono } from "hono";
import { z } from "zod";
import { requireOwner } from "../auth/middleware.js";
import type { AppEnv, Services } from "../context.js";
import { rangeSchema, windowFor } from "../store/range.js";
import { listReceipts } from "../store/receipts.js";
import { spendSeries } from "../store/spend.js";
import { pubkeySchema, readQuery } from "../validation.js";

const spendQuery = z.object({ range: rangeSchema.default("7d"), agent: pubkeySchema.optional() });
const summaryQuery = z.object({ range: rangeSchema.default("7d") });

export function spendRoutes(s: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/", requireOwner(s, { apiKey: true }), async (c) => {
    const q = readQuery(c, spendQuery);
    return c.json(
      await spendSeries(s.pool, c.get("owner"), windowFor(q.range, s.clock()), q.agent),
    );
  });
  return app;
}

interface DeadLetterRow {
  id: string;
  agent_wallet: string;
  nonce: string;
  error: string;
  attempts: number;
  created_at: Date;
  updated_at: Date;
  amount: string | null;
  resource: string | null;
}

export function summaryRoutes(s: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const network = networkByName(s.config.network);
  app.get("/", requireOwner(s, { apiKey: true }), async (c) => {
    const { range } = readQuery(c, summaryQuery);
    const owner = c.get("owner");
    const w = windowFor(range, s.clock());
    const totals = await s.pool.query<{ amount: string; count: string; agents: string }>(
      `SELECT COALESCE(sum(amount), 0)::text AS amount, count(*)::text AS count,
              count(DISTINCT agent_wallet)::text AS agents
       FROM receipts WHERE owner = $1 AND block_time >= $2 AND block_time < $3`,
      [owner, w.from, w.to],
    );
    const t = totals.rows[0] ?? { amount: "0", count: "0", agents: "0" };
    const recent = await listReceipts(s.pool, network, owner, { sort: "newest" }, { limit: 8 });
    const wallets = await s.directory.walletsOf(owner);
    const failures = await s.pool.query<DeadLetterRow>(
      `SELECT id::text AS id, agent_wallet, nonce, error, attempts, created_at, updated_at,
              requirements->>'amount' AS amount, requirements->>'resource' AS resource
       FROM settlement_dead_letters
       WHERE status = 'pending' AND agent_wallet = ANY($1::text[])
       ORDER BY created_at DESC LIMIT 20`,
      [wallets],
    );
    const pendingCount = await s.pool.query<{ n: string }>(
      `SELECT count(*)::text AS n FROM settlement_dead_letters
       WHERE status = 'pending' AND agent_wallet = ANY($1::text[])`,
      [wallets],
    );
    const amount = BigInt(t.amount);
    return c.json({
      range: w.range,
      from: w.from.toISOString(),
      to: w.to.toISOString(),
      totalSpend: { amount: amount.toString(), displayAmount: formatUnits(amount) },
      settlementCount: Number(t.count),
      activeAgents: Number(t.agents),
      recentReceipts: recent.receipts,
      failures: {
        pendingCount: Number(pendingCount.rows[0]?.n ?? 0),
        items: failures.rows.map((f) => ({
          id: f.id,
          agentWallet: f.agent_wallet,
          nonce: f.nonce,
          error: f.error,
          attempts: f.attempts,
          amount: f.amount && /^\d+$/.test(f.amount) ? f.amount : null,
          displayAmount: f.amount && /^\d+$/.test(f.amount) ? formatUnits(BigInt(f.amount)) : null,
          resource: f.resource,
          createdAt: f.created_at.toISOString(),
          updatedAt: f.updated_at.toISOString(),
          status: "pending" as const,
        })),
      },
    });
  });
  return app;
}
