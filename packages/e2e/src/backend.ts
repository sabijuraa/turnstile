import { ed25519 } from "@noble/curves/ed25519.js";
import type { Keypair } from "@solana/web3.js";
import bs58 from "bs58";

export interface BackendSession {
  cookie: string;
  get(path: string): Promise<Response>;
}

/**
 * Signs in to the console backend the way the browser does. It asks for a challenge, signs the
 * message bytes with the owner key and exchanges the signature for a session cookie.
 */
export async function signIn(
  backendUrl: string,
  webOrigin: string,
  owner: Keypair,
): Promise<BackendSession> {
  const headers = { "content-type": "application/json", origin: webOrigin };
  const pubkey = owner.publicKey.toBase58();
  const challengeRes = await fetch(`${backendUrl}/v1/auth/challenge`, {
    method: "POST",
    headers,
    body: JSON.stringify({ pubkey }),
  });
  if (challengeRes.status !== 200) {
    throw new Error(
      `POST /v1/auth/challenge answered ${challengeRes.status}: ${await challengeRes.text()}`,
    );
  }
  const challenge = (await challengeRes.json()) as { nonce: string; message: string };
  const signature = ed25519.sign(
    new TextEncoder().encode(challenge.message),
    owner.secretKey.slice(0, 32),
  );
  const verifyRes = await fetch(`${backendUrl}/v1/auth/verify`, {
    method: "POST",
    headers,
    body: JSON.stringify({ pubkey, nonce: challenge.nonce, signature: bs58.encode(signature) }),
  });
  if (verifyRes.status !== 200) {
    throw new Error(`POST /v1/auth/verify answered ${verifyRes.status}: ${await verifyRes.text()}`);
  }
  const setCookie = verifyRes.headers.get("set-cookie") ?? "";
  const match = /turnstile_session=([^;]+)/.exec(setCookie);
  if (!match?.[1]) {
    throw new Error(
      `POST /v1/auth/verify set no turnstile_session cookie. Set-Cookie was "${setCookie}".`,
    );
  }
  const cookie = `turnstile_session=${match[1]}`;
  return {
    cookie,
    get: (path: string) => fetch(`${backendUrl}${path}`, { headers: { cookie } }),
  };
}
