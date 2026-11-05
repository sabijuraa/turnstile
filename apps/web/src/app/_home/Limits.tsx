import { RollingWindow } from "@/components/diagrams/RollingWindow";
import { Section } from "@/components/Section";
import styles from "./home.module.css";

export function Limits() {
  return (
    <Section id="limits" labelledBy="limits-title" tone="surface">
      <div className={styles.split}>
        <div className={styles.splitCopy}>
          <p className={`label ${styles.eyebrow}`}>Limits</p>
          <h2 id="limits-title" className={styles.splitTitle}>
            Set the limits once. The chain keeps them.
          </h2>
          <p className={styles.splitLead}>
            A runaway agent or a compromised server still cannot spend past your cap. The daily
            limit rolls with the clock, so there is no midnight reset to exploit.
          </p>
        </div>
        <RollingWindow />
      </div>
    </Section>
  );
}
