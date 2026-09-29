import type { PublicKey } from "@solana/web3.js";
import type { PaymentAuthorization } from "@turnstile/shared";

export interface WalletSetup {
  agentWallet: PublicKey;
  walletId: bigint;
  vault: PublicKey;
  /** The one transaction that created, funded and configured the wallet. */
  signature: string;
}

export interface WalletReading {
  rollingSpend: bigint;
  dailyCap: bigint;
  vaultBalance: bigint;
}

export type DirectSettlement =
  | { refused: true; signature: string; errorName: string; logs: string[] }
  | { refused: false; signature: string };

export interface Withdrawal {
  amount: bigint;
  signature: string | null;
}

export interface CreateWalletParams {
  id: bigint;
  perCallCap: bigint;
  dailyCap: bigint;
  funding: bigint;
  sessionKey: PublicKey;
  allowList: { resourceId: Uint8Array; recipient: PublicKey }[];
}

/** Everything the demo run does on chain as the demo owner. */
export interface DemoChain {
  /** Throws a DemoRunError with a clear message when the owner cannot pay for a run. */
  checkOwnerFunds(required: bigint): Promise<void>;
  /** First wallet id at or after the hint that has no account yet. */
  nextWalletId(hint: bigint): Promise<bigint>;
  createWallet(params: CreateWalletParams): Promise<WalletSetup>;
  readWallet(agentWallet: PublicKey): Promise<WalletReading>;
  /**
   * Sends a signed authorization straight to the settlement program with preflight off, paid
   * by the owner, so the program itself rules on it.
   */
  settleDirect(auth: PaymentAuthorization, signature: Uint8Array): Promise<DirectSettlement>;
  /** Moves the whole vault balance back to the owner's token account. */
  withdrawAll(agentWallet: PublicKey): Promise<Withdrawal>;
}

/** A run failure with a stable reason code and a message for the demo page. */
export class DemoRunError extends Error {
  override name = "DemoRunError";
  constructor(
    readonly reason: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}
