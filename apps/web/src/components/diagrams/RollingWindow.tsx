"use client";

import styles from "./RollingWindow.module.css";
import { useStepLoop } from "./useStepLoop";

const BUCKETS = 97;
const CAP = 5;
const NEXT_CALL = 0.5;
/** Long enough that the total in the window rises through the cap and falls back. */
const PERIOD = 194;

/** Example spend per 15 minute bucket. Fixed numbers, so the server and browser draw the same bars. */
const spend = Array.from({ length: PERIOD }, (_, i) => {
  const wave = 0.042 + 0.03 * Math.sin((2 * Math.PI * i) / PERIOD);
  const texture = 0.016 * Math.sin(i * 0.9) + 0.012 * Math.sin(i * 2.3);
  return Math.max(0.004, wave + texture);
});
const tallest = Math.max(...spend);

/** The start of the window where the total sits just under the point of refusal. */
const START = 40;

function bucketAt(offset: number, i: number): number {
  return spend[(offset + i) % PERIOD] ?? 0;
}

/**
 * The daily cap as the program counts it. 97 buckets of 15 minutes, with the oldest leaving the
 * window as a new one opens, so the next payment is measured against the real rolling total.
 */
export function RollingWindow() {
  const { ref, frame } = useStepLoop<HTMLElement>(PERIOD, 480, 0);
  const offset = START + frame;

  let total = 0;
  for (let i = 0; i < BUCKETS; i++) total += bucketAt(offset, i);
  const passes = total + NEXT_CALL <= CAP;
  const fill = Math.min(total / CAP, 1);
  const pending = Math.min(NEXT_CALL / CAP, 1 - fill);

  return (
    <figure
      ref={ref}
      className={styles.figure}
      aria-label="A bar chart of spending in 97 buckets of 15 minutes. As time passes the oldest bucket leaves the window. Below it a meter compares the total in the window plus the next payment with the daily cap, and shows whether that payment passes or is refused."
    >
      <div className={styles.head}>
        <span>Spend per bucket</span>
        <code>97 × 15 min</code>
      </div>

      <div className={styles.chart} aria-hidden="true">
        {Array.from({ length: BUCKETS }, (_, i) => {
          const value = bucketAt(offset, i);
          const edge = i === 0 ? styles.leaving : i === BUCKETS - 1 ? styles.now : "";
          return (
            <span
              // biome-ignore lint/suspicious/noArrayIndexKey: each bar is a fixed slot in the window
              key={i}
              className={`${styles.bar} ${edge}`}
              style={{ height: `${((value / tallest) * 100).toFixed(2)}%` }}
            />
          );
        })}
      </div>
      <div className={styles.axis} aria-hidden="true">
        <span>leaves the window next</span>
        <span>now</span>
      </div>

      <div className={styles.meter} aria-hidden="true">
        <span className={styles.spent} style={{ width: `${(fill * 100).toFixed(2)}%` }} />
        <span
          className={`${styles.pending} ${passes ? "" : styles.pendingFail}`}
          style={{ left: `${(fill * 100).toFixed(2)}%`, width: `${(pending * 100).toFixed(2)}%` }}
        />
      </div>
      <dl className={styles.facts}>
        <div>
          <dt>In the window</dt>
          <dd>{total.toFixed(3)}</dd>
        </div>
        <div>
          <dt>Next call</dt>
          <dd>{NEXT_CALL.toFixed(3)}</dd>
        </div>
        <div>
          <dt>Daily cap</dt>
          <dd>{CAP.toFixed(3)}</dd>
        </div>
      </dl>
      <p className={`${styles.verdict} ${passes ? styles.pass : styles.fail}`}>
        {passes ? (
          "Passes. It fits under the cap."
        ) : (
          <>
            Refused on chain with <code>DailyCapExceeded</code>
          </>
        )}
      </p>
    </figure>
  );
}
