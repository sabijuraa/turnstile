/**
 * What the indexer needs from the chain. The real implementation talks to a Solana RPC node.
 * Tests use an in-memory ledger. Keeping the core behind this interface lets the same tick run
 * in the long lived service and in a scheduled function.
 */

/** One entry of `getSignaturesForAddress` for the settlement program. */
export interface SignatureInfo {
  signature: string;
  slot: number;
  /** True when the transaction failed on chain. Failed transactions hold no receipt. */
  failed: boolean;
}

/** Every field of a settlement receipt, in the formats the receipts table stores. */
export interface SettledReceipt {
  /** Receipt PDA, base58. */
  receiptAddress: string;
  agentWallet: string;
  owner: string;
  sessionKey: string;
  recipient: string;
  recipientToken: string;
  mint: string;
  /** Base units of the mint. */
  amount: bigint;
  /** 32 bytes as lowercase hex. */
  resourceId: string;
  /** 32 bytes as lowercase hex. */
  nonce: string;
  slot: bigint;
  /** Unix seconds from the on-chain clock. */
  unixTimestamp: bigint;
  feePayer: string;
}

/** The receipts one confirmed transaction produced, decoded from its `PaymentSettled` events. */
export interface SettlementTransaction {
  signature: string;
  slot: number;
  receipts: SettledReceipt[];
}

export interface SignaturePage {
  /** Only return signatures newer than this one. */
  until?: string;
  /** Only return signatures older than this one. Used to walk past the first page. */
  before?: string;
  limit: number;
}

export interface ReceiptSource {
  /** Genesis hash of the ledger. Changes when a local validator is reset. */
  genesisHash(): Promise<string>;
  /** Current confirmed slot. Used for the lag metric. */
  tipSlot(): Promise<number>;
  /** Signatures that touched the settlement program, newest first. */
  signatures(page: SignaturePage): Promise<SignatureInfo[]>;
  /** Whether the node still knows this signature. False after pruning or a ledger reset. */
  signatureKnown(signature: string): Promise<boolean>;
  /**
   * The decoded settlement events of one successful transaction. Null when the node does not
   * return the transaction yet, which the indexer treats as work it must retry.
   */
  transaction(signature: string): Promise<SettlementTransaction | null>;
  /**
   * Receipt accounts as stored on chain, in the order asked. Null for an address that holds
   * no receipt account.
   */
  receiptAccounts(addresses: string[]): Promise<(SettledReceipt | null)[]>;
  /**
   * Lowest slot the node still serves transaction history for. Anything older was purged, so
   * `signatures` can no longer list it.
   */
  historyStartSlot(): Promise<number>;
  /** Every receipt account the settlement program still holds. Used to fill a history gap. */
  liveReceipts(): Promise<SettledReceipt[]>;
}

/** An RPC call failed. The tick stops without writing anything and the runner backs off. */
export class SourceError extends Error {
  override name = "SourceError";
}

/**
 * The node refused a `signatures` call because it no longer holds the `until` signature, for
 * example after it purged old ledger data. The indexer then resumes by slot.
 */
export class UntilSignatureUnavailableError extends Error {
  override name = "UntilSignatureUnavailableError";
}
