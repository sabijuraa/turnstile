import { ButtonLink } from "@/components/Button";
import styles from "./security.module.css";

export function Closing() {
  return (
    <section className={styles.closing} aria-labelledby="closing-title">
      <div className={styles.closingInner}>
        <div className={styles.closingCopy}>
          <h2 id="closing-title" className={styles.closingTitle}>
            See how the pieces fit together.
          </h2>
          <p className={styles.closingLead}>
            Follow one payment from request to receipt, or read the concepts behind each key.
          </p>
        </div>
        <div className={styles.closingActions}>
          <ButtonLink href="/product" icon="arrowRight">
            See how it works
          </ButtonLink>
          <ButtonLink href="/docs/concepts" variant="secondary">
            Read the concepts
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
