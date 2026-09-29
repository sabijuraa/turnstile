import type { Context, MiddlewareHandler } from "hono";
import { getCookie } from "hono/cookie";
import type { AppEnv, Services } from "../context.js";
import { ApiError, unauthenticated } from "../errors.js";
import { API_KEY_PREFIX, sha256Hex } from "./crypto.js";

export const SESSION_COOKIE = "turnstile_session";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/** Resolves the owner behind a session token, or null when the token is unknown or expired. */
export async function ownerForSession(
  s: Services,
  token: string,
): Promise<{ owner: string; expired: boolean } | null> {
  const { rows } = await s.pool.query<{ owner: string; expires_at: Date }>(
    "SELECT owner, expires_at FROM console_sessions WHERE token_hash = $1",
    [sha256Hex(token)],
  );
  const row = rows[0];
  if (!row) return null;
  return { owner: row.owner, expired: row.expires_at.getTime() <= s.clock().getTime() };
}

async function authenticateApiKey(s: Services, c: Context<AppEnv>, key: string): Promise<void> {
  if (!key.startsWith(API_KEY_PREFIX)) {
    s.metrics.apiKeyAuth.inc({ result: "malformed" });
    throw new ApiError(
      401,
      "invalid_api_key",
      "The bearer token is not a Turnstile API key. Keys start with tsk_. Copy the full key from where you saved it.",
    );
  }
  const { rows } = await s.pool.query<{ id: string; owner: string; revoked_at: Date | null }>(
    "SELECT id, owner, revoked_at FROM api_keys WHERE key_hash = $1",
    [sha256Hex(key)],
  );
  const row = rows[0];
  if (!row) {
    s.metrics.apiKeyAuth.inc({ result: "unknown" });
    throw new ApiError(
      401,
      "invalid_api_key",
      "This API key is not recognized. Check that you copied the whole key or create a new one in console settings.",
    );
  }
  if (row.revoked_at) {
    s.metrics.apiKeyAuth.inc({ result: "revoked" });
    throw new ApiError(
      401,
      "api_key_revoked",
      "This API key was revoked. Create a new key in console settings and use it instead.",
    );
  }
  await s.pool.query("UPDATE api_keys SET last_used_at = $2 WHERE id = $1", [row.id, s.clock()]);
  s.metrics.apiKeyAuth.inc({ result: "ok" });
  c.set("owner", row.owner);
  c.set("authMethod", "api_key");
}

/**
 * Requires a signed-in owner. Read routes may also accept a console API key.
 * Cookie-authenticated writes must come from the web origin, which blocks cross-site requests.
 */
export function requireOwner(s: Services, opts: { apiKey: boolean }): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const header = c.req.header("authorization");
    if (header !== undefined) {
      const match = /^Bearer\s+(\S+)$/i.exec(header.trim());
      if (!match?.[1]) {
        throw new ApiError(
          401,
          "invalid_authorization",
          "The Authorization header must be Bearer followed by your API key.",
        );
      }
      if (!opts.apiKey) {
        throw new ApiError(
          403,
          "api_key_not_allowed",
          "API keys can only read receipts, spend and the summary. Sign in to the console to make this change.",
        );
      }
      await authenticateApiKey(s, c, match[1]);
      return next();
    }

    const token = getCookie(c, SESSION_COOKIE);
    if (!token) throw unauthenticated();
    const session = await ownerForSession(s, token);
    if (!session) throw unauthenticated();
    if (session.expired) {
      throw new ApiError(401, "session_expired", "Your console session expired. Sign in again.");
    }
    if (!SAFE_METHODS.has(c.req.method)) {
      const origin = c.req.header("origin");
      if (origin !== undefined && origin !== s.config.webOrigin) {
        throw new ApiError(
          403,
          "origin_not_allowed",
          `Requests that change data must come from ${s.config.webOrigin}. Open the console there and try again.`,
        );
      }
    }
    c.set("owner", session.owner);
    c.set("authMethod", "session");
    return next();
  };
}
