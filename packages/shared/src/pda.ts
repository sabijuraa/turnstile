import { PublicKey } from "@solana/web3.js";
import {
  AGENT_WALLET_PROGRAM_ID,
  SEED_AGENT_WALLET,
  SEED_RECEIPT,
  SEED_SETTLEMENT_AUTHORITY,
  SEED_VAULT,
  SETTLEMENT_PROGRAM_ID,
} from "./constants.js";

function u64Le(value: bigint): Buffer {
  const buf = Buffer.alloc(8);
  buf.writeBigUInt64LE(value);
  return buf;
}

export function agentWalletAddress(
  owner: PublicKey,
  id: bigint,
  programId: PublicKey = AGENT_WALLET_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_AGENT_WALLET), owner.toBuffer(), u64Le(id)],
    programId,
  );
}

export function vaultAddress(
  agentWallet: PublicKey,
  programId: PublicKey = AGENT_WALLET_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_VAULT), agentWallet.toBuffer()],
    programId,
  );
}

export function receiptAddress(
  agentWallet: PublicKey,
  nonce: Uint8Array,
  programId: PublicKey = SETTLEMENT_PROGRAM_ID,
): [PublicKey, number] {
  if (nonce.length !== 32) throw new Error("Nonce must be 32 bytes");
  return PublicKey.findProgramAddressSync(
    [Buffer.from(SEED_RECEIPT), agentWallet.toBuffer(), Buffer.from(nonce)],
    programId,
  );
}

export function settlementAuthorityAddress(
  programId: PublicKey = SETTLEMENT_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from(SEED_SETTLEMENT_AUTHORITY)], programId);
}
