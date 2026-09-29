import type { ReceiptView } from "./receipts.js";

export const CSV_COLUMNS = [
  "block_time",
  "receipt_address",
  "signature",
  "agent_wallet",
  "agent_label",
  "resource",
  "resource_id",
  "recipient",
  "mint",
  "amount",
  "amount_base_units",
  "nonce",
  "slot",
  "network",
  "status",
] as const;

/** Quotes a cell when needed and neutralizes values a spreadsheet would run as a formula. */
export function csvCell(value: string | null): string {
  let v = value ?? "";
  if (/^[=+\-@\t\r]/.test(v)) v = `'${v}`;
  if (/[",\r\n]/.test(v)) v = `"${v.replace(/"/g, '""')}"`;
  return v;
}

export function csvHeader(): string {
  return `${CSV_COLUMNS.join(",")}\r\n`;
}

export function csvRow(r: ReceiptView): string {
  const cells: (string | null)[] = [
    r.blockTime,
    r.receiptAddress,
    r.signature,
    r.agentWallet,
    r.agentLabel,
    r.resource,
    r.resourceId,
    r.recipient,
    r.mint,
    r.displayAmount,
    r.amount,
    r.nonce,
    r.slot,
    r.network,
    r.status,
  ];
  return `${cells.map(csvCell).join(",")}\r\n`;
}
