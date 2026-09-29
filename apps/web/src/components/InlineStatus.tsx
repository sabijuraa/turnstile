import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import styles from "./InlineStatus.module.css";

export type InlineTone = "positive" | "critical" | "caution" | "info" | "pending";

const icons: Record<InlineTone, IconName> = {
  positive: "check",
  critical: "alert",
  caution: "gauge",
  info: "info",
  pending: "clock",
};

export interface InlineStatusProps {
  tone: InlineTone;
  /** The outcome in a few words, for example "Policy saved". */
  title: string;
  /** What happened and, for failures, what to do next. */
  children?: ReactNode;
  /** Optional action, for example a retry button. */
  action?: ReactNode;
}

/** A status message that sits in the flow next to the thing it describes. */
export function InlineStatus({ tone, title, children, action }: InlineStatusProps) {
  return (
    <div
      className={`${styles.status} ${styles[tone]}`}
      role={tone === "critical" ? "alert" : "status"}
    >
      <Icon name={icons[tone]} size={18} className={styles.icon} />
      <div className={styles.body}>
        <p className={styles.title}>{title}</p>
        {children ? <div className={styles.text}>{children}</div> : null}
      </div>
      {action ? <div className={styles.action}>{action}</div> : null}
    </div>
  );
}
