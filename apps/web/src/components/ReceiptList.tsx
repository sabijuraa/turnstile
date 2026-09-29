import type { ReactNode } from "react";
import { ReceiptRow, type ReceiptView } from "./Receipt";
import styles from "./Receipt.module.css";

export interface ReceiptListProps {
  receipts: readonly ReceiptView[];
  /** Accessible name for the list, for example "Recent receipts". */
  label: string;
  /** Shown when there are no receipts. Name what will appear and how to get there. */
  empty?: ReactNode;
  /** Ids of receipts that just arrived. Only these play the landing motion. */
  landingIds?: readonly string[];
  /** Announce new receipts to screen readers as they arrive. */
  live?: boolean;
  timeZone?: string;
}

export function ReceiptList({
  receipts,
  label,
  empty,
  landingIds = [],
  live = false,
  timeZone = "UTC",
}: ReceiptListProps) {
  if (receipts.length === 0) {
    return (
      <div className={styles.empty} aria-live={live ? "polite" : undefined}>
        {empty ?? <p>No receipts yet. Paid requests appear here as they settle.</p>}
      </div>
    );
  }
  const landing = new Set(landingIds);
  return (
    <ol
      aria-label={label}
      aria-live={live ? "polite" : undefined}
      aria-relevant={live ? "additions" : undefined}
      className={styles.list}
    >
      {receipts.map((receipt) => (
        <ReceiptRow
          key={receipt.id}
          receipt={receipt}
          timeZone={timeZone}
          landing={landing.has(receipt.id)}
        />
      ))}
    </ol>
  );
}
