import { createHash } from "node:crypto";
import {
  type Commitment,
  type Connection,
  type MessageCompiledInstruction,
  PublicKey,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import bs58 from "bs58";
import type {
  ReceiptSource,
  SettledReceipt,
  SettlementTransaction,
  SignatureInfo,
  SignaturePage,
} from "./source.js";
import { SourceError, UntilSignatureUnavailableError } from "./source.js";

/** How Agave answers `getSignaturesForAddress` when it no longer holds the `until` signature. */
const UNTIL_MISSING = /not found|TransactionHistoryNotAvailable|history is not available/i;

/** Turns program output into receipts. Backed by the shared settlement client. */
export interface SettlementDecoder {
  /** Every `PaymentSettled` event the settlement program itself emitted in these logs. */
  eventsFromLogs(logs: string[]): SettledReceipt[];
  /** First 8 bytes of every Receipt account. Filters `getProgramAccounts` to receipts. */
  receiptDiscriminator: Uint8Array;
  /** A receipt account owned by the settlement program. Null or a throw when the data is not a receipt. */
  receiptFromAccount(address: string, data: Uint8Array): SettledReceipt | null;
}

/** The part of web3.js Connection the source uses. */
export type SolanaRpc = Pick<
  Connection,
  | "getGenesisHash"
  | "getSlot"
  | "getSignaturesForAddress"
  | "getSignatureStatuses"
  | "getTransaction"
  | "getMultipleAccountsInfo"
  | "getProgramAccounts"
  | "getMinimumLedgerSlot"
  | "getFirstAvailableBlock"
>;

export interface RpcSourceOptions {
  rpc: SolanaRpc;
  settlementProgram: PublicKey;
  decoder: SettlementDecoder;
  commitment?: Extract<Commitment, "confirmed" | "finalized">;
}

const ACCOUNTS_PER_CALL = 100;
/** Position of the receipt PDA in the accounts of `settle`. */
const SETTLE_RECEIPT_ACCOUNT = 5;
const SETTLE_DISCRIMINATOR = createHash("sha256").update("global:settle").digest().subarray(0, 8);
const LOG_TRUNCATED = "Log truncated";

function isSettle(data: Uint8Array): boolean {
  return data.length >= 8 && SETTLE_DISCRIMINATOR.equals(Buffer.from(data.subarray(0, 8)));
}

/**
 * Receipt addresses from the `settle` instructions of a transaction, top level and inner.
 * Used when the node truncated the logs, so the events cannot all be read.
 */
function settleReceiptAddresses(tx: VersionedTransactionResponse, program: PublicKey): string[] {
  const keys = tx.transaction.message.getAccountKeys({
    accountKeysFromLookups: tx.meta?.loadedAddresses ?? null,
  });
  const out: string[] = [];
  const visit = (programIndex: number, accounts: number[], data: Uint8Array) => {
    if (!keys.get(programIndex)?.equals(program) || !isSettle(data)) return;
    const idx = accounts[SETTLE_RECEIPT_ACCOUNT];
    const key = idx === undefined ? undefined : keys.get(idx);
    if (key) out.push(key.toBase58());
  };
  for (const ix of tx.transaction.message.compiledInstructions as MessageCompiledInstruction[]) {
    visit(ix.programIdIndex, ix.accountKeyIndexes, ix.data);
  }
  for (const inner of tx.meta?.innerInstructions ?? []) {
    for (const ix of inner.instructions) {
      visit(ix.programIdIndex, ix.accounts, bs58.decode(ix.data));
    }
  }
  return out;
}

/** Reads settlement receipts from a Solana RPC node. */
export function createRpcSource(opts: RpcSourceOptions): ReceiptSource {
  const { rpc, settlementProgram, decoder } = opts;
  const commitment = opts.commitment ?? "confirmed";

  async function receiptAccounts(addresses: string[]): Promise<(SettledReceipt | null)[]> {
    const out: (SettledReceipt | null)[] = [];
    for (let i = 0; i < addresses.length; i += ACCOUNTS_PER_CALL) {
      const chunk = addresses.slice(i, i + ACCOUNTS_PER_CALL);
      const infos = await rpc.getMultipleAccountsInfo(
        chunk.map((a) => new PublicKey(a)),
        commitment,
      );
      for (const [j, info] of infos.entries()) {
        const address = chunk[j];
        if (!info || !address || !info.owner.equals(settlementProgram)) {
          out.push(null);
          continue;
        }
        out.push(decoder.receiptFromAccount(address, info.data));
      }
    }
    return out;
  }

  return {
    async genesisHash() {
      return rpc.getGenesisHash();
    },

    async tipSlot() {
      return rpc.getSlot(commitment);
    },

    async signatures(page: SignaturePage): Promise<SignatureInfo[]> {
      let list: Awaited<ReturnType<SolanaRpc["getSignaturesForAddress"]>>;
      try {
        list = await rpc.getSignaturesForAddress(
          settlementProgram,
          {
            limit: page.limit,
            ...(page.until ? { until: page.until } : {}),
            ...(page.before ? { before: page.before } : {}),
          },
          commitment,
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (page.until && UNTIL_MISSING.test(msg)) {
          throw new UntilSignatureUnavailableError(
            `The node no longer holds signature ${page.until} (${msg}).`,
            { cause: err },
          );
        }
        throw err;
      }
      return list.map((s) => ({ signature: s.signature, slot: s.slot, failed: s.err !== null }));
    },

    async signatureKnown(signature) {
      const res = await rpc.getSignatureStatuses([signature], { searchTransactionHistory: true });
      return res.value[0] != null;
    },

    async transaction(signature): Promise<SettlementTransaction | null> {
      const tx = await rpc.getTransaction(signature, {
        commitment,
        maxSupportedTransactionVersion: 0,
      });
      if (!tx) return null;
      if (tx.meta?.err) return { signature, slot: tx.slot, receipts: [] };
      const logs = tx.meta?.logMessages;
      if (!logs) {
        throw new SourceError(
          `The node returned ${signature} without log messages, so its PaymentSettled events cannot be read. Use an RPC node that keeps transaction logs.`,
        );
      }
      const events = decoder.eventsFromLogs(logs);
      if (!logs.some((l) => l.includes(LOG_TRUNCATED))) {
        return { signature, slot: tx.slot, receipts: events };
      }
      // The logs were cut short, so some events may be missing. The settle instructions name
      // every receipt account, and the accounts hold the same fields as the events.
      const addresses = settleReceiptAddresses(tx, settlementProgram);
      const accounts = await receiptAccounts(addresses);
      const receipts: SettledReceipt[] = [];
      for (const [i, account] of accounts.entries()) {
        if (!account) {
          throw new SourceError(
            `Logs of ${signature} are truncated and receipt account ${addresses[i]} could not be read. The transaction is retried on the next tick.`,
          );
        }
        receipts.push(account);
      }
      return { signature, slot: tx.slot, receipts };
    },

    receiptAccounts,

    async historyStartSlot() {
      // The node can list signatures only from the first block it still stores.
      const [minimum, firstBlock] = await Promise.all([
        rpc.getMinimumLedgerSlot(),
        rpc.getFirstAvailableBlock(),
      ]);
      return Math.max(minimum, firstBlock);
    },

    async liveReceipts() {
      const accounts = await rpc.getProgramAccounts(settlementProgram, {
        commitment,
        filters: [{ memcmp: { offset: 0, bytes: bs58.encode(decoder.receiptDiscriminator) } }],
      });
      const out: SettledReceipt[] = [];
      for (const { pubkey, account } of accounts) {
        const r = decoder.receiptFromAccount(pubkey.toBase58(), account.data);
        if (r) out.push(r);
      }
      return out;
    },
  };
}
