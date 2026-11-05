import type { ReactNode } from "react";
import styles from "./Feature.module.css";
import { Reveal } from "./Reveal";

/** One idea beside one picture. A short heading, one or two lines, and nothing else. */
export function Feature({
  eyebrow,
  title,
  children,
  art,
  flip = false,
  actions,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
  art: ReactNode;
  flip?: boolean;
  actions?: ReactNode;
}) {
  return (
    <Reveal className={[styles.feature, flip ? styles.flip : ""].join(" ")}>
      <div className={styles.copy}>
        <p className={`label ${styles.eyebrow}`}>{eyebrow}</p>
        <h2 className={styles.title}>{title}</h2>
        <p className={styles.lead}>{children}</p>
        {actions ? <div className={styles.actions}>{actions}</div> : null}
      </div>
      <div className={styles.art}>{art}</div>
    </Reveal>
  );
}

/** A soft card with a picture on top and a line of text. Lifts on hover. */
export function ArtCard({
  art,
  title,
  children,
  footer,
}: {
  art?: ReactNode;
  title: string;
  children?: ReactNode;
  footer?: ReactNode;
}) {
  return (
    <article className={styles.card}>
      {art ? <div className={styles.cardArt}>{art}</div> : null}
      <h3 className={styles.cardTitle}>{title}</h3>
      {children ? <p className={styles.cardBody}>{children}</p> : null}
      {footer ? <div className={styles.cardFooter}>{footer}</div> : null}
    </article>
  );
}

/** Evenly spaced cards that arrive one after another. */
export function CardGrid({ children, columns = 3 }: { children: ReactNode; columns?: 2 | 3 | 4 }) {
  return (
    <Reveal stagger className={[styles.grid, styles[`cols${columns}`]].join(" ")}>
      {children}
    </Reveal>
  );
}

/** The closing band on every marketing page. */
export function ClosingBand({
  title,
  art,
  children,
}: {
  title: string;
  art?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className={styles.closingWrap} aria-label={title}>
      <Reveal className={styles.closing}>
        <div className={styles.closingCopy}>
          <h2 className={styles.closingTitle}>{title}</h2>
          <div className={styles.actions}>{children}</div>
        </div>
        {art ? <div className={styles.closingArt}>{art}</div> : null}
      </Reveal>
    </section>
  );
}
