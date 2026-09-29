import { PublicKey, SystemProgram, TransactionInstruction } from "@solana/web3.js";

export const TOKEN_PROGRAM_ID = new PublicKey("TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey(
  "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL",
);

/** SPL token account layout. The amount is a little endian u64 after mint and owner. */
const AMOUNT_OFFSET = 64;
const OWNER_OFFSET = 32;
export const TOKEN_ACCOUNT_SIZE = 165;

export function associatedTokenAddress(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}

/** Creates the owner's associated token account when missing and does nothing otherwise. */
export function createAssociatedTokenIdempotentInstruction(
  payer: PublicKey,
  owner: PublicKey,
  mint: PublicKey,
): TransactionInstruction {
  return new TransactionInstruction({
    programId: ASSOCIATED_TOKEN_PROGRAM_ID,
    keys: [
      { pubkey: payer, isSigner: true, isWritable: true },
      { pubkey: associatedTokenAddress(owner, mint), isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: false, isWritable: false },
      { pubkey: mint, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
    ],
    data: Buffer.from([1]),
  });
}

export interface TokenAccountInfo {
  owner: PublicKey;
  amount: bigint;
}

/** Reads owner and amount from SPL token account data. Returns null for anything else. */
export function decodeTokenAccount(
  data: Uint8Array,
  programOwner: PublicKey,
): TokenAccountInfo | null {
  if (!programOwner.equals(TOKEN_PROGRAM_ID) || data.length < TOKEN_ACCOUNT_SIZE) return null;
  const buf = Buffer.from(data);
  return {
    owner: new PublicKey(buf.subarray(OWNER_OFFSET, OWNER_OFFSET + 32)),
    amount: buf.readBigUInt64LE(AMOUNT_OFFSET),
  };
}
