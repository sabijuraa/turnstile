import { formatTimestamp, groupDigits } from "@/lib/format";
import { Icon } from "./Icon";
import styles from "./Receipt.module.css";
import { StatusPill } from "./StatusPill";

export type ReceiptStatus = "settled" | "pending" | "failed";

/** One paid request as the UI shows it. Amounts arrive as exact decimal strings. */
export interface ReceiptView {
  /** Receipt account address. Also the stable key. */
  id: string;
  /** Exact decimal amount, for example "0.004". Format base units with formatUnits first. */
  amount: string;
  /** Asset symbol, for example "USDC". */
  asset: string;
  /** What was paid for. The route path or the full resource URL. */
  resource: string;
  /** Who paid. An agent name or a shortened wallet address. */
  payer?: string;
  /** ISO 8601 timestamp of settlement. */
  settledAt: string;
  status: ReceiptStatus;
  /** Link to the settlement transaction on the explorer. */
  explorerUrl?: string;
  /** Short reason shown when status is failed. */
  failureReason?: string;
}

const statusLabel: Record<ReceiptStatus, string> = {
  settled: "Settled",
  pending: "Pending",
  failed: "Failed",
};

const statusTone = { settled: "settled", pending: "neutral", failed: "critical" } as const;

export function ReceiptStatusPill({ status }: { status: ReceiptStatus }) {
  return (
    <StatusPill tone={statusTone[status]} icon={status === "pending" ? "clock" : undefined}>
      {statusLabel[status]}
    </StatusPill>
  );
}

export interface ReceiptCardProps {
  amount: string;
  asset: string;
  status: ReceiptStatus;
  settledAt: string;
  timeZone?: string;
  /** Labelled facts about the receipt, in the order they should read. */
  fields: readonly { label: string; value: string; mono?: boolean }[];
  explorerUrl?: string;
  explorerLabel?: string;
  /** Heading level for the card title, so it nests correctly in the page outline. */
  headingLevel?: 2 | 3 | 4;
}

/** A single receipt shown in full. The amount leads and every field is labelled. */
export function ReceiptCard({
  amount,
  asset,
  status,
  settledAt,
  timeZone = "UTC",
  fields,
  explorerUrl,
  explorerLabel = "View on Solana Explorer",
  headingLevel = 3,
}: ReceiptCardProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <article className={styles.card}>
      <header className={styles.cardHead}>
        <Heading className={styles.cardTitle}>
          <Icon name="receipt" size={18} />
          Receipt
        </Heading>
        <ReceiptStatusPill status={status} />
      </header>
      <p className={styles.cardAmount}>
        <span className={styles.cardFigure}>{groupDigits(amount)}</span>
        <span className={styles.cardAsset}>{asset}</span>
      </p>
      <p className={styles.cardTime}>
        <time dateTime={settledAt}>
          {formatTimestamp(settledAt, timeZone)} {timeZone === "UTC" ? "UTC" : ""}
        </time>
      </p>
      <dl className={styles.fields}>
        {fields.map((field) => (
          <div key={field.label} className={styles.field}>
            <dt>{field.label}</dt>
            <dd className={field.mono ? styles.mono : undefined}>{field.value}</dd>
          </div>
        ))}
      </dl>
      {explorerUrl ? (
        <a className={styles.explorer} href={explorerUrl} target="_blank" rel="noreferrer">
          {explorerLabel}
          <Icon name="arrowUpRight" size={16} />
          <span className="visually-hidden">(opens in a new tab)</span>
        </a>
      ) : null}
    </article>
  );
}

export interface ReceiptRowProps {
  receipt: ReceiptView;
  timeZone?: string;
  /** Plays the landing motion once when the row first mounts. */
  landing?: boolean;
}

/** One receipt in a list. The amount is monospace and right aligned so columns of figures line up. */
export function ReceiptRow({ receipt, timeZone = "UTC", landing = false }: ReceiptRowProps) {
  return (
    <li className={styles.row} data-status={receipt.status} data-landing={landing || undefined}>
      <span className={styles.rowIcon} aria-hidden="true">
        <Icon
          name={
            receipt.status === "failed" ? "alert" : receipt.status === "pending" ? "clock" : "check"
          }
          size={16}
        />
      </span>
      <span className={styles.rowMain}>
        <span className={styles.rowResource}>{receipt.resource}</span>
        <span className={styles.rowMeta}>
          {receipt.payer ? <span>{receipt.payer}</span> : null}
          <time dateTime={receipt.settledAt}>{formatTimestamp(receipt.settledAt, timeZone)}</time>
          {receipt.status === "failed" && receipt.failureReason ? (
            <span className={styles.rowFailure}>{receipt.failureReason}</span>
          ) : null}
        </span>
      </span>
      <span className={styles.rowAmount}>
        <span className={styles.rowFigure}>{groupDigits(receipt.amount)}</span>{" "}
        <span className={styles.rowAsset}>{receipt.asset}</span>
      </span>
      <span className={styles.rowStatus}>
        <ReceiptStatusPill status={receipt.status} />
      </span>
      {receipt.explorerUrl ? (
        <a
          className={styles.rowLink}
          href={receipt.explorerUrl}
          target="_blank"
          rel="noreferrer"
          aria-label={`View receipt for ${receipt.amount} ${receipt.asset} on Solana Explorer (opens in a new tab)`}
        >
          <Icon name="arrowUpRight" size={16} />
        </a>
      ) : (
        <span className={styles.rowLink} aria-hidden="true" />
      )}
    </li>
  );
}
