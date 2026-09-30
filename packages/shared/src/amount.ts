import { STABLECOIN_DECIMALS } from "./units.js";

/** Formats base units as an exact decimal string, for example 12500n becomes "0.0125". */
export function formatUnits(value: bigint, decimals: number = STABLECOIN_DECIMALS): string {
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const base = 10n ** BigInt(decimals);
  const whole = abs / base;
  const frac = (abs % base).toString().padStart(decimals, "0").replace(/0+$/, "");
  return `${negative ? "-" : ""}${whole}${frac ? `.${frac}` : ""}`;
}

/** Parses a decimal string into base units exactly. Rejects more precision than the mint has. */
export function parseUnits(value: string, decimals: number = STABLECOIN_DECIMALS): bigint {
  const trimmed = value.trim();
  const match = /^(\d+)(?:\.(\d+))?$/.exec(trimmed);
  if (!match) throw new Error(`"${value}" is not a positive decimal amount`);
  const whole = match[1] ?? "0";
  const frac = match[2] ?? "";
  if (frac.length > decimals) {
    throw new Error(`"${value}" has more than ${decimals} decimal places`);
  }
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(frac.padEnd(decimals, "0") || "0");
}
