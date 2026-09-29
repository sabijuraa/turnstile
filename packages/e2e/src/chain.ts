import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  createAssociatedTokenAccountIdempotentInstruction,
  createMintToInstruction,
  getAssociatedTokenAddressSync,
} from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  agentWalletAddress,
  hexToBytes,
  type PaymentAuthorization,
  vaultAddress,
} from "@turnstile/shared";
import {
  createWalletInstruction,
  depositInstruction,
  type ProgramErrorInfo,
  parseProgramError,
  settleInstructions,
  updatePolicyInstruction,
} from "@turnstile/shared/programs";
import type { Deployment, E2eEnv } from "./env.js";

export function readKeypair(path: string): Keypair {
  const raw: unknown = JSON.parse(readFileSync(path, "utf8"));
  if (!Array.isArray(raw) || raw.length !== 64) {
    throw new Error(`${path} is not a 64 byte Solana keypair file.`);
  }
  return Keypair.fromSecretKey(Uint8Array.from(raw as number[]));
}

export interface CatalogRoute {
  path: string;
  resource: string;
  resourceId: string;
  price: string;
  priceBaseUnits: string;
}

export interface Catalog {
  asset: string;
  assetDecimals: number;
  payTo: string;
  network: string;
  facilitator: string;
  routes: CatalogRoute[];
}

export async function loadCatalog(demoApiUrl: string): Promise<Catalog> {
  const res = await fetch(`${demoApiUrl}/v1/catalog`);
  if (res.status !== 200) {
    throw new Error(`GET ${demoApiUrl}/v1/catalog answered ${res.status}. Is the demo API up?`);
  }
  return (await res.json()) as Catalog;
}

export function route(catalog: Catalog, path: string): CatalogRoute {
  const found = catalog.routes.find((r) => r.path === path);
  if (!found) throw new Error(`The demo API catalog has no route ${path}.`);
  return found;
}

export interface Chain {
  connection: Connection;
  deployment: Deployment;
  mint: PublicKey;
  recipient: PublicKey;
  recipientToken: PublicKey;
  mintAuthority: Keypair;
  send(payer: Keypair, ixs: TransactionInstruction[], signers?: Keypair[]): Promise<string>;
  tokenBalance(account: PublicKey): Promise<bigint>;
  /** A new owner with SOL from the faucet and tUSDC minted by the test mint authority. */
  fundedOwner(tusdc: bigint): Promise<Keypair>;
  createAgentWallet(p: CreateAgentWallet): Promise<AgentWalletSetup>;
  settleDirect(
    auth: PaymentAuthorization,
    signature: Uint8Array,
    feePayer: Keypair,
  ): Promise<DirectSettle>;
}

export interface CreateAgentWallet {
  owner: Keypair;
  id: bigint;
  session: PublicKey;
  perCallCap: bigint;
  dailyCap: bigint;
  deposit: bigint;
  allowList: Array<{ resourceId: string; recipient: PublicKey }>;
}

export interface AgentWalletSetup {
  agentWallet: PublicKey;
  vault: PublicKey;
  signature: string;
}

export interface DirectSettle {
  signature: string;
  /** The transaction error from the ledger, null when it succeeded. */
  err: unknown;
  logs: string[];
  error: ProgramErrorInfo | null;
}

export function createChain(env: E2eEnv, deployment: Deployment): Chain {
  const connection = new Connection(env.rpcUrl, { commitment: "confirmed", wsEndpoint: env.wsUrl });
  const mint = new PublicKey(deployment.mint);
  const recipient = new PublicKey(deployment.demoRecipient);
  const mintAuthority = readKeypair(join(env.keysDir, "mint-authority.json"));

  async function confirm(signature: string, lastValidBlockHeight: number, blockhash: string) {
    const res = await connection.confirmTransaction(
      { signature, blockhash, lastValidBlockHeight },
      "confirmed",
    );
    return res.value.err;
  }

  async function send(
    payer: Keypair,
    ixs: TransactionInstruction[],
    signers: Keypair[] = [],
  ): Promise<string> {
    const latest = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: payer.publicKey, ...latest }).add(...ixs);
    tx.sign(payer, ...signers);
    const sig = await connection.sendRawTransaction(tx.serialize());
    const err = await confirm(sig, latest.lastValidBlockHeight, latest.blockhash);
    if (err) throw new Error(`Transaction ${sig} failed with ${JSON.stringify(err)}.`);
    return sig;
  }

  async function tokenBalance(account: PublicKey): Promise<bigint> {
    const res = await connection.getTokenAccountBalance(account, "confirmed");
    return BigInt(res.value.amount);
  }

  async function fundedOwner(tusdc: bigint): Promise<Keypair> {
    const owner = Keypair.generate();
    const sig = await connection.requestAirdrop(owner.publicKey, 2 * LAMPORTS_PER_SOL);
    const latest = await connection.getLatestBlockhash("confirmed");
    const err = await confirm(sig, latest.lastValidBlockHeight, latest.blockhash);
    if (err) throw new Error(`The airdrop to ${owner.publicKey.toBase58()} failed.`);
    const ownerToken = getAssociatedTokenAddressSync(mint, owner.publicKey);
    await send(
      owner,
      [
        createAssociatedTokenAccountIdempotentInstruction(
          owner.publicKey,
          ownerToken,
          owner.publicKey,
          mint,
        ),
        createMintToInstruction(mint, ownerToken, mintAuthority.publicKey, tusdc),
      ],
      [mintAuthority],
    );
    return owner;
  }

  async function createAgentWallet(p: CreateAgentWallet): Promise<AgentWalletSetup> {
    const [agentWallet] = agentWalletAddress(p.owner.publicKey, p.id);
    const ownerToken = getAssociatedTokenAddressSync(mint, p.owner.publicKey);
    const signature = await send(p.owner, [
      createWalletInstruction({
        owner: p.owner.publicKey,
        mint,
        id: p.id,
        perCallCap: p.perCallCap,
        dailyCap: p.dailyCap,
        sessionKey: p.session,
        sessionExpiresAt: 0n,
      }),
      depositInstruction({
        owner: p.owner.publicKey,
        agentWallet,
        ownerToken,
        amount: p.deposit,
      }),
      updatePolicyInstruction({
        owner: p.owner.publicKey,
        agentWallet,
        perCallCap: p.perCallCap,
        dailyCap: p.dailyCap,
        allowList: p.allowList.map((e) => ({
          resourceId: hexToBytes(e.resourceId),
          recipient: e.recipient,
        })),
      }),
    ]);
    return { agentWallet, vault: vaultAddress(agentWallet)[0], signature };
  }

  /**
   * Sends a signed authorization straight to the settlement program with preflight off, so
   * neither the facilitator nor the RPC simulation can stop it. The program decides.
   */
  async function settleDirect(
    auth: PaymentAuthorization,
    signature: Uint8Array,
    feePayer: Keypair,
  ): Promise<DirectSettle> {
    const latest = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: feePayer.publicKey, ...latest }).add(
      ...settleInstructions({ authorization: auth, signature, feePayer: feePayer.publicKey }),
    );
    tx.sign(feePayer);
    const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    await confirm(sig, latest.lastValidBlockHeight, latest.blockhash);
    const landed = await connection.getTransaction(sig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!landed?.meta) throw new Error(`Transaction ${sig} is not on the ledger after confirming.`);
    const logs = landed.meta.logMessages ?? [];
    return {
      signature: sig,
      err: landed.meta.err,
      logs,
      error: landed.meta.err ? parseProgramError(landed.meta.err, logs) : null,
    };
  }

  return {
    connection,
    deployment,
    mint,
    recipient,
    recipientToken: getAssociatedTokenAddressSync(mint, recipient, true),
    mintAuthority,
    send,
    tokenBalance,
    fundedOwner,
    createAgentWallet,
    settleDirect,
  };
}
