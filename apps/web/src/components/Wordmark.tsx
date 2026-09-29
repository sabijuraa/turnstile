import styles from "./Wordmark.module.css";

/** The Turnstile mark. Two posts and an arm that has just swung open. */
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
        <path d="M7.5 6.5v11" />
        <path d="M16.5 6.5v11" />
        <path d="M7.5 11h5.5" />
      </g>
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
