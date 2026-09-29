import { ButtonLink } from "@/components/Button";
import styles from "./product.module.css";

export function Closing() {
  return (
    <section className={styles.closing} aria-labelledby="closing-title">
      <div className={styles.closingInner}>
        <div className={styles.closingCopy}>
          <h2 id="closing-title" className={styles.closingTitle}>
            Start with one agent and one limit.
          </h2>
          <p className={styles.closingLead}>
            Create an agent wallet in the console, or read the docs and wrap your first route.
          </p>
        </div>
        <div className={styles.closingActions}>
          <ButtonLink href="/console" icon="arrowRight">
            Open console
          </ButtonLink>
          <ButtonLink href="/docs" variant="secondary">
            Read the docs
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
