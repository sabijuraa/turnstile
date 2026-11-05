import { ButtonLink } from "@/components/Button";
import { SettlementSequence } from "@/components/diagrams/SettlementSequence";
import styles from "./home.module.css";

export function Hero() {
  return (
    <section className={styles.hero} aria-labelledby="hero-title">
      <div className={styles.heroInner}>
        <div className={styles.heroCopy}>
          <p className={`label ${styles.eyebrow}`}>Pay-per-request payments for AI agents</p>
          <h1 id="hero-title" className={styles.heroTitle}>
            Let software pay for itself.
          </h1>
          <p className={styles.heroLead}>
            Every API call carries its own stablecoin payment on Solana, inside limits the chain
            enforces.
          </p>
          <div className={styles.heroActions}>
            <ButtonLink href="/console" icon="arrowRight">
              Open console
            </ButtonLink>
            <ButtonLink href="/demo" variant="secondary">
              See it live
            </ButtonLink>
          </div>
        </div>
        <SettlementSequence />
      </div>
    </section>
  );
}
