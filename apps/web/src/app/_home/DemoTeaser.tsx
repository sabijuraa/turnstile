import { ButtonLink } from "@/components/Button";
import { Gate } from "@/components/Gate";
import { Illustration } from "@/components/Illustration";
import styles from "./home.module.css";
import { sampleChecks, sampleOutcome, sampleRequest } from "./illustration";

export function DemoTeaser() {
  return (
    <section className={styles.demo} aria-labelledby="demo-title">
      <div className={styles.demoInner}>
        <div className={styles.demoCopy}>
          <p className={`label ${styles.eyebrow}`}>Live demo</p>
          <h2 id="demo-title" className={styles.demoTitle}>
            Watch a real agent pay a real API.
          </h2>
          <p className={styles.demoLead}>
            Press run and an agent calls a metered API on Solana. Each call settles on its own until
            the daily cap stops the next one.
          </p>
          <ButtonLink href="/demo" icon="arrowRight">
            Open the live demo
          </ButtonLink>
        </div>
        <Illustration
          className={styles.demoGate}
          note="Illustration. The live demo shows real payments."
        >
          <Gate
            variant="compact"
            request={sampleRequest}
            checks={sampleChecks}
            outcome={sampleOutcome}
          />
        </Illustration>
      </div>
    </section>
  );
}
