import { GateScene } from "@/components/art/scenes";
import { ButtonLink } from "@/components/Button";
import { Icon, type IconName } from "@/components/Icon";
import styles from "./home.module.css";

const facts: readonly { icon: IconName; text: string }[] = [
  { icon: "pulse", text: "Settles with the request" },
  { icon: "shield", text: "Limits held on chain" },
  { icon: "receipt", text: "A receipt for every call" },
];

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
            Your agent pays per call in a stablecoin on Solana, and never past the limits you set.
          </p>
          <div className={styles.heroActions}>
            <ButtonLink href="/console" icon="arrowRight">
              Open console
            </ButtonLink>
            <ButtonLink href="/demo" variant="secondary">
              See it live
            </ButtonLink>
          </div>
          <ul className={styles.heroFacts}>
            {facts.map((fact) => (
              <li key={fact.text}>
                <Icon name={fact.icon} size={18} />
                {fact.text}
              </li>
            ))}
          </ul>
        </div>
        <div className={styles.heroArt}>
          <GateScene />
        </div>
      </div>
    </section>
  );
}
