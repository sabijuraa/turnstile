import { AccountMap } from "@/components/diagrams/AccountMap";
import { Section } from "@/components/Section";

export function Model() {
  return (
    <Section
      id="accounts"
      eyebrow="Accounts"
      title="Who holds what."
      lead="Funds and rules live in accounts the programs own. A dashed line is a payment moving through them."
    >
      <AccountMap />
    </Section>
  );
}
