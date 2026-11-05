import type { ReactNode } from "react";
import styles from "./PageIntro.module.css";

/** The opening block of an inner page. One heading and one short line. */
export function PageIntro({
  eyebrow,
  title,
  children,
  actions,
  art,
}: {
  eyebrow?: string;
  title: string;
  children?: ReactNode;
  /** Buttons under the lead. */
  actions?: ReactNode;
  /** A picture beside the heading. */
  art?: ReactNode;
}) {
  return (
    <div className={styles.band}>
      <div className={[styles.intro, art ? styles.withArt : ""].join(" ")}>
        <div className={styles.copy}>
          {eyebrow ? <p className={`label ${styles.eyebrow}`}>{eyebrow}</p> : null}
          <h1 className={styles.title}>{title}</h1>
          {children ? <p className={styles.lead}>{children}</p> : null}
          {actions ? <div className={styles.actions}>{actions}</div> : null}
        </div>
        {art ? <div className={styles.art}>{art}</div> : null}
      </div>
    </div>
  );
}
