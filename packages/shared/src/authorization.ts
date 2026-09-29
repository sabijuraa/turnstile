import { ed25519 } from "@noble/curves/ed25519.js";
import { Ed25519Program, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { bytesToHex, hexToBytes } from "./bytes.js";
import {
  AUTHORIZATION_BODY_LEN,
  AUTHORIZATION_DOMAIN,
  AUTHORIZATION_MESSAGE_LEN,
  SETTLEMENT_PROGRAM_ID,
} from "./constants.js";

/** A payment the agent's session key has agreed to. Mirrors the on-chain struct. */
export interface PaymentAuthorization {
  agentWallet: PublicKey;
  sessionKey: PublicKey;
  /** Owner of the recipient token account. */
  recipient: PublicKey;
  mint: PublicKey;
  /** Base units of the mint. */
  amount: bigint;
  resourceId: Uint8Array;
  nonce: Uint8Array;
  /** Unix seconds. */
  expiresAt: bigint;
}

/** JSON-safe form used on the wire inside x402 payloads. */
export interface PaymentAuthorizationWire {
  agentWallet: string;
  sessionKey: string;
  recipient: string;
  mint: string;
  amount: string;
  resourceId: string;
  nonce: string;
  expiresAt: string;
}

const U64_MAX = (1n << 64n) - 1n;
const I64_MAX = (1n << 63n) - 1n;

export function encodeAuthorizationBody(auth: PaymentAuthorization): Uint8Array {
  if (auth.resourceId.length !== 32) throw new Error("resourceId must be 32 bytes");
  if (auth.nonce.length !== 32) throw new Error("nonce must be 32 bytes");
  if (auth.amount <= 0n || auth.amount > U64_MAX) throw new Error("amount out of range");
  if (auth.expiresAt < 0n || auth.expiresAt > I64_MAX) throw new Error("expiresAt out of range");
  const buf = Buffer.alloc(AUTHORIZATION_BODY_LEN);
  let o = 0;
  for (const key of [auth.agentWallet, auth.sessionKey, auth.recipient, auth.mint]) {
    key.toBuffer().copy(buf, o);
    o += 32;
  }
  buf.writeBigUInt64LE(auth.amount, o);
  o += 8;
  Buffer.from(auth.resourceId).copy(buf, o);
  o += 32;
  Buffer.from(auth.nonce).copy(buf, o);
  o += 32;
  buf.writeBigInt64LE(auth.expiresAt, o);
  return new Uint8Array(buf);
}

/** The exact bytes the session key signs and the Ed25519 program verifies. */
export function authorizationMessage(
  auth: PaymentAuthorization,
  settlementProgram: PublicKey = SETTLEMENT_PROGRAM_ID,
): Uint8Array {
  const out = new Uint8Array(AUTHORIZATION_MESSAGE_LEN);
  out.set(new TextEncoder().encode(AUTHORIZATION_DOMAIN), 0);
  out.set(settlementProgram.toBytes(), 20);
  out.set(encodeAuthorizationBody(auth), 52);
  return out;
}

/** Signs with a Solana 64 byte secret key (seed followed by public key). */
export function signAuthorization(
  auth: PaymentAuthorization,
  secretKey: Uint8Array,
  settlementProgram: PublicKey = SETTLEMENT_PROGRAM_ID,
): Uint8Array {
  if (secretKey.length !== 64) throw new Error("secretKey must be 64 bytes");
  return ed25519.sign(authorizationMessage(auth, settlementProgram), secretKey.slice(0, 32));
}

export function verifyAuthorizationSignature(
  auth: PaymentAuthorization,
  signature: Uint8Array,
  settlementProgram: PublicKey = SETTLEMENT_PROGRAM_ID,
): boolean {
  try {
    return ed25519.verify(
      signature,
      authorizationMessage(auth, settlementProgram),
      auth.sessionKey.toBytes(),
    );
  } catch {
    return false;
  }
}

/** The Ed25519 program instruction that must precede `settle` in the same transaction. */
export function ed25519VerifyInstruction(
  auth: PaymentAuthorization,
  signature: Uint8Array,
  settlementProgram: PublicKey = SETTLEMENT_PROGRAM_ID,
): TransactionInstruction {
  return Ed25519Program.createInstructionWithPublicKey({
    publicKey: auth.sessionKey.toBytes(),
    message: authorizationMessage(auth, settlementProgram),
    signature,
  });
}

export function randomNonce(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

export function authorizationToWire(auth: PaymentAuthorization): PaymentAuthorizationWire {
  return {
    agentWallet: auth.agentWallet.toBase58(),
    sessionKey: auth.sessionKey.toBase58(),
    recipient: auth.recipient.toBase58(),
    mint: auth.mint.toBase58(),
    amount: auth.amount.toString(),
    resourceId: bytesToHex(auth.resourceId),
    nonce: bytesToHex(auth.nonce),
    expiresAt: auth.expiresAt.toString(),
  };
}

/** Parses the wire form. Throws a descriptive error on any malformed field. */
export function authorizationFromWire(wire: PaymentAuthorizationWire): PaymentAuthorization {
  const key = (name: string, value: unknown): PublicKey => {
    if (typeof value !== "string") throw new Error(`${name} must be a base58 string`);
    try {
      return new PublicKey(value);
    } catch {
      throw new Error(`${name} is not a valid public key`);
    }
  };
  const int = (name: string, value: unknown): bigint => {
    if (typeof value !== "string" || !/^\d+$/.test(value)) {
      throw new Error(`${name} must be a decimal integer string`);
    }
    return BigInt(value);
  };
  const bytes32 = (name: string, value: unknown): Uint8Array => {
    if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
      throw new Error(`${name} must be 64 lowercase hex characters`);
    }
    return hexToBytes(value);
  };
  return {
    agentWallet: key("agentWallet", wire.agentWallet),
    sessionKey: key("sessionKey", wire.sessionKey),
    recipient: key("recipient", wire.recipient),
    mint: key("mint", wire.mint),
    amount: int("amount", wire.amount),
    resourceId: bytes32("resourceId", wire.resourceId),
    nonce: bytes32("nonce", wire.nonce),
    expiresAt: int("expiresAt", wire.expiresAt),
  };
}
