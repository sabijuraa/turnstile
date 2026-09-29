import { PublicKey } from "@solana/web3.js";
import { Hono } from "hono";
import { z } from "zod";
import { requireOwner } from "../auth/middleware.js";
import {
  detailAgent,
  labelsFor,
  listOwnerWalletAccounts,
  loadOwnedWallet,
  summarizeAgent,
  vaultBalances,
} from "../chain/agents.js";
import { mintDecimals } from "../chain/amounts.js";
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
  const decimals = mintDecimals(s.config);

  app.get("/", requireOwner(s, { apiKey: true }), async (c) => {
    const owner = c.get("owner");
    const wallets = await listOwnerWalletAccounts(s.rpc, new PublicKey(owner));
    const balances = await vaultBalances(
      s.rpc,
      wallets.map((w) => w.address),
    );
    const labels = await labelsFor(s.pool, owner);
    const now = s.clock();
    return c.json({
      agents: wallets.map((w, i) =>
        summarizeAgent(
          w,
          balances[i] ?? 0n,
          labels.get(w.address.toBase58()) ?? null,
          now,
          decimals,
        ),
      ),
    });
  });

  app.get("/:address", requireOwner(s, { apiKey: true }), async (c) => {
    const address = readAddressParam(c, "address");
    const owner = c.get("owner");
    const wallet = await loadOwnedWallet(s.rpc, address, owner);
    const [balance] = await vaultBalances(s.rpc, [wallet.address]);
    const labels = await labelsFor(s.pool, owner);
    return c.json({
      agent: await detailAgent(
        s.pool,
        wallet,
        balance ?? 0n,
        labels.get(address) ?? null,
        s.clock(),
        decimals,
      ),
    });
  });

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
