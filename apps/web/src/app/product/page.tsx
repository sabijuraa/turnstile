import type { Metadata } from "next";
import { CornerShapes, KeyScene, ReceiptScene, VaultScene } from "@/components/art/scenes";
import { ButtonLink } from "@/components/Button";
import { ClosingBand, Feature } from "@/components/Feature";
import { PageIntro } from "@/components/PageIntro";
import { Section } from "@/components/Section";

export const metadata: Metadata = {
  title: "How Turnstile works",
  description: "A wallet you own, a key your agent uses and a receipt for every call.",
  alternates: { canonical: "/product" },
};

export default function ProductPage() {
  return (
    <>
      <PageIntro eyebrow="Product" title="Every request carries its own payment.">
        Three pieces do the work. A vault, a key and a receipt.
      </PageIntro>
      <Section id="vault" flush>
        <Feature eyebrow="The vault" title="You hold the money." art={<VaultScene />}>
          Funds sit in a wallet only you can withdraw from, and your limits live beside them.
        </Feature>
      </Section>
      <Section id="key" tone="surface" flush>
        <Feature eyebrow="The key" title="Your agent holds a key." art={<KeyScene />} flip>
          It signs one exact payment at a time. Revoke it with one signature if it ever leaks.
        </Feature>
      </Section>
      <Section id="receipt" flush>
        <Feature eyebrow="The receipt" title="Anyone can check it." art={<ReceiptScene />}>
          Every settled call writes a record on chain, ready to export for your books.
        </Feature>
      </Section>
      <ClosingBand title="Start with one agent and one limit." art={<CornerShapes />}>
        <ButtonLink href="/console" icon="arrowRight">
          Open console
        </ButtonLink>
        <ButtonLink href="/docs" variant="secondary">
          Read the docs
        </ButtonLink>
      </ClosingBand>
    </>
  );
}
