import type { PublicKey } from "@solana/web3.js";
import { bytesEqual } from "./bytes.js";
import { SPEND_BUCKET_SECONDS, SPEND_WINDOW_LOOKBACK } from "./constants.js";

export interface SessionKeyState {
  key: PublicKey;
  /** Unix seconds, 0n means no expiry. */
  expiresAt: bigint;
  active: boolean;
}

export interface AllowListEntry {
  resourceId: Uint8Array;
  recipient: PublicKey;
}

export interface SpendBucket {
  index: bigint;
  amount: bigint;
}

/** The parts of an agent wallet that decide whether a payment may settle. */
export interface PolicyState {
  perCallCap: bigint;
  dailyCap: bigint;
  sessionKeys: SessionKeyState[];
  allowList: AllowListEntry[];
  spendBuckets: SpendBucket[];
  vaultBalance?: bigint;
}

export interface PaymentIntent {
  sessionKey: PublicKey;
  amount: bigint;
  resourceId: Uint8Array;
  recipient: PublicKey;
}

/** Names match the on-chain agent_wallet error variants. */
export type PolicyViolation =
  | "ZeroAmount"
  | "SessionKeyNotFound"
  | "SessionKeyRevoked"
  | "SessionKeyExpired"
  | "PerCallCapExceeded"
  | "ResourceNotAllowed"
  | "DailyCapExceeded"
  | "InsufficientFunds";

export type PolicyDecision =
  | { ok: true; rollingSpend: bigint }
  | { ok: false; reason: PolicyViolation; message: string };

export function bucketIndex(unixSeconds: bigint): bigint {
  return unixSeconds / BigInt(SPEND_BUCKET_SECONDS);
}

/** Spend that still counts toward the daily cap at `nowUnix`. Mirrors the program exactly. */
export function rollingSpend(buckets: SpendBucket[], nowUnix: bigint): bigint {
  const floor = bucketIndex(nowUnix) - BigInt(SPEND_WINDOW_LOOKBACK);
  let total = 0n;
  for (const b of buckets) if (b.amount > 0n && b.index >= floor) total += b.amount;
  return total;
}

/**
 * Evaluates a payment against a policy in the same order as the on-chain debit.
 * The chain is authoritative. This exists so clients can refuse early and explain why.
 */
export function evaluatePayment(
  policy: PolicyState,
  intent: PaymentIntent,
  nowUnix: bigint,
): PolicyDecision {
  if (intent.amount <= 0n) {
    return { ok: false, reason: "ZeroAmount", message: "The payment amount must be above zero." };
  }
  const key = policy.sessionKeys.find((k) => k.key.equals(intent.sessionKey));
  if (!key) {
    return {
      ok: false,
      reason: "SessionKeyNotFound",
      message: "This session key is not registered on the agent wallet.",
    };
  }
  if (!key.active) {
    return { ok: false, reason: "SessionKeyRevoked", message: "This session key was revoked." };
  }
  if (key.expiresAt !== 0n && nowUnix > key.expiresAt) {
    return { ok: false, reason: "SessionKeyExpired", message: "This session key has expired." };
  }
  if (intent.amount > policy.perCallCap) {
    return {
      ok: false,
      reason: "PerCallCapExceeded",
      message: `The price ${intent.amount} is above the per-call cap of ${policy.perCallCap}.`,
    };
  }
  const allowed = policy.allowList.some(
    (e) => bytesEqual(e.resourceId, intent.resourceId) && e.recipient.equals(intent.recipient),
  );
  if (!allowed) {
    return {
      ok: false,
      reason: "ResourceNotAllowed",
      message: "This resource and recipient pair is not on the allow-list.",
    };
  }
  const spent = rollingSpend(policy.spendBuckets, nowUnix);
  if (spent + intent.amount > policy.dailyCap) {
    return {
      ok: false,
      reason: "DailyCapExceeded",
      message: `Paying ${intent.amount} would take the last 24 hours to ${spent + intent.amount}, above the daily cap of ${policy.dailyCap}.`,
    };
  }
  if (policy.vaultBalance !== undefined && policy.vaultBalance < intent.amount) {
    return {
      ok: false,
      reason: "InsufficientFunds",
      message: "The agent wallet vault does not hold enough to pay.",
    };
  }
  return { ok: true, rollingSpend: spent };
}
