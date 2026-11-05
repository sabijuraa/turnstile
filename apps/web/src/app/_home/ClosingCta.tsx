import { ButtonLink } from "@/components/Button";
import styles from "./home.module.css";

export function ClosingCta() {
  return (
    <section className={styles.closing} aria-labelledby="closing-title">
      <div className={styles.closingInner}>
        <h2 id="closing-title" className={styles.closingTitle}>
          Watch a real agent pay a real API.
        </h2>
        <div className={styles.closingActions}>
          <ButtonLink href="/demo" icon="arrowRight">
            Run the live demo
          </ButtonLink>
          <ButtonLink href="/console" variant="secondary">
            Open console
          </ButtonLink>
        </div>
      </div>
    </section>
  );
}
