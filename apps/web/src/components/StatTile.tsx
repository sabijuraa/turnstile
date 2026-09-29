import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import styles from "./StatTile.module.css";

export interface StatTileProps {
  /** What the number measures, for example "Spend in the last 24 hours". */
  label: string;
  /** The formatted figure, for example "12.4051". Rendered with tabular numerals. */
  value: string;
  /** Unit after the value, for example "USDC" or "receipts". */
  unit?: string;
  /** One quiet line of context under the figure. */
  detail?: ReactNode;
  icon?: IconName;
  /** Colors the detail line. Use `critical` when the figure needs action. */
  tone?: "neutral" | "positive" | "caution" | "critical";
  /** Shows a quiet loading shimmer instead of the value while data is on its way. */
  loading?: boolean;
}

export function StatTile({
  label,
  value,
  unit,
  detail,
  icon,
  tone = "neutral",
  loading = false,
}: StatTileProps) {
  return (
    <div className={styles.tile} aria-busy={loading || undefined}>
      <dt className={styles.label}>
        {icon ? <Icon name={icon} size={16} /> : null}
        {label}
      </dt>
      <dd className={styles.body}>
        {loading ? (
          <span className={styles.skeleton}>
            <span className="visually-hidden">Loading</span>
          </span>
        ) : (
          <span className={styles.value}>
            <span className={styles.figure}>{value}</span>
            {unit ? <span className={styles.unit}>{unit}</span> : null}
          </span>
        )}
        {detail ? <span className={`${styles.detail} ${styles[tone]}`}>{detail}</span> : null}
      </dd>
    </div>
  );
}

/** Wraps StatTiles in a description list so label and value stay paired for assistive tech. */
export function StatGrid({ children, label }: { children: ReactNode; label?: string }) {
  return (
    <dl className={styles.grid} aria-label={label}>
      {children}
    </dl>
  );
}
