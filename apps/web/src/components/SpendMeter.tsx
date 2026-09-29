import { formatUnits } from "@turnstile/shared";
import type { ReactNode } from "react";
import { groupDigits, meterRatio, meterTone } from "@/lib/format";
import styles from "./SpendMeter.module.css";

export interface SpendMeterProps {
  /** What is being measured, for example "Daily cap, rolling 24 hours". */
  label: string;
  /** Amount spent in base units. */
  spent: bigint;
  /** Cap in base units. */
  cap: bigint;
  /** Mint decimals. The Turnstile stablecoin uses 6. */
  decimals?: number;
  /** Asset symbol shown after the figures. */
  asset: string;
  /** Share of the cap at which the meter turns to caution. Defaults to 0.8. */
  cautionAt?: number;
  /** One line under the meter, for example when the window resets. */
  detail?: ReactNode;
  size?: "md" | "sm";
}

/** A calm horizontal meter that advances as spend approaches a cap. Width changes ease, never jump. */
export function SpendMeter({
  label,
  spent,
  cap,
  decimals = 6,
  asset,
  cautionAt = 0.8,
  detail,
  size = "md",
}: SpendMeterProps) {
  const ratio = meterRatio(spent, cap);
  const tone = meterTone(spent, cap, cautionAt);
  const spentText = groupDigits(formatUnits(spent, decimals));
  const capText = groupDigits(formatUnits(cap, decimals));
  const percent = Math.round(ratio * 100);
  const valueText = `${spentText} of ${capText} ${asset} used, ${percent} percent`;
  return (
    <div className={`${styles.meter} ${styles[size]}`} data-tone={tone}>
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        <span className={styles.figures}>
          <span className={styles.spent}>{spentText}</span>
          <span className={styles.of}> of </span>
          {capText} {asset}
        </span>
      </div>
      <meter className="visually-hidden" min={0} max={100} value={percent} aria-label={label}>
        {valueText}
      </meter>
      <div className={styles.track} aria-hidden="true">
        <span className={styles.fill} style={{ transform: `scaleX(${ratio})` }} />
      </div>
      {detail || tone !== "normal" ? (
        <p className={styles.detail}>
          {tone === "critical" ? (
            <span className={styles.state}>Cap reached. Further payments are refused.</span>
          ) : tone === "caution" ? (
            <span className={styles.state}>Near the cap.</span>
          ) : null}
          {detail ? <span>{detail}</span> : null}
        </p>
      ) : null}
    </div>
  );
}
