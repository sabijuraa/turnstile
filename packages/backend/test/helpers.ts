import { ed25519 } from "@noble/curves/ed25519.js";
import { Keypair, PublicKey } from "@solana/web3.js";
import { bytesToHex, randomNonce, resourceId } from "@turnstile/shared";
import { createPool, migrate } from "@turnstile/shared/db";
import bs58 from "bs58";
import type { Pool } from "pg";
import { createApp } from "../src/app.js";
import type { SolanaRpc } from "../src/chain/directory.js";
import type { Config } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { createMetrics } from "../src/metrics.js";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://turnstile_backend_test:turnstile_backend_test@127.0.0.1:5432/turnstile_backend_test";

export const WEB_ORIGIN = "http://localhost:3000";

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    databaseUrl: TEST_DATABASE_URL,
    network: "localnet",
    rpcUrl: "http://127.0.0.1:8899",
    deployment: null,
    webOrigin: WEB_ORIGIN,
    domain: "localhost:3000",
    cookieSecure: false,
    logLevel: "silent",
    challengeTtlSeconds: 300,
    sessionTtlSeconds: 12 * 60 * 60,
    confirmTimeoutMs: 30_000,
    ...overrides,
  };
}

/** A chain stand-in for tests that do not touch the programs. It knows no accounts. */
export function fakeRpc(opts: { slotError?: Error } = {}): SolanaRpc {
  const offline = async (): Promise<never> => {
    throw new Error("This test runs without a validator");
  };
  const rpc = {
    getSlot: async () => {
      if (opts.slotError) throw opts.slotError;
      return 1234;
    },
    getAccountInfo: async () => null,
    getProgramAccounts: async () => [],
    getMultipleAccountsInfo: async (keys: unknown[]) => keys.map(() => null),
    getLatestBlockhash: offline,
    getSignatureStatuses: offline,
    getTransaction: offline,
  };
  // The stand-in covers the overloads of Connection only as far as these tests call them.
  return rpc as unknown as SolanaRpc;
}

export interface Harness {
  pool: Pool;
  app: ReturnType<typeof createApp>["app"];
  metrics: ReturnType<typeof createMetrics>;
  clock: { now: Date };
}

let sharedPool: Pool | undefined;
let migrated = false;

export async function testPool(): Promise<Pool> {
  if (!sharedPool) sharedPool = createPool(TEST_DATABASE_URL, 5);
  if (!migrated) {
    await migrate(sharedPool);
    migrated = true;
  }
  return sharedPool;
}

export async function closePool(): Promise<void> {
  await sharedPool?.end();
  sharedPool = undefined;
  migrated = false;
}

export async function resetDb(pool: Pool): Promise<void> {
  await pool.query(
    `TRUNCATE receipts, resources, settlement_dead_letters, auth_challenges, console_sessions,
     api_keys, agent_labels, owners RESTART IDENTITY CASCADE`,
  );
}

export async function harness(
  opts: { now?: Date; realTime?: boolean; rpc?: SolanaRpc; config?: Partial<Config> } = {},
): Promise<Harness> {
  const pool = await testPool();
  const clock = { now: opts.now ?? new Date("2026-09-29T12:30:00.000Z") };
  const metrics = createMetrics(false);
  const { app } = createApp({
    pool,
    rpc: opts.rpc ?? fakeRpc(),
    config: testConfig(opts.config),
    clock: () => (opts.realTime ? new Date() : clock.now),
    logger: createLogger("silent"),
    metrics,
  });
  return { pool, app, metrics, clock };
}

export function jsonPost(body: unknown, headers: Record<string, string> = {}): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  };
}

export function signMessage(message: string, kp: Keypair): string {
  return bs58.encode(ed25519.sign(new TextEncoder().encode(message), kp.secretKey.slice(0, 32)));
}

/** Runs the full wallet sign-in and returns the session cookie header value. */
export async function signIn(h: Harness, kp: Keypair = Keypair.generate()): Promise<string> {
  const pubkey = kp.publicKey.toBase58();
  const ch = await h.app.request("/v1/auth/challenge", jsonPost({ pubkey }));
  const { nonce, message } = (await ch.json()) as { nonce: string; message: string };
  const res = await h.app.request(
    "/v1/auth/verify",
    jsonPost({ pubkey, nonce, signature: signMessage(message, kp) }),
  );
  if (res.status !== 200) throw new Error(`sign-in failed with ${res.status}`);
  const cookie = res.headers.get("set-cookie") ?? "";
  const token = /turnstile_session=([^;]+)/.exec(cookie)?.[1];
  if (!token) throw new Error("sign-in did not set a session cookie");
  return `turnstile_session=${token}`;
}

export const address = (): string => Keypair.generate().publicKey.toBase58();

export interface SeedReceipt {
  owner: string;
  agentWallet: string;
  amount: bigint;
  blockTime: Date;
  resource?: string;
  /** Store the resource string only in the resources table, as the facilitator does. */
  resourceInTableOnly?: boolean;
  receiptAddress?: string;
  signature?: string;
}

/** Inserts a receipt row as the indexer would. Test fixture only. */
export async function seedReceipt(pool: Pool, r: SeedReceipt): Promise<string> {
  const resource = r.resource ?? "https://demo.turnstile.dev/v1/summarize";
  const rid = bytesToHex(resourceId(resource));
  const receiptAddress = r.receiptAddress ?? address();
  if (r.resourceInTableOnly) {
    await pool.query(
      "INSERT INTO resources (resource_id, resource) VALUES ($1, $2) ON CONFLICT DO NOTHING",
      [rid, resource],
    );
  }
  await pool.query(
    `INSERT INTO receipts (receipt_address, signature, slot, block_time, agent_wallet, owner,
       session_key, recipient, recipient_token, mint, amount, resource_id, resource, nonce,
       fee_payer, network)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16)`,
    [
      receiptAddress,
      r.signature ?? bs58.encode(Keypair.generate().secretKey),
      Math.floor(r.blockTime.getTime() / 400),
      r.blockTime,
      r.agentWallet,
      r.owner,
      address(),
      address(),
      address(),
      new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU").toBase58(),
      r.amount.toString(),
      rid,
      r.resourceInTableOnly ? null : resource,
      bytesToHex(randomNonce()),
      address(),
      "solana:localnet",
    ],
  );
  return receiptAddress;
}
