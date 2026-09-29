import type { PublicKey } from "@solana/web3.js";
import { bytesToHex } from "@turnstile/shared";
import {
  decodePaymentSettledEvents,
  decodeReceipt,
  type ReceiptAccount,
} from "@turnstile/shared/programs";
import type { SettlementDecoder } from "./rpc-source.js";
import type { SettledReceipt } from "./source.js";

function toSettled(address: string, r: ReceiptAccount): SettledReceipt {
  return {
    receiptAddress: address,
    agentWallet: r.agentWallet.toBase58(),
    owner: r.owner.toBase58(),
    sessionKey: r.sessionKey.toBase58(),
    recipient: r.recipient.toBase58(),
    recipientToken: r.recipientToken.toBase58(),
    mint: r.mint.toBase58(),
    amount: r.amount,
    resourceId: bytesToHex(r.resourceId),
    nonce: bytesToHex(r.nonce),
    slot: r.slot,
    unixTimestamp: r.unixTimestamp,
    feePayer: r.feePayer.toBase58(),
  };
}

/** Decodes settlement events and receipt accounts with the shared program client. */
export function createSettlementDecoder(settlementProgram: PublicKey): SettlementDecoder {
  return {
    eventsFromLogs(logs) {
      return decodePaymentSettledEvents(logs, settlementProgram).map((e) =>
        toSettled(e.receipt.toBase58(), e),
      );
    },
    receiptFromAccount(address, data) {
      return toSettled(address, decodeReceipt(data));
    },
  };
}
