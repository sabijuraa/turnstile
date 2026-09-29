"use client";

import { useId } from "react";
import type { Range } from "@/lib/console/types";
import styles from "./console.module.css";

const ranges: { value: Range; label: string; long: string }[] = [
  { value: "24h", label: "24h", long: "Last 24 hours" },
  { value: "7d", label: "7d", long: "Last 7 days" },
  { value: "30d", label: "30d", long: "Last 30 days" },
];

export function rangeLong(range: Range): string {
  return ranges.find((r) => r.value === range)?.long ?? range;
}

/** Native radios styled as a segmented control, so arrow keys work as in any radio group. */
export function RangeSwitch({ value, onChange }: { value: Range; onChange: (r: Range) => void }) {
  const name = useId();
  return (
    <fieldset className={styles.segmented}>
      <legend className="visually-hidden">Time range</legend>
      {ranges.map((r) => (
        <label key={r.value} className={styles.segment} title={r.long}>
          <input
            type="radio"
            name={name}
            value={r.value}
            checked={value === r.value}
            onChange={() => onChange(r.value)}
            className={styles.segmentInput}
          />
          <span aria-hidden="true">{r.label}</span>
          <span className="visually-hidden">{r.long}</span>
        </label>
      ))}
    </fieldset>
  );
}
