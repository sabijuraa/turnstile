import { SettleAnatomy } from "@/components/diagrams/SettleAnatomy";
import { Section } from "@/components/Section";
import styles from "./security.module.css";

const limits: readonly string[] = [
  "A leaked session key can spend up to your caps, on the pairs you allowed, until you revoke it or it expires.",
  "Anyone with your owner key controls the wallet.",
  "A service can take a fair payment and return a poor answer. The receipt proves you paid, not what you got.",
  "The rules are the program code. Solana Explorer shows who is allowed to upgrade each program.",
];

export function Guarantee() {
  return (
    <>
      <Section
        id="guarantee"
        eyebrow="The on-chain guarantee"
        title="Nothing leaves a vault unless every rule passes."
      >
        <SettleAnatomy />
      </Section>
      <Section id="limits" tone="surface" eyebrow="The limits" title="What it does not cover.">
        <ul className={styles.limitList}>
          {limits.map((limit) => (
            <li key={limit}>{limit}</li>
          ))}
        </ul>
      </Section>
    </>
  );
}
