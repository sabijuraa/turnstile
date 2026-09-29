/**
 * TypeScript client for the agent_wallet and settlement programs.
 *
 * Everything here encodes and decodes through the Anchor IDL coder built from the program IDLs
 * in ./idl.ts. These builders and decoders are the only program encoders used off chain.
 */
import anchor, { type BN, type Idl } from "@anchor-lang/core";
import { getAssociatedTokenAddressSync, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  type AccountMeta,
  type Commitment,
  type Connection,
  type PublicKey,
  SYSVAR_INSTRUCTIONS_PUBKEY,
  SystemProgram,
  TransactionInstruction,
} from "@solana/web3.js";
import { ed25519VerifyInstruction, type PaymentAuthorization } from "../authorization.js";
import { AGENT_WALLET_PROGRAM_ID, SETTLEMENT_PROGRAM_ID } from "../constants.js";
import {
  agentWalletAddress,
  receiptAddress,
  settlementAuthorityAddress,
  vaultAddress,
} from "../pda.js";
import type { AllowListEntry, PolicyState, SessionKeyState, SpendBucket } from "../policy.js";
import { agentWalletIdl, settlementIdl } from "./idl.js";

export type { AgentWallet as AgentWalletIdlType } from "./agent_wallet.js";
export { agentWalletIdl, settlementIdl } from "./idl.js";
export type { Settlement as SettlementIdlType } from "./settlement.js";

// @anchor-lang/core is CommonJS. Node ESM only exposes its default export, so read the
// classes from there. Named value imports work under bundlers but fail under plain node.
const { BorshCoder, EventParser } = anchor;

export const agentWalletCoder = new BorshCoder(agentWalletIdl as unknown as Idl);
export const settlementCoder = new BorshCoder(settlementIdl as unknown as Idl);

// Raw shapes produced by the Borsh coder. Field names follow the Rust source.

interface RawSessionKey {
  key: PublicKey;
  expires_at: BN;
  active: boolean;
}
interface RawAllowListEntry {
  resource_id: number[];
  recipient: PublicKey;
}
interface RawSpendBucket {
  index: BN;
  amount: BN;
}
interface RawAgentWallet {
  owner: PublicKey;
  id: BN;
  mint: PublicKey;
  vault: PublicKey;
  bump: number;
  vault_bump: number;
  created_at: BN;
  per_call_cap: BN;
  daily_cap: BN;
  session_keys: RawSessionKey[];
  allow_list: RawAllowListEntry[];
  spend_buckets: RawSpendBucket[];
  total_spent: BN;
  settlement_count: BN;
}
interface RawReceipt {
  agent_wallet: PublicKey;
  owner: PublicKey;
  session_key: PublicKey;
  recipient: PublicKey;
  recipient_token: PublicKey;
  mint: PublicKey;
  amount: BN;
  resource_id: number[];
  nonce: number[];
  slot: BN;
  unix_timestamp: BN;
  fee_payer: PublicKey;
  bump: number;
  expires_at: BN;
}
interface RawPaymentSettled extends RawReceipt {
  receipt: PublicKey;
}

// Decoded, caller friendly shapes.

export interface AgentWalletAccount {
  owner: PublicKey;
  id: bigint;
  mint: PublicKey;
  vault: PublicKey;
  bump: number;
  vaultBump: number;
  createdAt: bigint;
  /** Policy in the shape `evaluatePayment` takes. `vaultBalance` is not part of the account. */
  policy: PolicyState;
  totalSpent: bigint;
  settlementCount: bigint;
}

export interface ReceiptAccount {
  agentWallet: PublicKey;
  owner: PublicKey;
  sessionKey: PublicKey;
  recipient: PublicKey;
  recipientToken: PublicKey;
  mint: PublicKey;
  amount: bigint;
  resourceId: Uint8Array;
  nonce: Uint8Array;
  slot: bigint;
  unixTimestamp: bigint;
  feePayer: PublicKey;
  bump: number;
  /** Unix seconds. `expiresAt` of the settled authorization. */
  expiresAt: bigint;
}

export interface PaymentSettledEvent extends ReceiptAccount {
  /** Address of the receipt PDA written by this settlement. */
  receipt: PublicKey;
}

const big = (v: BN): bigint => BigInt(v.toString());
const bn = (v: bigint): BN => new anchor.BN(v.toString());
const bytes = (v: number[]): Uint8Array => Uint8Array.from(v);
const toBytes32 = (v: Uint8Array, name: string): number[] => {
  if (v.length !== 32) throw new Error(`${name} must be 32 bytes`);
  return Array.from(v);
};

function toReceipt(raw: RawReceipt): ReceiptAccount {
  return {
    agentWallet: raw.agent_wallet,
    owner: raw.owner,
    sessionKey: raw.session_key,
    recipient: raw.recipient,
    recipientToken: raw.recipient_token,
    mint: raw.mint,
    amount: big(raw.amount),
    resourceId: bytes(raw.resource_id),
    nonce: bytes(raw.nonce),
    slot: big(raw.slot),
    unixTimestamp: big(raw.unix_timestamp),
    feePayer: raw.fee_payer,
    bump: raw.bump,
    expiresAt: big(raw.expires_at),
  };
}

/** Decodes AgentWallet account data, discriminator included. Throws on any other account. */
export function decodeAgentWallet(data: Uint8Array): AgentWalletAccount {
  const raw = agentWalletCoder.accounts.decode<RawAgentWallet>("AgentWallet", Buffer.from(data));
  const sessionKeys: SessionKeyState[] = raw.session_keys.map((k) => ({
    key: k.key,
    expiresAt: big(k.expires_at),
    active: k.active,
  }));
  const allowList: AllowListEntry[] = raw.allow_list.map((e) => ({
    resourceId: bytes(e.resource_id),
    recipient: e.recipient,
  }));
  const spendBuckets: SpendBucket[] = raw.spend_buckets.map((b) => ({
    index: big(b.index),
    amount: big(b.amount),
  }));
  return {
    owner: raw.owner,
    id: big(raw.id),
    mint: raw.mint,
    vault: raw.vault,
    bump: raw.bump,
    vaultBump: raw.vault_bump,
    createdAt: big(raw.created_at),
    policy: {
      perCallCap: big(raw.per_call_cap),
      dailyCap: big(raw.daily_cap),
      sessionKeys,
      allowList,
      spendBuckets,
    },
    totalSpent: big(raw.total_spent),
    settlementCount: big(raw.settlement_count),
  };
}

/** Decodes Receipt account data, discriminator included. Throws on any other account. */
export function decodeReceipt(data: Uint8Array): ReceiptAccount {
  return toReceipt(settlementCoder.accounts.decode<RawReceipt>("Receipt", Buffer.from(data)));
}

/**
 * Decodes every `PaymentSettled` event emitted by the settlement program in a transaction's
 * log messages. The event is emitted with `emit!`, so it is a `Program data:` log line inside
 * the settlement program's invocation. Logs from other programs are ignored.
 */
export function decodePaymentSettledEvents(
  logs: readonly string[],
  settlementProgram: PublicKey = SETTLEMENT_PROGRAM_ID,
): PaymentSettledEvent[] {
  const parser = new EventParser(settlementProgram, settlementCoder);
  const out: PaymentSettledEvent[] = [];
  for (const event of parser.parseLogs([...logs])) {
    if (event.name !== "PaymentSettled") continue;
    const raw = event.data as unknown as RawPaymentSettled;
    out.push({ ...toReceipt(raw), receipt: raw.receipt });
  }
  return out;
}

export async function fetchAgentWallet(
  connection: Connection,
  address: PublicKey,
  commitment: Commitment = "confirmed",
): Promise<AgentWalletAccount | null> {
  const info = await connection.getAccountInfo(address, commitment);
  if (!info) return null;
  if (!info.owner.equals(AGENT_WALLET_PROGRAM_ID)) {
    throw new Error(`${address.toBase58()} is not owned by the agent_wallet program`);
  }
  return decodeAgentWallet(info.data);
}

export async function fetchReceipt(
  connection: Connection,
  address: PublicKey,
  commitment: Commitment = "confirmed",
): Promise<ReceiptAccount | null> {
  const info = await connection.getAccountInfo(address, commitment);
  if (!info || info.data.length === 0) return null;
  if (!info.owner.equals(SETTLEMENT_PROGRAM_ID)) {
    throw new Error(`${address.toBase58()} is not owned by the settlement program`);
  }
  return decodeReceipt(info.data);
}

function idlConstant(constants: readonly { name: string; value: string }[], name: string): bigint {
  const found = constants.find((c) => c.name === name);
  if (!found) throw new Error(`The settlement IDL has no ${name} constant. Run sync-idl again.`);
  return BigInt(found.value);
}

/**
 * Seconds a receipt stays on chain after its authorization expires. After that the fee payer
 * that paid its rent may close it with `closeReceiptInstruction`.
 */
export const RECEIPT_RETENTION_SECONDS: bigint = idlConstant(
  settlementIdl.constants,
  "RECEIPT_RETENTION_SECONDS",
);

/** Size of a Receipt account in bytes, discriminator included. */
export const RECEIPT_ACCOUNT_SIZE = 329;

/** Byte offset of `fee_payer` in Receipt account data, for a getProgramAccounts memcmp filter. */
export const RECEIPT_FEE_PAYER_OFFSET = 288;

/** True when `close_receipt` accepts this receipt at chain time `now` (unix seconds). */
export function receiptReclaimable(
  receipt: Pick<ReceiptAccount, "expiresAt">,
  now: bigint,
): boolean {
  return now > receipt.expiresAt + RECEIPT_RETENTION_SECONDS;
}

// Instruction builders.

function meta(pubkey: PublicKey, isSigner: boolean, isWritable: boolean): AccountMeta {
  return { pubkey, isSigner, isWritable };
}

function agentWalletIx(
  name: string,
  args: Record<string, unknown>,
  keys: AccountMeta[],
): TransactionInstruction {
  return new TransactionInstruction({
    programId: AGENT_WALLET_PROGRAM_ID,
    keys,
    data: agentWalletCoder.instruction.encode(name, args),
  });
}

export interface CreateWalletParams {
  owner: PublicKey;
  mint: PublicKey;
  id: bigint;
  perCallCap: bigint;
  dailyCap: bigint;
  sessionKey: PublicKey;
  /** Unix seconds, 0n for no expiry. */
  sessionExpiresAt: bigint;
}

/** Creates the agent wallet and its vault. The owner signs and pays rent. */
export function createWalletInstruction(p: CreateWalletParams): TransactionInstruction {
  const [agentWallet] = agentWalletAddress(p.owner, p.id);
  const [vault] = vaultAddress(agentWallet);
  return agentWalletIx(
    "create_wallet",
    {
      id: bn(p.id),
      per_call_cap: bn(p.perCallCap),
      daily_cap: bn(p.dailyCap),
      session_key: p.sessionKey,
      session_expires_at: bn(p.sessionExpiresAt),
    },
    [
      meta(p.owner, true, true),
      meta(agentWallet, false, true),
      meta(p.mint, false, false),
      meta(vault, false, true),
      meta(TOKEN_PROGRAM_ID, false, false),
      meta(SystemProgram.programId, false, false),
    ],
  );
}

export interface TokenMoveParams {
  owner: PublicKey;
  agentWallet: PublicKey;
  /** Owner token account of the wallet mint. Withdraw requires the owner to own it. */
  ownerToken: PublicKey;
  amount: bigint;
}

export function depositInstruction(p: TokenMoveParams): TransactionInstruction {
  return agentWalletIx("deposit", { amount: bn(p.amount) }, [
    meta(p.owner, true, false),
    meta(p.agentWallet, false, false),
    meta(vaultAddress(p.agentWallet)[0], false, true),
    meta(p.ownerToken, false, true),
    meta(TOKEN_PROGRAM_ID, false, false),
  ]);
}

export function withdrawInstruction(p: TokenMoveParams): TransactionInstruction {
  return agentWalletIx("withdraw", { amount: bn(p.amount) }, [
    meta(p.owner, true, false),
    meta(p.agentWallet, false, false),
    meta(vaultAddress(p.agentWallet)[0], false, true),
    meta(p.ownerToken, false, true),
    meta(TOKEN_PROGRAM_ID, false, false),
  ]);
}

function ownerOnly(owner: PublicKey, agentWallet: PublicKey): AccountMeta[] {
  return [meta(owner, true, false), meta(agentWallet, false, true)];
}

export function addSessionKeyInstruction(p: {
  owner: PublicKey;
  agentWallet: PublicKey;
  sessionKey: PublicKey;
  /** Unix seconds, 0n for no expiry. */
  expiresAt: bigint;
}): TransactionInstruction {
  return agentWalletIx(
    "add_session_key",
    { key: p.sessionKey, expires_at: bn(p.expiresAt) },
    ownerOnly(p.owner, p.agentWallet),
  );
}

export function revokeSessionKeyInstruction(p: {
  owner: PublicKey;
  agentWallet: PublicKey;
  sessionKey: PublicKey;
}): TransactionInstruction {
  return agentWalletIx(
    "revoke_session_key",
    { key: p.sessionKey },
    ownerOnly(p.owner, p.agentWallet),
  );
}

/**
 * The program stores up to 16 allow-list entries, but one legacy transaction of 1232 bytes fits
 * at most 15 of them in `update_policy`, which is also what the Anchor coder can encode.
 */
export const MAX_ALLOW_LIST_PER_UPDATE = 15;

export function updatePolicyInstruction(p: {
  owner: PublicKey;
  agentWallet: PublicKey;
  perCallCap: bigint;
  dailyCap: bigint;
  allowList: AllowListEntry[];
}): TransactionInstruction {
  if (p.allowList.length > MAX_ALLOW_LIST_PER_UPDATE) {
    throw new Error(
      `update_policy takes at most ${MAX_ALLOW_LIST_PER_UPDATE} allow-list entries in one transaction, got ${p.allowList.length}.`,
    );
  }
  return agentWalletIx(
    "update_policy",
    {
      per_call_cap: bn(p.perCallCap),
      daily_cap: bn(p.dailyCap),
      allow_list: p.allowList.map((e) => ({
        resource_id: toBytes32(e.resourceId, "resourceId"),
        recipient: e.recipient,
      })),
    },
    ownerOnly(p.owner, p.agentWallet),
  );
}

/** Closes an empty vault and the wallet. Rent goes back to the owner. */
export function closeWalletInstruction(p: {
  owner: PublicKey;
  agentWallet: PublicKey;
}): TransactionInstruction {
  return agentWalletIx("close_wallet", {}, [
    meta(p.owner, true, true),
    meta(p.agentWallet, false, true),
    meta(vaultAddress(p.agentWallet)[0], false, true),
    meta(TOKEN_PROGRAM_ID, false, false),
  ]);
}

/**
 * Read only view. Simulate it and read the u64 from return data with
 * `decodeRollingSpendReturnData`, or compute it locally with `rollingSpend` from the policy.
 */
export function rollingSpendInstruction(p: { agentWallet: PublicKey }): TransactionInstruction {
  return agentWalletIx("rolling_spend", {}, [meta(p.agentWallet, false, false)]);
}

/** Decodes the base64 return data of `rolling_spend` as base units. */
export function decodeRollingSpendReturnData(base64: string): bigint {
  const buf = Buffer.from(base64, "base64");
  if (buf.length !== 8)
    throw new Error(`rolling_spend return data must be 8 bytes, got ${buf.length}`);
  return buf.readBigUInt64LE(0);
}

export interface SettleParams {
  authorization: PaymentAuthorization;
  /** 64 byte Ed25519 signature by the session key over `authorizationMessage(authorization)`. */
  signature: Uint8Array;
  /** Pays the fee and the receipt rent. */
  feePayer: PublicKey;
  /** Recipient token account. Defaults to the associated token account of the recipient. */
  recipientToken?: PublicKey;
}

/**
 * Returns `[ed25519Ix, settleIx]`. Both must go in one transaction, in this order, with nothing
 * between them.
 */
export function settleInstructions(
  p: SettleParams,
): [TransactionInstruction, TransactionInstruction] {
  const a = p.authorization;
  const recipientToken =
    p.recipientToken ?? getAssociatedTokenAddressSync(a.mint, a.recipient, true);
  const settle = new TransactionInstruction({
    programId: SETTLEMENT_PROGRAM_ID,
    keys: [
      meta(p.feePayer, true, true),
      meta(settlementAuthorityAddress()[0], false, false),
      meta(a.agentWallet, false, true),
      meta(vaultAddress(a.agentWallet)[0], false, true),
      meta(recipientToken, false, true),
      meta(receiptAddress(a.agentWallet, a.nonce)[0], false, true),
      meta(SYSVAR_INSTRUCTIONS_PUBKEY, false, false),
      meta(AGENT_WALLET_PROGRAM_ID, false, false),
      meta(TOKEN_PROGRAM_ID, false, false),
      meta(SystemProgram.programId, false, false),
    ],
    data: settlementCoder.instruction.encode("settle", {
      authorization: {
        agent_wallet: a.agentWallet,
        session_key: a.sessionKey,
        recipient: a.recipient,
        mint: a.mint,
        amount: bn(a.amount),
        resource_id: toBytes32(a.resourceId, "resourceId"),
        nonce: toBytes32(a.nonce, "nonce"),
        expires_at: bn(a.expiresAt),
      },
    }),
  });
  return [ed25519VerifyInstruction(a, p.signature), settle];
}

/**
 * Closes a receipt once its retention period has passed and returns its rent to the fee payer
 * that paid it. `feePayer` must sign. `receipt` is the receipt PDA address.
 */
export function closeReceiptInstruction(p: {
  receipt: PublicKey;
  feePayer: PublicKey;
}): TransactionInstruction {
  return new TransactionInstruction({
    programId: SETTLEMENT_PROGRAM_ID,
    keys: [meta(p.receipt, false, true), meta(p.feePayer, true, true)],
    data: settlementCoder.instruction.encode("close_receipt", {}),
  });
}

// Errors.

export type ProgramName = "agent_wallet" | "settlement";

export interface ProgramErrorInfo {
  code: number;
  name: string;
  message: string;
  program: ProgramName;
}

interface IdlErrorEntry {
  code: number;
  name: string;
  msg?: string;
}

function errorsOf(idl: { errors?: IdlErrorEntry[] }, program: ProgramName): ProgramErrorInfo[] {
  return (idl.errors ?? []).map((e) => ({
    code: e.code,
    name: e.name,
    message: e.msg ?? e.name,
    program,
  }));
}

/**
 * Custom error codes of both programs. agent_wallet uses 6000 and up, settlement 6100 and up,
 * so a code is unambiguous even when the agent_wallet error surfaces through the settle CPI.
 */
export const PROGRAM_ERRORS: ReadonlyMap<number, ProgramErrorInfo> = new Map(
  [
    ...errorsOf(agentWalletIdl as unknown as { errors?: IdlErrorEntry[] }, "agent_wallet"),
    ...errorsOf(settlementIdl as unknown as { errors?: IdlErrorEntry[] }, "settlement"),
  ].map((e) => [e.code, e]),
);

/** Error name for a custom program error code, or null when the code is not one of ours. */
export function programErrorName(code: number): string | null {
  return PROGRAM_ERRORS.get(code)?.name ?? null;
}

/**
 * Finds the Turnstile program error in a failed transaction. Accepts the `err` value from
 * `getTransaction` or `simulateTransaction` (`{ InstructionError: [index, { Custom: code }] }`),
 * a thrown SendTransactionError, or log lines.
 */
export function parseProgramError(
  input: unknown,
  logs?: readonly string[],
): ProgramErrorInfo | null {
  const fromCode = (code: number) => PROGRAM_ERRORS.get(code) ?? null;
  if (input && typeof input === "object" && "InstructionError" in input) {
    const ie = (input as { InstructionError: unknown }).InstructionError;
    if (Array.isArray(ie) && ie[1] && typeof ie[1] === "object" && "Custom" in ie[1]) {
      const code = (ie[1] as { Custom: unknown }).Custom;
      if (typeof code === "number") return fromCode(code);
    }
  }
  const lines: string[] = [...(logs ?? [])];
  if (input && typeof input === "object" && "logs" in input) {
    const l = (input as { logs: unknown }).logs;
    if (Array.isArray(l)) lines.push(...l.filter((x): x is string => typeof x === "string"));
  }
  if (input instanceof Error) lines.push(input.message);
  for (const line of lines) {
    const m =
      /Error Number: (\d+)\./.exec(line) ?? /custom program error: 0x([0-9a-fA-F]+)/.exec(line);
    if (!m?.[1]) continue;
    const code = m[0].startsWith("Error Number") ? Number(m[1]) : Number.parseInt(m[1], 16);
    const found = fromCode(code);
    if (found) return found;
  }
  return null;
}
