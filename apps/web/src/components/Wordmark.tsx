import styles from "./Wordmark.module.css";

/** The Turnstile mark. The three arm rotor of a turnstile seen from above. */
export function Mark({ size = 24 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      aria-hidden="true"
      focusable="false"
      className={styles.mark}
    >
      <rect width="24" height="24" rx="6" fill="var(--color-accent)" />
      <g
        stroke="var(--color-on-accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        fill="none"
      >
        <path d="M12 12V5.75" />
        <path d="m12 12-5.4 3.1" />
        <path d="m12 12 5.4 3.1" />
      </g>
      <circle cx="12" cy="12" r="2.1" fill="var(--color-on-accent)" />
    </svg>
  );
}

export function Wordmark() {
  return (
    <span className={styles.wordmark}>
      <Mark />
      <span className={styles.name}>Turnstile</span>
    </span>
  );
}
