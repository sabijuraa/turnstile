import { BN } from "@anchor-lang/core";
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { receiptAddress, SETTLEMENT_PROGRAM_ID } from "../src/index.js";
import {
  closeReceiptInstruction,
  decodeReceipt,
  RECEIPT_ACCOUNT_SIZE,
  RECEIPT_FEE_PAYER_OFFSET,
  RECEIPT_RETENTION_SECONDS,
  receiptReclaimable,
  settlementCoder,
  settlementIdl,
} from "../src/programs/index.js";

describe("receipt reclaim", () => {
  it("reads the retention period from the program IDL", () => {
    expect(RECEIPT_RETENTION_SECONDS).toBe(604_800n);
  });

  it("matches the on-chain Receipt layout for the fee payer filter", async () => {
    const feePayer = Keypair.generate().publicKey;
    const pk = () => Keypair.generate().publicKey;
    const data = await settlementCoder.accounts.encode("Receipt", {
      agent_wallet: pk(),
      owner: pk(),
      session_key: pk(),
      recipient: pk(),
      recipient_token: pk(),
      mint: pk(),
      amount: new BN(5),
      resource_id: Array(32).fill(1),
      nonce: Array(32).fill(2),
      slot: new BN(3),
      unix_timestamp: new BN(4),
      fee_payer: feePayer,
      bump: 254,
      expires_at: new BN(1_900_000_000),
    });
    expect(data.length).toBe(RECEIPT_ACCOUNT_SIZE);
    expect(
      data
        .subarray(RECEIPT_FEE_PAYER_OFFSET, RECEIPT_FEE_PAYER_OFFSET + 32)
        .equals(feePayer.toBuffer()),
    ).toBe(true);
    expect(decodeReceipt(data).expiresAt).toBe(1_900_000_000n);
  });

  it("is reclaimable only after the retention period", () => {
    const r = { expiresAt: 1_000n };
    expect(receiptReclaimable(r, 1_000n + RECEIPT_RETENTION_SECONDS)).toBe(false);
    expect(receiptReclaimable(r, 1_001n + RECEIPT_RETENTION_SECONDS)).toBe(true);
  });

  it("builds close_receipt with the receipt and a signing fee payer", () => {
    const feePayer = Keypair.generate().publicKey;
    const [receipt] = receiptAddress(Keypair.generate().publicKey, new Uint8Array(32).fill(7));
    const ix = closeReceiptInstruction({ receipt, feePayer });
    expect(ix.programId.equals(SETTLEMENT_PROGRAM_ID)).toBe(true);
    expect(ix.keys).toEqual([
      { pubkey: receipt, isSigner: false, isWritable: true },
      { pubkey: feePayer, isSigner: true, isWritable: true },
    ]);
    const spec = settlementIdl.instructions.find((i) => i.name === "close_receipt");
    expect(Array.from(ix.data)).toEqual(spec?.discriminator);
  });
});
