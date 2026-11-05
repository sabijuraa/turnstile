import { SettleAnatomy } from "@/components/diagrams/SettleAnatomy";
import { Section } from "@/components/Section";

export function Settle() {
  return (
    <Section
      id="settle"
      eyebrow="Settlement"
      title="One transaction. It all lands or none of it does."
    >
      <SettleAnatomy />
    </Section>
  );
}
