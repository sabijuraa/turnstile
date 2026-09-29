import { ButtonLink } from "@/components/Button";
import styles from "./home.module.css";

export function ClosingCta() {
  return (
    <section className={styles.closing} aria-labelledby="closing-title">
      <div className={styles.closingInner}>
        <h2 id="closing-title" className={styles.closingTitle}>
          Give your agents a way to pay.
        </h2>
        <p className={styles.closingLead}>
          Create an agent wallet, set its limits and take your first paid request. You stay in
          control of every cent it can spend.
        </p>
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
