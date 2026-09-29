import type { ReactNode } from "react";
import styles from "./Illustration.module.css";

/**
 * Marks sample content on marketing pages. Anything wrapped here is an example, never customer data,
 * and the caption says so in plain words.
 */
export function Illustration({
  children,
  note = "Illustration. Sample values, not live data.",
  className,
}: {
  children: ReactNode;
  note?: string;
  className?: string;
}) {
  return (
    <figure className={[styles.figure, className].filter(Boolean).join(" ")}>
      {children}
      <figcaption className={styles.caption}>{note}</figcaption>
    </figure>
  );
}
