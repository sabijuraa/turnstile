import { CapScene } from "@/components/art/scenes";
import { Reveal } from "@/components/Reveal";
import styles from "./home.module.css";

export function Limits() {
  return (
    <section className={styles.band} aria-labelledby="limits-title">
      <Reveal className={styles.bandInner}>
        <div className={styles.bandCopy}>
          <p className={`label ${styles.eyebrow}`}>Limits</p>
          <h2 id="limits-title" className={styles.bandTitle}>
            Set the ceiling once.
          </h2>
          <p className={styles.bandLead}>
            A runaway agent or a hacked server still cannot spend past your cap.
          </p>
        </div>
        <CapScene />
      </Reveal>
    </section>
  );
}
