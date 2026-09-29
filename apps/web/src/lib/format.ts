/** Display helpers shared by data components. Amount math stays in bigint so nothing drifts. */

export type MeterTone = "normal" | "caution" | "critical";

/** Share of the cap already used, clamped to 0..1. A zero cap reads as full once anything is spent. */
export function meterRatio(spent: bigint, cap: bigint): number {
  if (spent <= 0n) return 0;
  if (cap <= 0n || spent >= cap) return 1;
  // Scale to parts per million in bigint, then convert once.
  return Number((spent * 1_000_000n) / cap) / 1_000_000;
}

/** Tone for a meter. At or past the cap is critical. At or past `cautionAt` is caution. */
export function meterTone(spent: bigint, cap: bigint, cautionAt = 0.8): MeterTone {
  if (cap <= 0n ? spent > 0n : spent >= cap) return "critical";
  return meterRatio(spent, cap) >= cautionAt ? "caution" : "normal";
}

/** Inserts thin group separators into the whole part of an exact decimal string. */
export function groupDigits(decimal: string): string {
  const negative = decimal.startsWith("-");
  const body = negative ? decimal.slice(1) : decimal;
  const [whole = "0", frac] = body.split(".");
  const grouped = whole.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  return `${negative ? "-" : ""}${grouped}${frac ? `.${frac}` : ""}`;
}

/** Shortens a base58 address or signature to its head and tail, for example 7onz…aiLb. */
export function shortAddress(value: string, head = 4, tail = 4): string {
  if (value.length <= head + tail + 1) return value;
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const timeFormatters = new Map<string, Intl.DateTimeFormat>();

/**
 * Formats an ISO timestamp as "29 Sep 14:32:08". The month names are fixed here rather than taken
 * from the runtime locale data, so the server and every browser print exactly the same string and
 * hydration never disagrees. The zone is explicit and defaults to UTC.
 */
export function formatTimestamp(iso: string, timeZone = "UTC"): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error(`"${iso}" is not a valid ISO timestamp`);
  let formatter = timeFormatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      day: "numeric",
      month: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    });
    timeFormatters.set(timeZone, formatter);
  }
  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) parts[part.type] = part.value;
  const month = MONTHS[Number(parts.month) - 1] ?? "";
  return `${parts.day} ${month} ${parts.hour}:${parts.minute}:${parts.second}`;
}
