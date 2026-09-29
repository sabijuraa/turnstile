import { ed25519 } from "@noble/curves/ed25519.js";
import { PublicKey } from "@solana/web3.js";
import bs58 from "bs58";
import { Hono } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { z } from "zod";
import { randomBase58, randomToken, sha256Hex } from "../auth/crypto.js";
import { buildSignInMessage } from "../auth/message.js";
import { requireOwner, SESSION_COOKIE } from "../auth/middleware.js";
import type { AppEnv, Services } from "../context.js";
import { ApiError } from "../errors.js";
import { pubkeySchema, readJson } from "../validation.js";

const challengeBody = z.object({ pubkey: pubkeySchema });

const verifyBody = z.object({
  pubkey: pubkeySchema,
  nonce: z.string().min(1, "is required").max(64, "is too long"),
  signature: z.string().min(1, "is required").max(200, "is too long"),
});

function decodeSignature(value: string): Uint8Array {
  let bytes: Uint8Array;
  try {
    bytes = bs58.decode(value);
  } catch {
    throw new ApiError(
      400,
      "invalid_signature_encoding",
      "signature must be the 64 byte wallet signature encoded as base58.",
    );
  }
  if (bytes.length !== 64) {
    throw new ApiError(
      400,
      "invalid_signature_encoding",
      `signature decodes to ${bytes.length} bytes. It must be the 64 byte wallet signature in base58.`,
    );
  }
  return bytes;
}

export function authRoutes(s: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.post("/challenge", async (c) => {
    const { pubkey } = await readJson(c, challengeBody);
    const now = s.clock();
    const expiresAt = new Date(now.getTime() + s.config.challengeTtlSeconds * 1000);
    const nonce = randomBase58(16);
    const message = buildSignInMessage({
      domain: s.config.domain,
      uri: s.config.webOrigin,
      pubkey,
      network: s.config.network,
      nonce,
      issuedAt: now,
      expiresAt,
    });
    await s.pool.query("DELETE FROM auth_challenges WHERE expires_at < $1", [
      new Date(now.getTime() - 24 * 60 * 60 * 1000),
    ]);
    await s.pool.query(
      "INSERT INTO auth_challenges (nonce, pubkey, message, expires_at) VALUES ($1, $2, $3, $4)",
      [nonce, pubkey, message, expiresAt],
    );
    return c.json({
      pubkey,
      nonce,
      message,
      issuedAt: now.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
  });

  app.post("/verify", async (c) => {
    const body = await readJson(c, verifyBody);
    const signature = decodeSignature(body.signature);
    const { rows } = await s.pool.query<{
      pubkey: string;
      message: string;
      expires_at: Date;
      used: boolean;
    }>("SELECT pubkey, message, expires_at, used FROM auth_challenges WHERE nonce = $1", [
      body.nonce,
    ]);
    const challenge = rows[0];
    const fail = (status: 400 | 401, code: string, message: string): never => {
      s.metrics.signIns.inc({ result: code });
      throw new ApiError(status, code, message);
    };
    if (!challenge || challenge.pubkey !== body.pubkey) {
      return fail(
        401,
        "unknown_challenge",
        "This sign-in request was not issued for this wallet. Start sign-in again.",
      );
    }
    if (challenge.used) {
      return fail(
        401,
        "challenge_used",
        "This sign-in request was already used. Start sign-in again to get a fresh one.",
      );
    }
    if (challenge.expires_at.getTime() <= s.clock().getTime()) {
      return fail(
        401,
        "challenge_expired",
        "This sign-in request expired. Start sign-in again and approve it in your wallet within 5 minutes.",
      );
    }
    let valid = false;
    try {
      valid = ed25519.verify(
        signature,
        new TextEncoder().encode(challenge.message),
        new PublicKey(body.pubkey).toBytes(),
      );
    } catch {
      valid = false;
    }
    if (!valid) {
      return fail(
        401,
        "bad_signature",
        "The signature does not match the sign-in message for this wallet. Sign the message exactly as issued with the same wallet.",
      );
    }
    const claimed = await s.pool.query(
      "UPDATE auth_challenges SET used = true WHERE nonce = $1 AND used = false",
      [body.nonce],
    );
    if (claimed.rowCount !== 1) {
      return fail(
        401,
        "challenge_used",
        "This sign-in request was already used. Start sign-in again to get a fresh one.",
      );
    }

    const now = s.clock();
    const token = randomToken();
    const expiresAt = new Date(now.getTime() + s.config.sessionTtlSeconds * 1000);
    await s.pool.query(
      `INSERT INTO owners (pubkey, created_at, last_seen_at) VALUES ($1, $2, $2)
       ON CONFLICT (pubkey) DO UPDATE SET last_seen_at = EXCLUDED.last_seen_at`,
      [body.pubkey, now],
    );
    await s.pool.query(
      "INSERT INTO console_sessions (token_hash, owner, created_at, expires_at) VALUES ($1, $2, $3, $4)",
      [sha256Hex(token), body.pubkey, now, expiresAt],
    );
    setCookie(c, SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "Lax",
      secure: s.config.cookieSecure,
      path: "/",
      maxAge: s.config.sessionTtlSeconds,
    });
    s.metrics.signIns.inc({ result: "ok" });
    c.get("log").info({ owner: body.pubkey }, "owner signed in");
    return c.json({ owner: body.pubkey, expiresAt: expiresAt.toISOString() });
  });

  app.post("/signout", async (c) => {
    const token = getCookie(c, SESSION_COOKIE);
    if (token) {
      await s.pool.query("DELETE FROM console_sessions WHERE token_hash = $1", [sha256Hex(token)]);
    }
    deleteCookie(c, SESSION_COOKIE, { path: "/", secure: s.config.cookieSecure });
    return c.json({ signedOut: true });
  });

  return app;
}

export function meRoutes(s: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.get("/", requireOwner(s, { apiKey: true }), async (c) => {
    const owner = c.get("owner");
    const { rows } = await s.pool.query<{ created_at: Date; last_seen_at: Date }>(
      "SELECT created_at, last_seen_at FROM owners WHERE pubkey = $1",
      [owner],
    );
    const row = rows[0];
    return c.json({
      owner,
      authMethod: c.get("authMethod"),
      network: s.config.network,
      createdAt: row?.created_at.toISOString() ?? null,
      lastSeenAt: row?.last_seen_at.toISOString() ?? null,
    });
  });
  return app;
}
