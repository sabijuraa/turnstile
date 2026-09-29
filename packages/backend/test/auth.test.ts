import { Keypair } from "@solana/web3.js";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { sha256Hex } from "../src/auth/crypto.js";
import {
  closePool,
  type Harness,
  harness,
  jsonPost,
  resetDb,
  signIn,
  signMessage,
} from "./helpers.js";

interface Challenge {
  pubkey: string;
  nonce: string;
  message: string;
  issuedAt: string;
  expiresAt: string;
}

async function challenge(h: Harness, kp: Keypair): Promise<Challenge> {
  const res = await h.app.request(
    "/v1/auth/challenge",
    jsonPost({ pubkey: kp.publicKey.toBase58() }),
  );
  expect(res.status).toBe(200);
  return (await res.json()) as Challenge;
}

function verify(h: Harness, kp: Keypair, nonce: string, signature: string) {
  return h.app.request(
    "/v1/auth/verify",
    jsonPost({ pubkey: kp.publicKey.toBase58(), nonce, signature }),
  );
}

describe("owner sign-in", () => {
  let h: Harness;
  beforeEach(async () => {
    h = await harness();
    await resetDb(h.pool);
  });
  afterAll(closePool);

  it("issues a readable message with domain, pubkey, nonce, issued-at and expiry", async () => {
    const kp = Keypair.generate();
    const c = await challenge(h, kp);
    expect(c.message).toContain("localhost:3000 wants you to sign in with your Solana account:");
    expect(c.message).toContain(kp.publicKey.toBase58());
    expect(c.message).toContain(`Nonce: ${c.nonce}`);
    expect(c.message).toContain("Issued At: 2026-09-29T12:30:00.000Z");
    expect(c.message).toContain("Expiration Time: 2026-09-29T12:35:00.000Z");
    expect(c.expiresAt).toBe("2026-09-29T12:35:00.000Z");
  });

  it("signs in with a valid signature, sets an httpOnly cookie and stores only the hash", async () => {
    const kp = Keypair.generate();
    const c = await challenge(h, kp);
    const res = await verify(h, kp, c.nonce, signMessage(c.message, kp));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      owner: kp.publicKey.toBase58(),
      expiresAt: "2026-09-30T00:30:00.000Z",
    });
    const cookie = res.headers.get("set-cookie") ?? "";
    expect(cookie).toMatch(/^turnstile_session=[A-Za-z0-9_-]{43};/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).not.toContain("Secure");
    const token = /turnstile_session=([^;]+)/.exec(cookie)?.[1] ?? "";
    const stored = await h.pool.query("SELECT token_hash FROM console_sessions");
    expect(stored.rows).toEqual([{ token_hash: sha256Hex(token) }]);

    const me = await h.app.request("/v1/me", { headers: { cookie: `turnstile_session=${token}` } });
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({
      owner: kp.publicKey.toBase58(),
      authMethod: "session",
      network: "localnet",
    });
  });

  it("marks the cookie Secure when COOKIE_SECURE is on", async () => {
    const secure = await harness({ config: { cookieSecure: true } });
    const kp = Keypair.generate();
    const c = await challenge(secure, kp);
    const res = await verify(secure, kp, c.nonce, signMessage(c.message, kp));
    expect(res.headers.get("set-cookie")).toContain("Secure");
  });

  it("rejects a signature from a different key", async () => {
    const kp = Keypair.generate();
    const c = await challenge(h, kp);
    const res = await verify(h, kp, c.nonce, signMessage(c.message, Keypair.generate()));
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({
      error: {
        code: "bad_signature",
        message:
          "The signature does not match the sign-in message for this wallet. Sign the message exactly as issued with the same wallet.",
      },
    });
    expect(res.headers.get("set-cookie")).toBeNull();
  });

  it("rejects a signature over a changed message", async () => {
    const kp = Keypair.generate();
    const c = await challenge(h, kp);
    const tampered = c.message.replace("localhost:3000", "evil.example");
    const res = await verify(h, kp, c.nonce, signMessage(tampered, kp));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("bad_signature");
  });

  it("rejects a signature that is not 64 bytes of base58", async () => {
    const kp = Keypair.generate();
    const c = await challenge(h, kp);
    const res = await verify(h, kp, c.nonce, "abc0OIl");
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "invalid_signature_encoding",
    );
  });

  it("refuses to reuse a nonce", async () => {
    const kp = Keypair.generate();
    const c = await challenge(h, kp);
    const sig = signMessage(c.message, kp);
    expect((await verify(h, kp, c.nonce, sig)).status).toBe(200);
    const again = await verify(h, kp, c.nonce, sig);
    expect(again.status).toBe(401);
    expect(((await again.json()) as { error: { code: string } }).error.code).toBe("challenge_used");
    expect((await h.pool.query("SELECT 1 FROM console_sessions")).rowCount).toBe(1);
  });

  it("refuses an expired challenge", async () => {
    const kp = Keypair.generate();
    const c = await challenge(h, kp);
    h.clock.now = new Date(h.clock.now.getTime() + 301_000);
    const res = await verify(h, kp, c.nonce, signMessage(c.message, kp));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "challenge_expired",
    );
  });

  it("refuses a nonce issued to another wallet", async () => {
    const a = Keypair.generate();
    const b = Keypair.generate();
    const c = await challenge(h, a);
    const res = await verify(h, b, c.nonce, signMessage(c.message, b));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "unknown_challenge",
    );
  });

  it("rejects an invalid pubkey with a clear message", async () => {
    const res = await h.app.request("/v1/auth/challenge", jsonPost({ pubkey: "not-a-key" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: { code: "invalid_request", message: "pubkey must be a base58 Solana address." },
    });
  });

  it("signs out and the old cookie stops working", async () => {
    const cookie = await signIn(h);
    const out = await h.app.request("/v1/auth/signout", {
      method: "POST",
      headers: { cookie },
    });
    expect(out.status).toBe(200);
    expect(out.headers.get("set-cookie")).toContain("turnstile_session=;");
    const me = await h.app.request("/v1/me", { headers: { cookie } });
    expect(me.status).toBe(401);
  });

  it("expires sessions after their lifetime", async () => {
    const cookie = await signIn(h);
    h.clock.now = new Date(h.clock.now.getTime() + 12 * 60 * 60 * 1000 + 1000);
    const me = await h.app.request("/v1/me", { headers: { cookie } });
    expect(me.status).toBe(401);
    expect(((await me.json()) as { error: { code: string } }).error.code).toBe("session_expired");
  });

  it("answers 401 without a session", async () => {
    const me = await h.app.request("/v1/me");
    expect(me.status).toBe(401);
    expect(((await me.json()) as { error: { code: string } }).error.code).toBe("unauthenticated");
  });

  it("blocks a cookie write from another origin", async () => {
    const cookie = await signIn(h);
    const res = await h.app.request(
      "/v1/api-keys",
      jsonPost({ name: "ci" }, { cookie, origin: "https://evil.example" }),
    );
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      "origin_not_allowed",
    );
  });
});
