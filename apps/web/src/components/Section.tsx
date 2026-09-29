import type { ReactNode } from "react";
import styles from "./Section.module.css";

export interface SectionProps {
  id?: string;
  /** Short uppercase label above the title. */
  eyebrow?: string;
  title?: ReactNode;
  lead?: ReactNode;
  /** Visual ground. `paper` is default. `surface` lifts a band. `ink` is reserved for one closing band. */
  tone?: "paper" | "surface" | "ink";
  /** Id of a heading inside children that names the section, when no `title` is passed. */
  labelledBy?: string;
  /** Removes the top hairline that separates stacked sections. */
  flush?: boolean;
  /** Centers the header block. */
  centered?: boolean;
  className?: string;
  children?: ReactNode;
}

/** Page section with the standard container, vertical rhythm and an optional header block. */
export function Section({
  id,
  eyebrow,
  title,
  lead,
  tone = "paper",
  labelledBy,
  flush = false,
  centered = false,
  className,
  children,
}: SectionProps) {
  const headingId = id ? `${id}-title` : undefined;
  return (
    <section
      id={id}
      aria-labelledby={labelledBy ?? (title && headingId ? headingId : undefined)}
      className={[styles.section, styles[tone], flush ? styles.flush : "", className]
        .filter(Boolean)
        .join(" ")}
    >
      <div className={styles.container}>
        {eyebrow || title || lead ? (
          <header className={[styles.head, centered ? styles.centered : ""].join(" ")}>
            {eyebrow ? <p className={`label ${styles.eyebrow}`}>{eyebrow}</p> : null}
            {title ? (
              <h2 id={headingId} className={styles.title}>
                {title}
              </h2>
            ) : null}
            {lead ? <p className={styles.lead}>{lead}</p> : null}
          </header>
        ) : null}
        {children}
      </div>
    </section>
  );
}

/** The standard horizontal container without section spacing. */
export function Container({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={[styles.container, className].filter(Boolean).join(" ")}>{children}</div>;
}
