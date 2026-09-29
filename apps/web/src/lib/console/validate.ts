/** Inline validation for console forms. It mirrors the agent wallet program rules. */

import { canonicalResource, formatUnits, parseUnits } from "@turnstile/shared";
import bs58 from "bs58";

export const MAX_ALLOW_LIST_ENTRIES = 15;
const U64_MAX = (1n << 64n) - 1n;

/** True for a base58 string that decodes to 32 bytes, the size of a Solana public key. */
export function isAddress(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 32 || trimmed.length > 44) return false;
  try {
    return bs58.decode(trimmed).length === 32;
  } catch {
    return false;
  }
}

export function addressError(value: string, what: string): string | undefined {
  if (!value.trim()) return `Enter the ${what}.`;
  if (!isAddress(value)) {
    return `This is not a valid ${what}. Paste the base58 public key, 32 to 44 characters long.`;
  }
  return undefined;
}

export type AmountCheck = { ok: true; units: bigint } | { ok: false; error: string };

/** Parses a decimal amount exactly. Never rounds. */
export function checkAmount(
  value: string,
  decimals: number,
  options: { allowZero?: boolean; label?: string } = {},
): AmountCheck {
  const trimmed = value.trim();
  const label = options.label ?? "an amount";
  if (!trimmed) return { ok: false, error: `Enter ${label}, for example 1.25.` };
  if (!/^\d+(\.\d+)?$/.test(trimmed)) {
    return { ok: false, error: "Use digits and one decimal point only, for example 1.25." };
  }
  const fraction = trimmed.split(".")[1] ?? "";
  if (fraction.length > decimals) {
    return {
      ok: false,
      error: `Use at most ${decimals} decimal places. The stablecoin has ${decimals} decimals.`,
    };
  }
  const units = parseUnits(trimmed, decimals);
  if (units > U64_MAX)
    return { ok: false, error: "This amount is larger than the chain can hold." };
  if (units === 0n && !options.allowZero)
    return { ok: false, error: "Enter an amount above zero." };
  return { ok: true, units };
}

export type ResourceCheck =
  | { ok: true; canonical: string; idOnly: boolean }
  | { ok: false; error: string };

/** The canonical resource string the programs hash, or why the input cannot become one. */
export function checkResource(value: string): ResourceCheck {
  const trimmed = value.trim();
  if (!trimmed) return { ok: false, error: "Enter the URL of the paid route." };
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return { ok: true, canonical: trimmed.toLowerCase(), idOnly: true };
  }
  if (!/^https?:\/\//i.test(trimmed)) {
    return { ok: false, error: "Enter the full URL, starting with https:// or http://." };
  }
  try {
    return { ok: true, canonical: canonicalResource(trimmed), idOnly: false };
  } catch {
    return { ok: false, error: "This URL cannot be read. Check it for typos." };
  }
}

export function checkCaps(
  perCall: AmountCheck,
  daily: AmountCheck,
  decimals: number,
): string | undefined {
  if (!perCall.ok || !daily.ok) return undefined;
  if (perCall.units > daily.units) {
    return `The per-call cap cannot be above the daily cap of ${formatUnits(daily.units, decimals)}. Lower it or raise the daily cap.`;
  }
  return undefined;
}

export interface AllowDraft {
  key: string;
  resource: string;
  recipient: string;
}

export interface AllowErrors {
  resource?: string;
  recipient?: string;
}

/** Checks every allow-list row, including repeated resource and recipient pairs. */
export function checkAllowList(rows: readonly AllowDraft[]): {
  errors: Record<string, AllowErrors>;
  listError?: string;
} {
  const errors: Record<string, AllowErrors> = {};
  const seen = new Map<string, string>();
  for (const row of rows) {
    const e: AllowErrors = {};
    const resource = checkResource(row.resource);
    if (!resource.ok) e.resource = resource.error;
    e.recipient = addressError(row.recipient, "recipient address");
    if (resource.ok && !e.recipient) {
      const pair = `${resource.canonical} ${row.recipient.trim()}`;
      if (seen.has(pair)) e.resource = "This resource and recipient pair is already on the list.";
      else seen.set(pair, row.key);
    }
    if (e.resource || e.recipient) errors[row.key] = e;
  }
  return {
    errors,
    listError:
      rows.length > MAX_ALLOW_LIST_ENTRIES
        ? `The allow-list holds at most ${MAX_ALLOW_LIST_ENTRIES} entries per change. Remove ${rows.length - MAX_ALLOW_LIST_ENTRIES}.`
        : undefined,
  };
}

/** Turns a datetime-local value into an ISO timestamp, or explains why it cannot be used. */
export function checkExpiry(
  value: string,
  now = Date.now(),
): { iso: string | null; error?: string } {
  if (!value) return { iso: null };
  const ms = new Date(value).getTime();
  if (Number.isNaN(ms)) return { iso: null, error: "Enter a date and time, or leave it empty." };
  if (ms <= now + 60_000) {
    return { iso: null, error: "Pick a time in the future, or leave it empty for no expiry." };
  }
  return { iso: new Date(ms).toISOString() };
}
