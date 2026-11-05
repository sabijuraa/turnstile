import type { Metadata } from "next";
import { CornerShapes, ShieldArt } from "@/components/art/scenes";
import { ButtonLink } from "@/components/Button";
import { ArtCard, CardGrid, ClosingBand } from "@/components/Feature";
import { Icon, type IconName } from "@/components/Icon";
import { PageIntro } from "@/components/PageIntro";
import { Section } from "@/components/Section";
import styles from "./security.module.css";

export const metadata: Metadata = {
  title: "Security",
  description: "What protects your money, and where that protection ends.",
  alternates: { canonical: "/security" },
};

const threats: readonly { icon: IconName; title: string; body: string }[] = [
  {
    icon: "gate",
    title: "A hacked facilitator",
    body: "It can stall payments, not change or steal them.",
  },
  {
    icon: "endpoint",
    title: "A swapped address",
    body: "A wallet not on your allow-list is refused.",
  },
  {
    icon: "key",
    title: "A leaked key",
    body: "Your caps still apply. Revoke it with one signature.",
  },
  {
    icon: "clock",
    title: "A replayed payment",
    body: "Each payment settles once. The second try fails.",
  },
];

const limits: readonly string[] = [
  "A leaked key can spend up to your caps until you revoke it.",
  "Whoever holds your owner key controls the wallet.",
  "A receipt proves you paid, not that the answer was good.",
];

export default function SecurityPage() {
  return (
    <>
      <PageIntro
        eyebrow="Security"
        title="Your rules, where no one can change them."
        art={<ShieldArt />}
      >
        Nothing leaves a vault unless every rule on chain passes.
      </PageIntro>

      <Section id="threats" eyebrow="When things go wrong" title="What stops each attack." flush>
        <CardGrid columns={4}>
          {threats.map((threat) => (
            <ArtCard
              key={threat.title}
              art={
                <span className={styles.icon}>
                  <Icon name={threat.icon} size={22} />
                </span>
              }
              title={threat.title}
            >
              {threat.body}
            </ArtCard>
          ))}
        </CardGrid>
      </Section>

      <Section
        id="limits"
        eyebrow="The limits"
        title="What it does not cover."
        tone="surface"
        flush
      >
        <ul className={styles.limits}>
          {limits.map((limit) => (
            <li key={limit}>
              <Icon name="info" size={18} />
              {limit}
            </li>
          ))}
        </ul>
      </Section>

      <ClosingBand title="See how the pieces fit together." art={<CornerShapes />}>
        <ButtonLink href="/product" icon="arrowRight">
          See how it works
        </ButtonLink>
        <ButtonLink href="/docs/concepts" variant="secondary">
          Read the concepts
        </ButtonLink>
      </ClosingBand>
    </>
  );
}
