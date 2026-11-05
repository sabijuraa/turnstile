import { PermissionMatrix } from "@/components/diagrams/PermissionMatrix";
import { Section } from "@/components/Section";
import styles from "./security.module.css";

export function Boundaries() {
  return (
    <Section
      id="boundaries"
      eyebrow="Trust boundaries"
      title="Each key can do one kind of thing."
      lead="The programs hold the funds and enforce this table, whoever is asking."
    >
      <PermissionMatrix />
      <p className={styles.matrixNote}>
        Anyone may submit a signed payment, which is why the signature itself names the amount and
        the recipient.
      </p>
    </Section>
  );
}
