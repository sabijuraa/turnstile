/**
 * Captures the console backend examples shown in the API reference from a real run.
 *
 * Run it after capture.ts, with the indexer and the console backend pointed at the same
 * validator and database, so the receipts it reads are the payments capture.ts made.
 *
 *   SOLANA_RPC_URL=... DEPLOYMENT_FILE=... KEYS_DIR=... BACKEND_URL=... WEB_ORIGIN=... \
 *   tsx apps/web/src/app/docs/_examples/capture-console.ts
 */
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Connection, Transaction } from "@solana/web3.js";
import { readKeypairFile } from "@turnstile/sdk-agent";

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} before running the capture.`);
  return value;
};

const outDir = process.env.OUT_DIR ?? dirname(fileURLToPath(import.meta.url));
const backend = env("BACKEND_URL").replace(/\/+$/, "");
const origin = env("WEB_ORIGIN");
const connection = new Connection(env("SOLANA_RPC_URL"), "confirmed");
const owner = readKeypairFile(join(env("KEYS_DIR"), "demo-owner.json"));
const deployment = JSON.parse(readFileSync(env("DEPLOYMENT_FILE"), "utf8")) as {
  demoRecipient: string;
};
const capture = JSON.parse(readFileSync(join(outDir, "capture.json"), "utf8")) as {
  paymentTransaction: string;
};

const ALPHABET = "123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz";

function base58(bytes: Uint8Array): string {
  let n = 0n;
  for (const b of bytes) n = n * 256n + BigInt(b);
  let out = "";
  while (n > 0n) {
    out = ALPHABET[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = `1${out}`;
  }
  return out;
}

/** Signs like a wallet's signMessage, with Ed25519 over the UTF-8 bytes. */
function signMessage(message: string): string {
  const seed = Buffer.from(owner.secretKey.slice(0, 32));
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  return base58(sign(null, Buffer.from(message, "utf8"), key));
}

interface Recorded {
  request: { method: string; path: string; headers?: Record<string, string>; body?: unknown };
  status: number;
  headers?: Record<string, string>;
  response: unknown;
}

const recorded: Record<string, Recorded> = {};

async function call(
  name: string,
  method: string,
  path: string,
  opts: { body?: unknown; cookie?: string; apiKey?: string; show?: Record<string, string> } = {},
): Promise<{ status: number; body: unknown; res: Response }> {
  const headers: Record<string, string> = {};
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.cookie) headers.cookie = opts.cookie;
  if (opts.apiKey) headers.authorization = `Bearer ${opts.apiKey}`;
  if (method !== "GET") headers.origin = origin;
  const res = await fetch(`${backend}${path}`, {
    method,
    headers,
    ...(opts.body === undefined ? {} : { body: JSON.stringify(opts.body) }),
  });
  const type = res.headers.get("content-type") ?? "";
  const body: unknown = type.includes("json") ? await res.json() : await res.text();
  recorded[name] = {
    request: {
      method,
      path,
      ...(opts.show ? { headers: opts.show } : {}),
      ...(opts.body === undefined ? {} : { body: opts.body }),
    },
    status: res.status,
    response: body,
  };
  return { status: res.status, body, res };
}

async function main(): Promise<void> {
  const pubkey = owner.publicKey.toBase58();

  // Sign in with the owner wallet.
  const challenge = (
    await call("authChallenge", "POST", "/v1/auth/challenge", { body: { pubkey } })
  ).body as { nonce: string; message: string };
  const signature = signMessage(challenge.message);
  const verified = await call("authVerify", "POST", "/v1/auth/verify", {
    body: { pubkey, nonce: challenge.nonce, signature },
  });
  const setCookie = verified.res.headers.get("set-cookie") ?? "";
  const cookie = setCookie.split(";")[0] ?? "";
  const verify = recorded.authVerify;
  if (verify) {
    // The session token is a live credential, so only its attributes are kept.
    verify.headers = { "set-cookie": setCookie.replace(/=[^;]+/, "=<token>") };
  }
  await call("authReplay", "POST", "/v1/auth/verify", {
    body: { pubkey, nonce: challenge.nonce, signature },
  });

  const session = { cookie, show: { cookie: "turnstile_session=<token>" } };
  await call("me", "GET", "/v1/me", session);
  await call("meUnauthenticated", "GET", "/v1/me");

  // An API key for read access. It is revoked at the end, so the key shown here is dead.
  const created = await call("apiKeyCreate", "POST", "/v1/api-keys", {
    ...session,
    body: { name: "reporting job" },
  });
  const { key, apiKey } = created.body as { key: string; apiKey: { id: string } };
  const bearer = { apiKey: key, show: { authorization: `Bearer ${key}` } };
  await call("apiKeyList", "GET", "/v1/api-keys", session);

  const listed = await call("receipts", "GET", "/v1/receipts?limit=2", bearer);
  // The wallet with the newest receipt, so the label, CSV and policy examples show real spend.
  const newest = (listed.body as { receipts: { agentWallet: string; resource: string }[] })
    .receipts[0];
  if (!newest) throw new Error("No receipts are indexed yet. Run the indexer and pay first.");
  const agentWallet = newest.agentWallet;
  await call("receiptsBadQuery", "GET", "/v1/receipts?limit=500", bearer);
  await call("spend", "GET", "/v1/spend?range=24h", bearer);
  await call("summary", "GET", "/v1/summary?range=24h", bearer);
  await call("agents", "GET", "/v1/agents", session);
  await call("agent", "GET", `/v1/agents/${agentWallet}`, session);
  await call("agentLabel", "PUT", `/v1/agents/${agentWallet}/label`, {
    ...session,
    body: { label: "research bot" },
  });
  await call("apiKeyNotAllowed", "POST", "/v1/tx/update-policy", {
    ...bearer,
    body: {},
  });

  // An owner transaction built by the backend, signed here as a wallet would, then confirmed.
  const built = await call("txUpdatePolicy", "POST", "/v1/tx/update-policy", {
    ...session,
    body: {
      agentWallet: agentWallet,
      perCallCap: "0.01",
      dailyCap: "2",
      allowList: [
        {
          resource: newest.resource,
          recipient: deployment.demoRecipient,
        },
      ],
    },
  });
  const unsigned = (built.body as { transactions: { transaction: string }[] }).transactions[0];
  if (!unsigned) throw new Error("The backend built no transaction.");
  const tx = Transaction.from(Buffer.from(unsigned.transaction, "base64"));
  tx.partialSign(owner);
  const sent = await connection.sendRawTransaction(tx.serialize());
  await call("txConfirm", "POST", "/v1/tx/confirm", { ...session, body: { signature: sent } });
  await call("txConfirmPayment", "POST", "/v1/tx/confirm", {
    ...session,
    body: { signature: capture.paymentTransaction },
  });

  await call("apiKeyRevoke", "DELETE", `/v1/api-keys/${apiKey.id}`, session);
  await call("apiKeyRevoked", "GET", "/v1/receipts?limit=1", bearer);

  const csv = await fetch(`${backend}/v1/receipts.csv?agent=${agentWallet}`, {
    headers: { cookie },
  });
  recorded.receiptsCsv = {
    request: { method: "GET", path: `/v1/receipts.csv?agent=${agentWallet}` },
    status: csv.status,
    headers: {
      "content-type": csv.headers.get("content-type") ?? "",
      "content-disposition": csv.headers.get("content-disposition") ?? "",
    },
    response: await csv.text(),
  };

  writeFileSync(
    join(outDir, "console.json"),
    `${JSON.stringify({ capturedAt: new Date().toISOString(), backend, ...recorded }, null, 2)}\n`,
  );
  console.warn(`wrote console.json with ${Object.keys(recorded).length} exchanges`);
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
