import { ButtonLink } from "@/components/Button";
import { Gate } from "@/components/Gate";
import { Icon, type IconName } from "@/components/Icon";
import { Illustration } from "@/components/Illustration";
import styles from "./home.module.css";
import { sampleChecks, sampleOutcome, sampleRequest } from "./illustration";

const pillars: readonly { icon: IconName; text: string }[] = [
  { icon: "pulse", text: "Settles with the request" },
  { icon: "shield", text: "Limits enforced on chain" },
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
            Turnstile lets every API call your agent makes carry its own payment. It settles in a
            stablecoin on Solana in the same moment, inside limits you set once. Each call leaves a
            receipt you can check.
          </p>
          <div className={styles.heroActions}>
            <ButtonLink href="/console" icon="arrowRight">
              Open console
            </ButtonLink>
            <ButtonLink href="/demo" variant="secondary">
              See it live
            </ButtonLink>
          </div>
          <ul className={styles.pillars}>
            {pillars.map((pillar) => (
              <li key={pillar.text}>
                <Icon name={pillar.icon} size={18} />
                {pillar.text}
              </li>
            ))}
          </ul>
        </div>
        <Illustration
          className={styles.heroGate}
          note="Illustration. A sample request and receipt, not live data."
        >
          <Gate request={sampleRequest} checks={sampleChecks} outcome={sampleOutcome} />
        </Illustration>
      </div>
    </section>
  );
}
