import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { z } from "zod";
import { apiKeyDisplayPrefix, newApiKey, sha256Hex } from "../auth/crypto.js";
import { requireOwner } from "../auth/middleware.js";
import type { AppEnv, Services } from "../context.js";
import { ApiError } from "../errors.js";
import { readJson } from "../validation.js";

const MAX_ACTIVE_KEYS = 25;

const createBody = z.object({
  name: z
    .string({ error: "is required" })
    .trim()
    .min(1, "is required")
    .max(64, "must be 64 characters or fewer"),
});

interface ApiKeyRow {
  id: string;
  name: string;
  prefix: string;
  created_at: Date;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

export interface ApiKeyView {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  status: "active" | "revoked";
}

function view(r: ApiKeyRow): ApiKeyView {
  return {
    id: r.id,
    name: r.name,
    prefix: r.prefix,
    createdAt: r.created_at.toISOString(),
    lastUsedAt: r.last_used_at?.toISOString() ?? null,
    revokedAt: r.revoked_at?.toISOString() ?? null,
    status: r.revoked_at ? "revoked" : "active",
  };
}

const COLUMNS = "id, name, prefix, created_at, last_used_at, revoked_at";

/** Console API keys. Managing keys always needs a signed-in session, never another key. */
export function apiKeyRoutes(s: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use("*", requireOwner(s, { apiKey: false }));

  app.get("/", async (c) => {
    const { rows } = await s.pool.query<ApiKeyRow>(
      `SELECT ${COLUMNS} FROM api_keys WHERE owner = $1
       ORDER BY revoked_at IS NOT NULL, created_at DESC`,
      [c.get("owner")],
    );
    return c.json({ apiKeys: rows.map(view) });
  });

  app.post("/", async (c) => {
    const { name } = await readJson(c, createBody);
    const owner = c.get("owner");
    const active = await s.pool.query<{ n: string }>(
      "SELECT count(*) AS n FROM api_keys WHERE owner = $1 AND revoked_at IS NULL",
      [owner],
    );
    if (Number(active.rows[0]?.n ?? 0) >= MAX_ACTIVE_KEYS) {
      throw new ApiError(
        409,
        "too_many_api_keys",
        `You already have ${MAX_ACTIVE_KEYS} active API keys. Revoke one you no longer use and try again.`,
      );
    }
    const key = newApiKey();
    const { rows } = await s.pool.query<ApiKeyRow>(
      `INSERT INTO api_keys (id, owner, name, prefix, key_hash, created_at)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING ${COLUMNS}`,
      [`key_${randomUUID()}`, owner, name, apiKeyDisplayPrefix(key), sha256Hex(key), s.clock()],
    );
    const row = rows[0];
    if (!row) throw new Error("Insert into api_keys returned no row");
    s.metrics.apiKeysCreated.inc();
    c.get("log").info({ owner, keyId: row.id }, "api key created");
    return c.json(
      {
        apiKey: view(row),
        key,
        notice: "Copy this key now. It is shown only once and cannot be recovered.",
      },
      201,
    );
  });

  app.delete("/:id", async (c) => {
    const owner = c.get("owner");
    const id = c.req.param("id");
    const { rows } = await s.pool.query<ApiKeyRow>(
      `UPDATE api_keys SET revoked_at = COALESCE(revoked_at, $3)
       WHERE id = $1 AND owner = $2 RETURNING ${COLUMNS}`,
      [id, owner, s.clock()],
    );
    const row = rows[0];
    if (!row) {
      throw new ApiError(
        404,
        "api_key_not_found",
        "No API key with this id belongs to your account. Refresh the key list and try again.",
      );
    }
    s.metrics.apiKeysRevoked.inc();
    c.get("log").info({ owner, keyId: id }, "api key revoked");
    return c.json({ apiKey: view(row) });
  });

  return app;
}
