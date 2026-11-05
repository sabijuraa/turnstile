import type { Metadata } from "next";
import { CoinsScene, CornerShapes } from "@/components/art/scenes";
import { ButtonLink } from "@/components/Button";
import { ArtCard, CardGrid, ClosingBand } from "@/components/Feature";
import { Icon, type IconName } from "@/components/Icon";
import { PageIntro } from "@/components/PageIntro";
import { Reveal } from "@/components/Reveal";
import { Section } from "@/components/Section";
import { Faq } from "./Faq";
import { PriceCard } from "./PriceCard";
import styles from "./pricing.module.css";

export const metadata: Metadata = {
  title: "Pricing",
  description: "The simple model Turnstile would use. Nothing is charged today.",
};

function Tile({ icon }: { icon: IconName }) {
  return (
    <span className={styles.tile}>
      <Icon name={icon} size={22} />
    </span>
  );
}

export default function PricingPage() {
  return (
    <>
      <PageIntro eyebrow="Pricing" title="A small fee on what settles." art={<CoinsScene />}>
        Nothing is charged today. This is a portfolio build, and the numbers are illustrative.
      </PageIntro>

      <Section id="model" flush>
        <Reveal>
          <PriceCard />
        </Reveal>
        <div className={styles.tiles}>
          <CardGrid>
            <ArtCard art={<Tile icon="pulse" />} title="Network fees included">
              The facilitator pays them.
            </ArtCard>
            <ArtCard art={<Tile icon="shield" />} title="Nothing on a refusal">
              No funds move, so no fee.
            </ArtCard>
            <ArtCard art={<Tile icon="coins" />} title="No seats or minimums">
              Only what settles counts.
            </ArtCard>
          </CardGrid>
        </div>
      </Section>

      <Section id="faq" eyebrow="Questions" title="Quick answers." tone="surface" flush>
        <Reveal>
          <Faq />
        </Reveal>
      </Section>

      <ClosingBand title="See it work before you think about price." art={<CornerShapes />}>
        <ButtonLink href="/demo" icon="arrowRight">
          Open the live demo
        </ButtonLink>
        <ButtonLink href="/docs" variant="secondary">
          Read the docs
        </ButtonLink>
      </ClosingBand>
    </>
  );
}
