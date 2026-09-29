import type { PublicKey } from "@solana/web3.js";
import type { PaymentAuthorization, PolicyState } from "@turnstile/shared";

/** What the facilitator needs to know about an agent wallet to judge a payment. */
export interface WalletSnapshot {
  address: PublicKey;
  owner: PublicKey;
  mint: PublicKey;
  vault: PublicKey;
  /** Policy with `vaultBalance` filled from the vault token account. */
  policy: PolicyState;
}

/** The fields of an on-chain receipt that identify the payment it settled. */
export interface ReceiptSnapshot {
  agentWallet: PublicKey;
  sessionKey: PublicKey;
  recipient: PublicKey;
  mint: PublicKey;
  amount: bigint;
  resourceId: Uint8Array;
  nonce: Uint8Array;
}

/** Result of simulating the settle transaction. A refusal carries the program error name. */
export type SimulateOutcome = { ok: true } | { ok: false; reason: string; detail: string };

/**
 * Result of sending the settle transaction. `rejected` means the programs refused it with
 * a named error and trying again will not help. `unknown` means the outcome could not be
 * established, which covers transport failures and confirmation timeouts.
 */
export type SubmitOutcome =
  | { ok: true; signature: string }
  | { ok: false; kind: "rejected"; reason: string; detail: string; signature?: string }
  | { ok: false; kind: "unknown"; detail: string; signature?: string };

/**
 * Every chain call the facilitator makes. The HTTP logic only talks to this interface, so it
 * can be tested against a fake. Read methods throw ChainUnavailableError when the RPC fails.
 */
export interface SettlementChain {
  /** Resolves when the RPC answers. */
  ping(): Promise<void>;
  /** Fee payer address. The only key the facilitator signs with. */
  readonly feePayer: PublicKey;
  loadWallet(address: PublicKey): Promise<WalletSnapshot | null>;
  loadReceipt(address: PublicKey): Promise<ReceiptSnapshot | null>;
  /** Signature of the transaction that created the receipt, the oldest one touching it. */
  receiptSignature(address: PublicKey): Promise<string | null>;
  /**
   * Simulates the exact settle transaction without signature checks on the fee payer.
   * Throws ChainUnavailableError when the RPC cannot run the simulation.
   */
  simulateSettle(auth: PaymentAuthorization, signature: Uint8Array): Promise<SimulateOutcome>;
  /** Signs as fee payer, sends and waits for `confirmed`. */
  submitSettle(auth: PaymentAuthorization, signature: Uint8Array): Promise<SubmitOutcome>;
}

/** A receipt this facilitator paid rent for, as the reclaim job sees it. */
export interface FeePayerReceipt {
  address: PublicKey;
  /** Unix seconds. Expiry of the authorization the receipt settled. */
  expiresAt: bigint;
  /** Lamports the account holds. Closing it returns all of them to the fee payer. */
  lamports: bigint;
}

/** Result of one close transaction. A failure carries the program error name when known. */
export type CloseOutcome =
  | { ok: true; signature: string }
  | { ok: false; detail: string; signature?: string };

/** The chain calls the receipt rent reclaim job makes. The fee payer is the only signer. */
export interface ReclaimChain {
  readonly feePayer: PublicKey;
  /** Unix seconds from the Clock sysvar, the time `close_receipt` compares against. */
  chainTime(): Promise<bigint>;
  /** Every receipt whose `fee_payer` is this facilitator. */
  listFeePayerReceipts(): Promise<FeePayerReceipt[]>;
  /** Closes all of `receipts` in one transaction and waits for `confirmed`. */
  closeReceipts(receipts: PublicKey[]): Promise<CloseOutcome>;
}
