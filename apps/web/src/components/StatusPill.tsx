import type { ReactNode } from "react";
import { Icon, type IconName } from "./Icon";
import styles from "./StatusPill.module.css";

export type StatusTone = "settled" | "positive" | "caution" | "critical" | "neutral";

const defaultIcons: Record<StatusTone, IconName | null> = {
  settled: "check",
  positive: "check",
  caution: "gauge",
  critical: "alert",
  neutral: null,
};

export interface StatusPillProps {
  tone: StatusTone;
  children: ReactNode;
  /** Overrides the icon that matches the tone. Pass null for text only. */
  icon?: IconName | null;
}

/** A compact state marker. The word always carries the meaning and color only reinforces it. */
export function StatusPill({ tone, children, icon }: StatusPillProps) {
  const shown = icon === undefined ? defaultIcons[tone] : icon;
  return (
    <span className={`${styles.pill} ${styles[tone]}`}>
      {shown ? <Icon name={shown} size={14} /> : null}
      {children}
    </span>
  );
}
