import type { Connection, Keypair, PublicKey } from "@solana/web3.js";
import type { RefusalReason } from "./errors.js";
import type { WalletSnapshot, WalletStateSource } from "./state.js";

export interface AgentOptions {
  /** RPC endpoint used to read the agent wallet. Ignored when `connection` is given. */
  rpcUrl?: string;
  connection?: Connection;
  /** Agent wallet PDA address. */
  agentWallet: string | PublicKey;
  /** Session key, as a Keypair or its 64 byte secret. It never leaves this process. */
  sessionKey: Keypair | Uint8Array;
  /** Optional local cap per call, as a decimal token amount such as "0.01". Tighter than the chain. */
  maxPerCall?: string;
  /**
   * Longest time a signed authorization may stay valid, in seconds. Requirements whose
   * `extra.expiresAt` is further ahead are refused with `AuthorizationTtlTooLong`. Default 300.
   */
  maxAuthorizationTtlSeconds?: number;
  /** Check the on-chain policy locally before signing. Default true. */
  localPolicyCheck?: boolean;
  /** How long a read of the wallet stays fresh, in milliseconds. Default 15000. */
  policyTtlMs?: number;
  fetch?: typeof fetch;
  /** Called for every settled, refused or rejected payment. It runs inline, so keep it cheap. */
  onPayment?: (event: PaymentEvent) => void;
  /** Settlement program the SDK signs for. Requirements naming another program are refused. */
  settlementProgram?: string | PublicKey;
  /** Agent wallet program that owns the wallet account. */
  agentWalletProgram?: string | PublicKey;
  /** Decimals of the wallet mint, used to parse `maxPerCall`. Default 6. */
  mintDecimals?: number;
  /** Replaces the chain reader. Useful in tests and for custom caching. */
  stateSource?: WalletStateSource;
  /** Milliseconds since the epoch. Default Date.now. */
  now?: () => number;
}

/** A settled payment, taken from the PAYMENT-RESPONSE header. */
export interface PaymentInfo {
  /** Receipt account address on chain. */
  receipt: string;
  /** Settlement transaction signature. */
  transaction: string;
  /** Base units as a decimal string. */
  amount: string;
  resource: string;
  network: string;
  /** Agent wallet that paid. */
  payer: string;
  /** Hex nonce of the authorization. */
  nonce: string;
  /** True when the facilitator returned an existing receipt for a retried payment. */
  alreadySettled: boolean;
}

export type PaymentEvent =
  | { type: "settled"; payment: PaymentInfo }
  | { type: "refused"; reason: RefusalReason; message: string; resource: string; amount: string }
  | {
      type: "rejected";
      reason: string;
      message: string;
      resource: string;
      amount: string;
      status: number;
    };

/** A fetch Response with the settled payment attached when one was made. */
export type PaidResponse = Response & { payment?: PaymentInfo };

export interface Agent {
  /** Like fetch. Pays a 402 inside policy and retries once with the payment attached. */
  fetch(input: string | URL | Request, init?: RequestInit): Promise<PaidResponse>;
  readonly agentWallet: PublicKey;
  readonly sessionPublicKey: PublicKey;
  /** Current wallet state, read from the chain when the cache is stale. */
  wallet(options?: { refresh?: boolean }): Promise<WalletSnapshot>;
}
