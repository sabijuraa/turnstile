/** Shared pieces of the real-validator tests. A private validator, real settlements, the built indexer as a child process. */
import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  type PublicKey,
  sendAndConfirmTransaction,
  Transaction,
} from "@solana/web3.js";
import {
  AGENT_WALLET_PROGRAM_ID,
  agentWalletAddress,
  bytesToHex,
  type PaymentAuthorization,
  randomNonce,
  resourceId,
  SETTLEMENT_PROGRAM_ID,
  signAuthorization,
} from "@turnstile/shared";
import { createPool, migrate } from "@turnstile/shared/db";
import {
  createWalletInstruction,
  decodeReceipt,
  depositInstruction,
  settleInstructions,
  settlementCoder,
  updatePolicyInstruction,
} from "@turnstile/shared/programs";
import { testDatabaseAdminUrl } from "@turnstile/shared/testing";
import pg from "pg";
import { expect } from "vitest";

const here = dirname(fileURLToPath(import.meta.url));
const pkgDir = join(here, "..", "..");
const repoRoot = join(pkgDir, "..", "..");
export const RPC_PORT = Number(process.env.IT_RPC_PORT ?? 8999);
export const RPC_URL = `http://127.0.0.1:${RPC_PORT}`;
export const HTTP_PORT = Number(process.env.IT_INDEXER_PORT ?? 14023);
export const ADMIN_URL = process.env.IT_ADMIN_DATABASE_URL ?? testDatabaseAdminUrl();
export const IT_DB = "turnstile_indexer_it";
export const DATABASE_URL = ADMIN_URL.replace(/\/[^/]+$/, `/${IT_DB}`);
const RESOURCE = "https://demo.turnstile.dev/v1/summarize";
export const workDir = mkdtempSync(join(tmpdir(), "turnstile-indexer-it-"));

export const enabled = process.env.INDEXER_IT === "1";

export function log(msg: string): void {
  process.stdout.write(`[it] ${msg}\n`);
}

export async function waitFor<T>(
  what: string,
  fn: () => Promise<T | undefined>,
  ms = 60_000,
): Promise<T> {
  const until = Date.now() + ms;
  let last: unknown;
  while (Date.now() < until) {
    try {
      const v = await fn();
      if (v !== undefined) return v;
    } catch (err) {
      last = err;
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`Timed out waiting for ${what}. Last error ${String(last)}`);
}

export interface Validator {
  proc: ChildProcess;
  ledger: string;
}

export async function startValidator(name: string, extraArgs: string[] = []): Promise<Validator> {
  const ledger = join(workDir, name);
  const so = (p: string) => join(repoRoot, "target", "deploy", p);
  for (const f of ["agent_wallet.so", "settlement.so"]) {
    if (!existsSync(so(f))) throw new Error(`${so(f)} is missing. Build the programs first.`);
  }
  const proc = spawn(
    "solana-test-validator",
    [
      "--ledger",
      ledger,
      "--reset",
      "--quiet",
      "--rpc-port",
      String(RPC_PORT),
      "--faucet-port",
      String(RPC_PORT + 991),
      "--gossip-port",
      String(RPC_PORT - 198),
      "--dynamic-port-range",
      `${RPC_PORT - 197}-${RPC_PORT - 165}`,
      "--bpf-program",
      AGENT_WALLET_PROGRAM_ID.toBase58(),
      so("agent_wallet.so"),
      "--bpf-program",
      SETTLEMENT_PROGRAM_ID.toBase58(),
      so("settlement.so"),
      ...extraArgs,
    ],
    { stdio: ["ignore", "ignore", "inherit"] },
  );
  const conn = new Connection(RPC_URL, "confirmed");
  await waitFor("the validator", async () => ((await conn.getSlot()) > 1 ? true : undefined));
  log(`validator ${name} up on ${RPC_URL}, genesis ${await conn.getGenesisHash()}`);
  return { proc, ledger };
}

export async function stopValidator(v: Validator): Promise<void> {
  if (v.proc.exitCode === null) {
    const exited = new Promise((r) => v.proc.once("exit", r));
    v.proc.kill("SIGTERM");
    await exited;
  }
}

export interface Chain {
  conn: Connection;
  feePayer: Keypair;
  owner: Keypair;
  session: Keypair;
  recipient: Keypair;
  mint: PublicKey;
  agentWallet: PublicKey;
  rid: Uint8Array;
}

async function airdrop(conn: Connection, key: PublicKey): Promise<void> {
  const sig = await conn.requestAirdrop(key, 100 * LAMPORTS_PER_SOL);
  const latest = await conn.getLatestBlockhash("confirmed");
  await conn.confirmTransaction({ signature: sig, ...latest }, "confirmed");
}

export async function setupChain(): Promise<Chain> {
  const conn = new Connection(RPC_URL, "confirmed");
  const [feePayer, owner, session, recipient] = [0, 1, 2, 3].map(() => Keypair.generate()) as [
    Keypair,
    Keypair,
    Keypair,
    Keypair,
  ];
  await airdrop(conn, feePayer.publicKey);
  await airdrop(conn, owner.publicKey);
  const mint = await createMint(conn, owner, owner.publicKey, null, 6, undefined, {
    commitment: "confirmed",
  });
  const ownerToken = await getOrCreateAssociatedTokenAccount(
    conn,
    owner,
    mint,
    owner.publicKey,
    false,
    "confirmed",
  );
  await getOrCreateAssociatedTokenAccount(
    conn,
    owner,
    mint,
    recipient.publicKey,
    false,
    "confirmed",
  );
  await mintTo(conn, owner, mint, ownerToken.address, owner, 1_000_000_000n, [], {
    commitment: "confirmed",
  });
  const id = 1n;
  const [agentWallet] = agentWalletAddress(owner.publicKey, id);
  const rid = resourceId(RESOURCE);
  const tx = new Transaction().add(
    createWalletInstruction({
      owner: owner.publicKey,
      mint,
      id,
      perCallCap: 50_000n,
      dailyCap: 100_000_000n,
      sessionKey: session.publicKey,
      sessionExpiresAt: 0n,
    }),
    depositInstruction({
      owner: owner.publicKey,
      agentWallet,
      ownerToken: ownerToken.address,
      amount: 500_000_000n,
    }),
    updatePolicyInstruction({
      owner: owner.publicKey,
      agentWallet,
      perCallCap: 50_000n,
      dailyCap: 100_000_000n,
      allowList: [{ resourceId: rid, recipient: recipient.publicKey }],
    }),
  );
  await sendAndConfirmTransaction(conn, tx, [owner], { commitment: "confirmed" });
  return { conn, feePayer, owner, session, recipient, mint, agentWallet, rid };
}

/** Lands one settlement. Over the per-call cap it lands as a failed transaction. */
export async function settle(
  c: Chain,
  amount: bigint,
): Promise<{ signature: string; ok: boolean }> {
  const auth: PaymentAuthorization = {
    agentWallet: c.agentWallet,
    sessionKey: c.session.publicKey,
    recipient: c.recipient.publicKey,
    mint: c.mint,
    amount,
    resourceId: c.rid,
    nonce: randomNonce(),
    expiresAt: BigInt(Math.floor(Date.now() / 1000) + 600),
  };
  const signature = signAuthorization(auth, c.session.secretKey);
  const tx = new Transaction().add(
    ...settleInstructions({ authorization: auth, signature, feePayer: c.feePayer.publicKey }),
  );
  const latest = await c.conn.getLatestBlockhash("confirmed");
  tx.recentBlockhash = latest.blockhash;
  tx.feePayer = c.feePayer.publicKey;
  tx.sign(c.feePayer);
  const sig = await c.conn.sendRawTransaction(tx.serialize(), { skipPreflight: true });
  const res = await c.conn.confirmTransaction({ signature: sig, ...latest }, "confirmed");
  return { signature: sig, ok: res.value.err === null };
}

export interface IndexerProc {
  proc: ChildProcess;
  logFile: string;
  exited: Promise<number | null>;
}

export function startIndexer(tag: string, extraEnv: Record<string, string> = {}): IndexerProc {
  const logFile = join(workDir, `indexer-${tag}.log`);
  const out = createWriteStream(logFile);
  const proc = spawn(process.execPath, [join(pkgDir, "dist", "main.js")], {
    env: {
      PATH: process.env.PATH,
      NODE_ENV: "production",
      LOG_LEVEL: "info",
      TURNSTILE_NETWORK: "localnet",
      DATABASE_URL,
      SOLANA_RPC_URL: RPC_URL,
      PORT: String(HTTP_PORT),
      INDEXER_POLL_MS: "100",
      INDEXER_BATCH: "3",
      ...extraEnv,
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  proc.stdout?.pipe(out);
  proc.stderr?.pipe(out);
  const exited = new Promise<number | null>((r) => proc.once("exit", (code) => r(code)));
  log(`indexer ${tag} started, pid ${proc.pid}, log ${logFile}`);
  return { proc, logFile, exited };
}

export async function ready(): Promise<boolean | undefined> {
  const res = await fetch(`http://127.0.0.1:${HTTP_PORT}/readyz`);
  return res.status === 200 ? true : undefined;
}

/** Set by the suite once the database exists. */
export const db = {} as { pool: pg.Pool };

export async function counts() {
  const r = await db.pool.query<{ n: string }>("SELECT count(*) AS n FROM receipts");
  const cp = await db.pool.query<{ last_signature: string | null; last_slot: string }>(
    "SELECT last_signature, last_slot FROM indexer_checkpoints WHERE stream = 'settlement:localnet'",
  );
  return { receipts: Number(r.rows[0]?.n ?? 0), checkpoint: cp.rows[0] ?? null };
}

/**
 * Compares every row with the receipt accounts the settlement program owns. With
 * `allowNullSignature` a row restored from its account after a purge may lack its signature,
 * and the rows without one are returned.
 */
export async function compareWithChain(
  c: Chain,
  landed: Map<string, string>,
  opts: { allowNullSignature?: boolean } = {},
): Promise<{ compared: number; withoutSignature: { address: string; slot: bigint }[] }> {
  const withoutSignature: { address: string; slot: bigint }[] = [];
  const accounts = await c.conn.getProgramAccounts(SETTLEMENT_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [{ memcmp: settlementCoder.accounts.memcmp("Receipt") }],
  });
  const { rows } = await db.pool.query(
    "SELECT *, extract(epoch FROM block_time)::bigint AS epoch FROM receipts ORDER BY receipt_address",
  );
  expect(rows.length).toBe(accounts.length);
  const byAddress = new Map(rows.map((r) => [r.receipt_address as string, r]));
  expect(byAddress.size).toBe(rows.length);
  for (const { pubkey, account } of accounts) {
    const address = pubkey.toBase58();
    const row = byAddress.get(address);
    expect(row, `receipt ${address} is on chain but not in Postgres`).toBeDefined();
    const r = decodeReceipt(account.data);
    if (row.signature === null) withoutSignature.push({ address, slot: r.slot });
    expect({
      receipt_address: row.receipt_address,
      signature: row.signature,
      slot: row.slot,
      epoch: row.epoch,
      agent_wallet: row.agent_wallet,
      owner: row.owner,
      session_key: row.session_key,
      recipient: row.recipient,
      recipient_token: row.recipient_token,
      mint: row.mint,
      amount: row.amount,
      resource_id: row.resource_id,
      nonce: row.nonce,
      fee_payer: row.fee_payer,
      network: row.network,
    }).toEqual({
      receipt_address: address,
      signature:
        opts.allowNullSignature && row.signature === null ? null : landed.get(address),
      slot: r.slot.toString(),
      epoch: r.unixTimestamp.toString(),
      agent_wallet: r.agentWallet.toBase58(),
      owner: r.owner.toBase58(),
      session_key: r.sessionKey.toBase58(),
      recipient: r.recipient.toBase58(),
      recipient_token: r.recipientToken.toBase58(),
      mint: r.mint.toBase58(),
      amount: r.amount.toString(),
      resource_id: bytesToHex(r.resourceId),
      nonce: bytesToHex(r.nonce),
      fee_payer: r.feePayer.toBase58(),
      network: "solana:localnet",
    });
  }
  return { compared: accounts.length, withoutSignature };
}

/** Maps each landed receipt address to its transaction signature, read from the chain. */
export async function landedReceipts(c: Chain, sigs: string[]): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  for (const sig of sigs) {
    const tx = await c.conn.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const keys = tx?.transaction.message.getAccountKeys();
    const settleIx = tx?.transaction.message.compiledInstructions[1];
    const idx = settleIx?.accountKeyIndexes[5];
    const key = idx === undefined ? undefined : keys?.get(idx);
    if (!key) throw new Error(`could not read the receipt account of ${sig}`);
    out.set(key.toBase58(), sig);
  }
  return out;
}

/** Recreates the integration database and runs the migrations. */
export async function prepareDatabase(): Promise<pg.Pool> {
  const admin = new pg.Client({ connectionString: ADMIN_URL });
  await admin.connect();
  await admin.query(`DROP DATABASE IF EXISTS ${IT_DB} WITH (FORCE)`);
  await admin.query(`CREATE DATABASE ${IT_DB}`);
  await admin.end();
  db.pool = createPool(DATABASE_URL, 3);
  await migrate(db.pool);
  return db.pool;
}
