import { type ChildProcess, spawn, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import {
  Connection,
  type Keypair,
  LAMPORTS_PER_SOL,
  type PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from "@solana/web3.js";
import { AGENT_WALLET_PROGRAM_ID, SETTLEMENT_PROGRAM_ID } from "@turnstile/shared";
import {
  associatedTokenAddress,
  createAssociatedTokenIdempotentInstruction,
  decodeTokenAccount,
  TOKEN_PROGRAM_ID,
} from "../src/chain/token.js";

const repoRoot = resolve(import.meta.dirname, "../../..");
const programs = {
  agentWallet: join(repoRoot, "target/deploy/agent_wallet.so"),
  settlement: join(repoRoot, "target/deploy/settlement.so"),
};

export interface LocalValidator {
  url: string;
  connection: Connection;
  stop(): void;
}

async function waitForRpc(connection: Connection, ms: number): Promise<void> {
  const deadline = Date.now() + ms;
  for (;;) {
    try {
      const info = await connection.getAccountInfo(AGENT_WALLET_PROGRAM_ID);
      if (info?.executable) return;
    } catch {
      // The validator is still starting.
    }
    if (Date.now() > deadline) throw new Error(`validator did not come up within ${ms} ms`);
    await new Promise((r) => setTimeout(r, 500));
  }
}

/**
 * Uses TEST_RPC_URL when set. Otherwise starts solana-test-validator with both programs on
 * port 47899. Returns the reason to skip when neither is possible.
 */
export async function startValidator(): Promise<LocalValidator | { skip: string }> {
  const given = process.env.TEST_RPC_URL;
  if (given) {
    const connection = new Connection(given, "confirmed");
    await waitForRpc(connection, 10_000);
    return { url: given, connection, stop: () => undefined };
  }
  if (spawnSync("solana-test-validator", ["--version"]).status !== 0) {
    return { skip: "solana-test-validator is not on PATH and TEST_RPC_URL is not set" };
  }
  if (!existsSync(programs.agentWallet) || !existsSync(programs.settlement)) {
    return { skip: "target/deploy has no program builds. Run anchor build or cargo build-sbf" };
  }
  if (!(await portFree(47899))) {
    throw new Error(
      "Port 47899 is taken, so the chain tests cannot start their own validator. Stop what uses it or set TEST_RPC_URL.",
    );
  }
  const ledger = mkdtempSync(join(tmpdir(), "turnstile-backend-ledger-"));
  const child: ChildProcess = spawn(
    "solana-test-validator",
    [
      "--reset",
      "--quiet",
      "--ledger",
      ledger,
      "--rpc-port",
      "47899",
      "--faucet-port",
      "47898",
      "--gossip-port",
      "47000",
      "--dynamic-port-range",
      "47001-47030",
      "--bpf-program",
      AGENT_WALLET_PROGRAM_ID.toBase58(),
      programs.agentWallet,
      "--bpf-program",
      SETTLEMENT_PROGRAM_ID.toBase58(),
      programs.settlement,
    ],
    { stdio: "ignore" },
  );
  const url = "http://127.0.0.1:47899";
  const connection = new Connection(url, "confirmed");
  await waitForRpc(connection, 60_000);
  return {
    url,
    connection,
    stop: () => {
      child.kill("SIGTERM");
      rmSync(ledger, { recursive: true, force: true });
    },
  };
}

function portFree(port: number): Promise<boolean> {
  return new Promise((done) => {
    const server = createServer();
    server.once("error", () => done(false));
    server.listen(port, "0.0.0.0", () => server.close(() => done(true)));
  });
}

export async function send(
  connection: Connection,
  tx: Transaction,
  signers: Keypair[],
): Promise<string> {
  const bh = await connection.getLatestBlockhash("confirmed");
  tx.recentBlockhash = bh.blockhash;
  tx.feePayer = signers[0]?.publicKey;
  tx.sign(...signers);
  const sig = await connection.sendRawTransaction(tx.serialize());
  await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  return sig;
}

export async function airdrop(connection: Connection, to: PublicKey, sol = 10): Promise<void> {
  const sig = await connection.requestAirdrop(to, sol * LAMPORTS_PER_SOL);
  const bh = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction({ signature: sig, ...bh }, "confirmed");
}

/** Creates a 6 decimal mint whose authority is `authority`. Test fixture only. */
export async function createMint(
  connection: Connection,
  authority: Keypair,
  mint: Keypair,
): Promise<void> {
  const MINT_SIZE = 82;
  const lamports = await connection.getMinimumBalanceForRentExemption(MINT_SIZE);
  const data = Buffer.alloc(67);
  data[0] = 20; // InitializeMint2
  data[1] = 6;
  authority.publicKey.toBuffer().copy(data, 2);
  const tx = new Transaction().add(
    SystemProgram.createAccount({
      fromPubkey: authority.publicKey,
      newAccountPubkey: mint.publicKey,
      lamports,
      space: MINT_SIZE,
      programId: TOKEN_PROGRAM_ID,
    }),
    new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [{ pubkey: mint.publicKey, isSigner: false, isWritable: true }],
      data,
    }),
  );
  await send(connection, tx, [authority, mint]);
}

/** Mints base units to the owner's associated token account, creating it when needed. */
export async function mintTo(
  connection: Connection,
  authority: Keypair,
  mint: PublicKey,
  owner: PublicKey,
  amount: bigint,
): Promise<void> {
  const data = Buffer.alloc(9);
  data[0] = 7; // MintTo
  data.writeBigUInt64LE(amount, 1);
  const tx = new Transaction().add(
    createAssociatedTokenIdempotentInstruction(authority.publicKey, owner, mint),
    new TransactionInstruction({
      programId: TOKEN_PROGRAM_ID,
      keys: [
        { pubkey: mint, isSigner: false, isWritable: true },
        { pubkey: associatedTokenAddress(owner, mint), isSigner: false, isWritable: true },
        { pubkey: authority.publicKey, isSigner: true, isWritable: false },
      ],
      data,
    }),
  );
  await send(connection, tx, [authority]);
}

export async function tokenBalance(
  connection: Connection,
  owner: PublicKey,
  mint: PublicKey,
): Promise<bigint> {
  const info = await connection.getAccountInfo(associatedTokenAddress(owner, mint), "confirmed");
  if (!info) return 0n;
  return decodeTokenAccount(info.data, info.owner)?.amount ?? 0n;
}
