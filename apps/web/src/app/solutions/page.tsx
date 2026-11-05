import type { Metadata } from "next";
import Link from "next/link";
import { AgentsArt, ApiArt, ComputeArt, CornerShapes, DataArt } from "@/components/art/scenes";
import { ButtonLink } from "@/components/Button";
import { ArtCard, CardGrid, ClosingBand } from "@/components/Feature";
import { Icon } from "@/components/Icon";
import { PageIntro } from "@/components/PageIntro";
import { Section } from "@/components/Section";

import styles from "./solutions.module.css";

export const metadata: Metadata = {
  title: "What you can build",
  description: "Metered APIs, paid data feeds, agent to agent services and pay-per-use compute.",
};

const useCases = [
  {
    art: <ApiArt />,
    title: "Metered API",
    body: "Charge for each call, with no signup or invoice.",
    href: "/docs/quickstart",
    link: "Charge for a route",
  },
  {
    art: <DataArt />,
    title: "Paid data feed",
    body: "Sell data one pull at a time, not by the plan.",
    href: "/docs/quickstart",
    link: "Charge for a route",
  },
  {
    art: <AgentsArt />,
    title: "Agent to agent",
    body: "One agent hires another, inside its owner's limits.",
    href: "/docs/agent-quickstart",
    link: "Let an agent pay",
  },
  {
    art: <ComputeArt />,
    title: "Pay-per-use compute",
    body: "Rent out work by the job, and nothing while idle.",
    href: "/docs/concepts",
    link: "Read the concepts",
  },
] as const;

export default function SolutionsPage() {
  return (
    <>
      <PageIntro eyebrow="Solutions" title="Charge for anything an agent can call.">
        You build the service and set the price. Turnstile moves the money.
      </PageIntro>

      <Section id="use-cases" flush>
        <CardGrid columns={2}>
          {useCases.map((useCase) => (
            <ArtCard
              key={useCase.title}
              art={useCase.art}
              title={useCase.title}
              footer={
                <Link href={useCase.href} className={styles.textLink}>
                  {useCase.link}
                  <Icon name="arrowRight" size={16} />
                </Link>
              }
            >
              {useCase.body}
            </ArtCard>
          ))}
        </CardGrid>
      </Section>

      <ClosingBand title="Start with one route." art={<CornerShapes />}>
        <ButtonLink href="/docs/quickstart" icon="arrowRight">
          Charge for a route
        </ButtonLink>
        <ButtonLink href="/docs/agent-quickstart" variant="secondary">
          Let an agent pay
        </ButtonLink>
      </ClosingBand>
    </>
  );
}
