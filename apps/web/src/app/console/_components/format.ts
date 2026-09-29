import { groupDigits } from "@/lib/format";

/** An exact decimal from the backend, grouped for reading. */
export function amountText(display: string): string {
  return groupDigits(display);
}

/** Readable name for an agent. The label when set, otherwise Agent and its id. */
export function agentName(agent: { label: string | null; id: string }): string {
  return agent.label ?? `Agent ${agent.id}`;
}

/** Date and time in UTC for tables, for example "29 Sep 2026, 14:32 UTC". */
export function dateTimeText(iso: string): string {
  const d = new Date(iso);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}, ${hh}:${mm} UTC`;
}

export function dateText(iso: string): string {
  const d = new Date(iso);
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
