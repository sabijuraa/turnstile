import { AskArt, ShieldArt, SlipArt } from "@/components/art/scenes";
import { ArtCard, CardGrid } from "@/components/Feature";
import { Section } from "@/components/Section";

export function HowItWorks() {
  return (
    <Section id="how" eyebrow="How it works" title="One call. One payment. One receipt." flush>
      <CardGrid>
        <ArtCard art={<AskArt />} title="The agent pays">
          The price comes back with the call, and the agent signs for exactly that.
        </ArtCard>
        <ArtCard art={<ShieldArt />} title="The chain checks">
          Your limits are checked before any money moves.
        </ArtCard>
        <ArtCard art={<SlipArt />} title="A receipt lands">
          The service answers, and the record stays on chain.
        </ArtCard>
      </CardGrid>
    </Section>
  );
}
