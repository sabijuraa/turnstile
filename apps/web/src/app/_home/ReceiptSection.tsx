import { ByteMap } from "@/components/diagrams/ByteMap";
import { ReceiptTimeline } from "@/components/diagrams/ReceiptTimeline";
import { receiptFields } from "@/components/diagrams/receiptFields";
import { Section } from "@/components/Section";
import styles from "./home.module.css";

export function ReceiptSection() {
  return (
    <Section
      id="receipt"
      eyebrow="Receipts"
      title="Every paid request leaves a record no one can edit."
      lead="The address comes from the wallet and the nonce, so one payment can never get a second receipt."
    >
      <div className={styles.receipt}>
        <ByteMap fields={receiptFields} label="Receipt account" />
        <ReceiptTimeline />
      </div>
    </Section>
  );
}
