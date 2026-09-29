import { AccountLayout, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  type Connection,
  type Keypair,
  LAMPORTS_PER_SOL,
  type PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  agentWalletAddress,
  formatUnits,
  type PaymentAuthorization,
  rollingSpend,
  vaultAddress,
} from "@turnstile/shared";
import {
  createWalletInstruction,
  depositInstruction,
  fetchAgentWallet,
  parseProgramError,
  settleInstructions,
  updatePolicyInstruction,
  withdrawInstruction,
} from "@turnstile/shared/programs";
import {
  type CreateWalletParams,
  type DemoChain,
  DemoRunError,
  type DirectSettlement,
  type WalletReading,
  type WalletSetup,
  type Withdrawal,
} from "./demo-chain.js";

/** The owner pays fees and rent for the wallet and receipt accounts. Keep a margin. */
const MIN_OWNER_LAMPORTS = BigInt(LAMPORTS_PER_SOL / 20);
const ID_PROBE_BATCH = 25;
const LOG_FETCH_ATTEMPTS = 20;
const LOG_FETCH_DELAY_MS = 250;

export interface SolanaDemoChainOptions {
  connection: Connection;
  owner: Keypair;
  mint: PublicKey;
  mintDecimals: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** The demo owner's chain operations against the real programs. */
export class SolanaDemoChain implements DemoChain {
  private readonly connection: Connection;
  private readonly owner: Keypair;
  private readonly mint: PublicKey;
  private readonly decimals: number;
  readonly ownerToken: PublicKey;

  constructor(options: SolanaDemoChainOptions) {
    this.connection = options.connection;
    this.owner = options.owner;
    this.mint = options.mint;
    this.decimals = options.mintDecimals;
    this.ownerToken = getAssociatedTokenAddressSync(this.mint, this.owner.publicKey);
  }

  private async send(instructions: TransactionInstruction[], what: string): Promise<string> {
    const latest = await this.connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: this.owner.publicKey, ...latest }).add(...instructions);
    tx.sign(this.owner);
    let signature: string;
    try {
      signature = await this.connection.sendRawTransaction(tx.serialize(), {
        preflightCommitment: "confirmed",
      });
    } catch (err) {
      const parsed = parseProgramError(err);
      throw new DemoRunError(
        "chain_error",
        `Could not ${what}${parsed ? ` because the program answered ${parsed.name}` : ""}. ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }
    const result = await this.connection.confirmTransaction({ signature, ...latest }, "confirmed");
    if (result.value.err) {
      throw new DemoRunError(
        "chain_error",
        `Could not ${what}. Transaction ${signature} failed with ${JSON.stringify(result.value.err)}.`,
      );
    }
    return signature;
  }

  private async tokenBalance(address: PublicKey): Promise<bigint | null> {
    const info = await this.connection.getAccountInfo(address, "confirmed");
    if (!info || info.data.length < AccountLayout.span) return null;
    return AccountLayout.decode(info.data).amount;
  }

  async checkOwnerFunds(required: bigint): Promise<void> {
    const owner = this.owner.publicKey.toBase58();
    const lamports = BigInt(await this.connection.getBalance(this.owner.publicKey, "confirmed"));
    if (lamports < MIN_OWNER_LAMPORTS) {
      throw new DemoRunError(
        "owner_needs_sol",
        `The demo owner ${owner} holds ${Number(lamports) / LAMPORTS_PER_SOL} SOL, too little for fees and rent. Airdrop SOL to it or run the localnet bootstrap again.`,
      );
    }
    const tokens = (await this.tokenBalance(this.ownerToken)) ?? 0n;
    if (tokens < required) {
      throw new DemoRunError(
        "owner_underfunded",
        `The demo owner ${owner} holds ${formatUnits(tokens, this.decimals)} tUSDC and a run needs ${formatUnits(required, this.decimals)}. Run the localnet bootstrap again, which tops the owner up.`,
      );
    }
  }

  async nextWalletId(hint: bigint): Promise<bigint> {
    for (let start = hint; ; start += BigInt(ID_PROBE_BATCH)) {
      const ids = Array.from({ length: ID_PROBE_BATCH }, (_, i) => start + BigInt(i));
      const addresses = ids.map((id) => agentWalletAddress(this.owner.publicKey, id)[0]);
      const infos = await this.connection.getMultipleAccountsInfo(addresses, "confirmed");
      const free = infos.findIndex((info) => info === null);
      const id = ids[free];
      if (free !== -1 && id !== undefined) return id;
    }
  }

  async createWallet(p: CreateWalletParams): Promise<WalletSetup> {
    const owner = this.owner.publicKey;
    const [agentWallet] = agentWalletAddress(owner, p.id);
    const signature = await this.send(
      [
        createWalletInstruction({
          owner,
          mint: this.mint,
          id: p.id,
          perCallCap: p.perCallCap,
          dailyCap: p.dailyCap,
          sessionKey: p.sessionKey,
          sessionExpiresAt: 0n,
        }),
        depositInstruction({ owner, agentWallet, ownerToken: this.ownerToken, amount: p.funding }),
        updatePolicyInstruction({
          owner,
          agentWallet,
          perCallCap: p.perCallCap,
          dailyCap: p.dailyCap,
          allowList: p.allowList,
        }),
      ],
      "create and fund the demo agent wallet",
    );
    return { agentWallet, walletId: p.id, vault: vaultAddress(agentWallet)[0], signature };
  }

  async readWallet(agentWallet: PublicKey): Promise<WalletReading> {
    const wallet = await fetchAgentWallet(this.connection, agentWallet);
    if (!wallet) {
      throw new DemoRunError("wallet_missing", `Agent wallet ${agentWallet.toBase58()} is gone.`);
    }
    const now = BigInt(Math.floor(Date.now() / 1000));
    return {
      rollingSpend: rollingSpend(wallet.policy.spendBuckets, now),
      dailyCap: wallet.policy.dailyCap,
      vaultBalance: (await this.tokenBalance(wallet.vault)) ?? 0n,
    };
  }

  async settleDirect(auth: PaymentAuthorization, signature: Uint8Array): Promise<DirectSettlement> {
    const latest = await this.connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: this.owner.publicKey, ...latest }).add(
      ...settleInstructions({ authorization: auth, signature, feePayer: this.owner.publicKey }),
    );
    tx.sign(this.owner);
    // Preflight off, so the transaction lands and fails on chain where anyone can inspect it.
    const sig = await this.connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
    const result = await this.connection.confirmTransaction(
      { signature: sig, ...latest },
      "confirmed",
    );
    if (!result.value.err) return { refused: false, signature: sig };

    let logs: string[] = [];
    for (let i = 0; i < LOG_FETCH_ATTEMPTS && logs.length === 0; i++) {
      const fetched = await this.connection.getTransaction(sig, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      logs = fetched?.meta?.logMessages ?? [];
      if (logs.length === 0) await sleep(LOG_FETCH_DELAY_MS);
    }
    const parsed = parseProgramError(result.value.err, logs);
    return {
      refused: true,
      signature: sig,
      errorName: parsed?.name ?? `UnknownError ${JSON.stringify(result.value.err)}`,
      logs: logs.filter((l) => /Error|failed/.test(l)),
    };
  }

  async withdrawAll(agentWallet: PublicKey): Promise<Withdrawal> {
    const vault = vaultAddress(agentWallet)[0];
    const amount = (await this.tokenBalance(vault)) ?? 0n;
    if (amount === 0n) return { amount, signature: null };
    const signature = await this.send(
      [
        withdrawInstruction({
          owner: this.owner.publicKey,
          agentWallet,
          ownerToken: this.ownerToken,
          amount,
        }),
      ],
      "withdraw the unspent balance",
    );
    return { amount, signature };
  }
}
