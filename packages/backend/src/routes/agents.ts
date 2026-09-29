import { Hono } from "hono";
import { z } from "zod";
import { requireOwner } from "../auth/middleware.js";
import type { AppEnv, Services } from "../context.js";
import { ApiError } from "../errors.js";
import { readAddressParam, readJson } from "../validation.js";

const labelBody = z.object({
  label: z
    .string({ error: "is required" })
    .trim()
    .min(1, "is required")
    .max(64, "must be 64 characters or fewer"),
});

export function agentRoutes(s: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.put("/:address/label", requireOwner(s, { apiKey: false }), async (c) => {
    const address = readAddressParam(c, "address");
    const { label } = await readJson(c, labelBody);
    const owner = c.get("owner");
    if (!(await s.directory.isOwnedBy(address, owner))) {
      throw new ApiError(
        403,
        "not_agent_owner",
        "This agent wallet does not belong to the signed-in owner. Sign in with the wallet that created it.",
      );
    }
    const { rows } = await s.pool.query<{ agent_wallet: string; label: string }>(
      `INSERT INTO agent_labels (agent_wallet, owner, label, created_at) VALUES ($1, $2, $3, $4)
       ON CONFLICT (agent_wallet) DO UPDATE SET label = EXCLUDED.label, owner = EXCLUDED.owner
       RETURNING agent_wallet, label`,
      [address, owner, label, s.clock()],
    );
    const row = rows[0];
    if (!row) throw new Error("Upsert into agent_labels returned no row");
    return c.json({ agentWallet: row.agent_wallet, label: row.label });
  });

  return app;
}
