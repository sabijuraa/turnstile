/**
 * Prepares a running local validator for Turnstile.
 *
 * Creates or reuses the test keypairs, airdrops SOL, creates the 6 decimal test stablecoin
 * tUSDC (test only, worthless), funds the demo owner with it and writes the deployment record.
 * Safe to run again. Existing keys and a still valid mint are reused.
 *
 * Env
 * - SOLANA_RPC_URL, default http://127.0.0.1:8899
 * - KEYS_DIR, default keys/localnet under the repo root
 * - DEPLOYMENT_FILE, default deployments/localnet.json under the repo root
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createMint,
  getMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import { Connection, Keypair, LAMPORTS_PER_SOL, type PublicKey } from "@solana/web3.js";
import {
  AGENT_WALLET_PROGRAM_ID,
  SETTLEMENT_PROGRAM_ID,
  STABLECOIN_DECIMALS,
} from "../constants.js";
import { NETWORKS } from "../networks.js";
import { settlementAuthorityAddress } from "../pda.js";

export interface LocalnetDeployment {
  network: "localnet";
  /** Canonical CAIP-2 id, `NETWORKS.localnet.caip2`. */
  caip2: string;
  /** Genesis hash of the ledger this record was written against. Changes on a ledger reset. */
  genesisHash: string;
  programs: { agentWallet: string; settlement: string };
  settlementAuthority: string;
  mint: string;
  mintSymbol: "tUSDC";
  mintDecimals: number;
  mintAuthority: string;
  facilitator: string;
  demoOwner: string;
  demoSession: string;
  demoRecipient: string;
  createdAt: string;
}

const MIN_SOL = 5n * BigInt(LAMPORTS_PER_SOL);
const AIRDROP_SOL = 20;
/** tUSDC minted to the demo owner when it holds less than this, in base units. */
const DEMO_OWNER_TUSDC = 1_000_000_000n;

function findRepoRoot(start: string): string {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, "pnpm-workspace.yaml"))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return resolve(start);
    dir = parent;
  }
}

function resolvePath(envValue: string | undefined, fallback: string, root: string): string {
  if (envValue && envValue.length > 0) {
    return isAbsolute(envValue) ? envValue : resolve(process.cwd(), envValue);
  }
  return join(root, fallback);
}

/** Loads a Solana CLI style keypair file, or creates one with mode 0600. */
export function loadOrCreateKeypair(path: string): Keypair {
  if (existsSync(path)) {
    const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!Array.isArray(raw) || raw.length !== 64 || !raw.every((n) => Number.isInteger(n))) {
      throw new Error(`${path} is not a 64 byte keypair file. Delete it to create a new one.`);
    }
    return Keypair.fromSecretKey(Uint8Array.from(raw as number[]));
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  const kp = Keypair.generate();
  writeFileSync(path, JSON.stringify(Array.from(kp.secretKey)), { mode: 0o600 });
  return kp;
}

async function ensureSol(connection: Connection, key: PublicKey): Promise<void> {
  const balance = BigInt(await connection.getBalance(key, "confirmed"));
  if (balance >= MIN_SOL) return;
  const sig = await connection.requestAirdrop(key, AIRDROP_SOL * LAMPORTS_PER_SOL);
  const latest = await connection.getLatestBlockhash("confirmed");
  await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
}

async function assertProgramsLoaded(connection: Connection): Promise<void> {
  for (const [name, id] of [
    ["agent_wallet", AGENT_WALLET_PROGRAM_ID],
    ["settlement", SETTLEMENT_PROGRAM_ID],
  ] as const) {
    const info = await connection.getAccountInfo(id, "confirmed");
    if (!info?.executable) {
      throw new Error(
        `The ${name} program ${id.toBase58()} is not deployed on this validator. Start solana-test-validator with --bpf-program for both program ids and their .so files from target/deploy.`,
      );
    }
  }
}

async function ensureMint(
  connection: Connection,
  payer: Keypair,
  mintKeypair: Keypair,
  authority: Keypair,
): Promise<PublicKey> {
  const info = await connection.getAccountInfo(mintKeypair.publicKey, "confirmed");
  if (info) {
    if (!info.owner.equals(TOKEN_PROGRAM_ID)) {
      throw new Error(
        `The tUSDC mint address ${mintKeypair.publicKey.toBase58()} holds a non token account. Delete tusdc-mint.json in the keys directory and run again.`,
      );
    }
    const mint = await getMint(connection, mintKeypair.publicKey, "confirmed");
    if (mint.decimals !== STABLECOIN_DECIMALS || !mint.mintAuthority?.equals(authority.publicKey)) {
      throw new Error(
        `The tUSDC mint ${mintKeypair.publicKey.toBase58()} has the wrong decimals or authority. Delete tusdc-mint.json in the keys directory and run again.`,
      );
    }
    return mintKeypair.publicKey;
  }
  return createMint(
    connection,
    payer,
    authority.publicKey,
    null,
    STABLECOIN_DECIMALS,
    mintKeypair,
    { commitment: "confirmed" },
  );
}

function readExisting(path: string): LocalnetDeployment | null {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, "utf8")) as LocalnetDeployment;
  } catch (err) {
    throw new Error(`${path} is not valid JSON. Fix or delete it and run again.`, { cause: err });
  }
}

export async function bootstrapLocalnet(): Promise<LocalnetDeployment> {
  const root = findRepoRoot(process.cwd());
  const rpcUrl = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
  const keysDir = resolvePath(process.env.KEYS_DIR, "keys/localnet", root);
  const deploymentFile = resolvePath(
    process.env.DEPLOYMENT_FILE,
    "deployments/localnet.json",
    root,
  );
  const connection = new Connection(rpcUrl, "confirmed");

  await assertProgramsLoaded(connection);

  const key = (name: string) => loadOrCreateKeypair(join(keysDir, name));
  const facilitator = key("facilitator.json");
  const demoOwner = key("demo-owner.json");
  const demoSession = key("demo-session.json");
  const demoRecipient = key("demo-recipient.json");
  const mintAuthority = key("mint-authority.json");
  const mintKeypair = key("tusdc-mint.json");

  for (const kp of [facilitator, demoOwner, demoRecipient, mintAuthority]) {
    await ensureSol(connection, kp.publicKey);
  }

  const mint = await ensureMint(connection, mintAuthority, mintKeypair, mintAuthority);
  // The recipient needs a token account to be paid into. The demo owner gets tUSDC to fund
  // its agent wallet.
  await getOrCreateAssociatedTokenAccount(
    connection,
    mintAuthority,
    mint,
    demoRecipient.publicKey,
    false,
    "confirmed",
  );
  const ownerToken = await getOrCreateAssociatedTokenAccount(
    connection,
    mintAuthority,
    mint,
    demoOwner.publicKey,
    false,
    "confirmed",
  );
  if (ownerToken.amount < DEMO_OWNER_TUSDC) {
    await mintTo(
      connection,
      mintAuthority,
      mint,
      ownerToken.address,
      mintAuthority,
      DEMO_OWNER_TUSDC - ownerToken.amount,
      [],
      { commitment: "confirmed" },
    );
  }

  const genesis = await connection.getGenesisHash();
  const previous = readExisting(deploymentFile);
  const record: Omit<LocalnetDeployment, "createdAt"> = {
    network: "localnet",
    caip2: NETWORKS.localnet.caip2,
    genesisHash: genesis,
    programs: {
      agentWallet: AGENT_WALLET_PROGRAM_ID.toBase58(),
      settlement: SETTLEMENT_PROGRAM_ID.toBase58(),
    },
    settlementAuthority: settlementAuthorityAddress()[0].toBase58(),
    mint: mint.toBase58(),
    mintSymbol: "tUSDC",
    mintDecimals: STABLECOIN_DECIMALS,
    mintAuthority: mintAuthority.publicKey.toBase58(),
    facilitator: facilitator.publicKey.toBase58(),
    demoOwner: demoOwner.publicKey.toBase58(),
    demoSession: demoSession.publicKey.toBase58(),
    demoRecipient: demoRecipient.publicKey.toBase58(),
  };
  // Keep createdAt when nothing changed so a re-run leaves the file byte for byte the same.
  const unchanged =
    previous !== null &&
    JSON.stringify({ ...previous, createdAt: undefined }) ===
      JSON.stringify({ ...record, createdAt: undefined });
  const deployment: LocalnetDeployment = {
    ...record,
    createdAt: unchanged && previous ? previous.createdAt : new Date().toISOString(),
  };
  mkdirSync(dirname(deploymentFile), { recursive: true });
  writeFileSync(deploymentFile, `${JSON.stringify(deployment, null, 2)}\n`);
  return deployment;
}

const invokedDirectly =
  process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1]);

if (invokedDirectly) {
  bootstrapLocalnet()
    .then((d) => {
      process.stdout.write(`${JSON.stringify(d, null, 2)}\n`);
    })
    .catch((err: unknown) => {
      console.error(err instanceof Error ? err.message : err);
      process.exit(1);
    });
}
