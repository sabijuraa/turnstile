import { ReceiptScene } from "@/components/art/scenes";
import { ButtonLink } from "@/components/Button";
import { Feature } from "@/components/Feature";
import { Section } from "@/components/Section";

export function Receipts() {
  return (
    <Section id="receipts" flush>
      <Feature
        eyebrow="Receipts"
        title="Every payment leaves proof."
        art={<ReceiptScene />}
        actions={
          <ButtonLink href="/product" variant="secondary" icon="arrowRight">
            See how it works
          </ButtonLink>
        }
      >
        No one can edit it, and one payment can never be charged twice.
      </Feature>
    </Section>
  );
}
