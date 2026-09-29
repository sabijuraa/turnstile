import type { Metadata } from "next";
import { ButtonLink } from "@/components/Button";
import { Icon, type IconName } from "@/components/Icon";
import { PageIntro } from "@/components/PageIntro";
import { Section } from "@/components/Section";
import styles from "./solutions.module.css";
import { type UseCase, UseCaseCard } from "./UseCaseCard";

export const metadata: Metadata = {
  title: "What you can build",
  description:
    "Where per-call payment fits. Metered APIs, paid data feeds, agent to agent services and pay-per-use compute, with what each takes to build.",
};

const fits: readonly { icon: IconName; title: string; body: string }[] = [
  {
    icon: "agent",
    title: "Software is the buyer",
    body: "An agent cannot fill in a checkout. It can sign a payment in the same request.",
  },
  {
    icon: "endpoint",
    title: "One request carries the value",
    body: "A lookup, an answer or a finished job. Not a seat and not a month.",
  },
  {
    icon: "coins",
    title: "The amount is small",
    body: "A fraction of a cent is too small for a card. It settles cleanly in a stablecoin.",
  },
];

const useCases: readonly UseCase[] = [
  {
    id: "metered-api",
    icon: "endpoint",
    name: "Metered API",
    title: "Charge for each call to your API.",
    body: "Put a price on a route and every call pays its way. An agent that has never met your service can pay and get the answer in one round trip. There is no signup to run and no invoice to chase.",
    steps: [
      "Choose the routes to charge and a price per call.",
      "Name the wallet that gets paid.",
      "Keep serving the response exactly as you do today.",
    ],
    build: "Wrap the route with the resource SDK middleware for Express or Hono.",
    links: [{ href: "/docs/quickstart", label: "Charge for a route" }],
  },
  {
    id: "data-feed",
    icon: "pulse",
    name: "Paid data feed",
    title: "Sell data one pull at a time.",
    body: "Quotes, lookups and fresh records sold per request. A buyer pays for the rows it actually pulls, not for a plan it barely uses.",
    steps: [
      "Price each lookup or snapshot route.",
      "Size each response so the price fits what it returns.",
      "Treat every pull as its own payment. There is no subscription to manage.",
    ],
    build: "Put the resource SDK in front of each lookup route with one price per route.",
    links: [{ href: "/docs/quickstart", label: "Charge for a route" }],
  },
  {
    id: "agent-to-agent",
    icon: "agent",
    name: "Agent to agent services",
    title: "Let one agent hire another.",
    body: "A research agent pays a translation agent per job, inside limits its owner set. Neither side needs an account with the other. The seller gets paid and the buyer cannot overspend.",
    steps: [
      "Run the selling agent behind a paid route.",
      "Give the buying agent a wallet, a session key and a policy.",
      "Add the seller's route and wallet to the buyer's allow-list.",
    ],
    build: "Charge with the resource SDK on one side. Pay with the agent SDK on the other.",
    links: [
      { href: "/docs/agent-quickstart", label: "Let an agent pay" },
      { href: "/docs/quickstart", label: "Charge for a route" },
    ],
  },
  {
    id: "compute",
    icon: "gauge",
    name: "Pay-per-use compute",
    title: "Rent out work by the job.",
    body: "Inference, rendering or a batch job priced per call. The agent pays for the work it asks for and nothing while it sits idle.",
    steps: [
      "Set a fixed price per route. The price is known before the job starts.",
      "Offer one route per job size when the work varies.",
      "Run the job and return the result in the response.",
    ],
    build:
      "Wrap each job route with the resource SDK and read how a price is set before any work runs.",
    links: [
      { href: "/docs/quickstart", label: "Charge for a route" },
      { href: "/docs/concepts", label: "Read the concepts" },
    ],
  },
];

const handled: readonly { icon: IconName; title: string; body: string }[] = [
  {
    icon: "gate",
    title: "The price and the 402",
    body: "An unpaid call gets the price back in the standard x402 format. A paid call gets the response.",
  },
  {
    icon: "shield",
    title: "Limits on chain",
    body: "The buyer's per-call cap, daily cap and allow-list are checked before a single token moves.",
  },
  {
    icon: "receipt",
    title: "A receipt for every call",
    body: "Both sides can see what was paid, to whom and for which route. The record lives on Solana.",
  },
  {
    icon: "check",
    title: "Retries that charge once",
    body: "Each payment carries a nonce. A retried payment settles once and never twice.",
  },
];

export default function SolutionsPage() {
  return (
    <>
      <PageIntro
        eyebrow="Solutions"
        title="Charge for anything an agent can call."
        actions={
          <>
            <ButtonLink href="/docs/quickstart" icon="arrowRight">
              Read the quickstart
            </ButtonLink>
            <ButtonLink href="/demo" variant="secondary">
              See it live
            </ButtonLink>
          </>
        }
      >
        Per-call payment fits wherever software does the buying and a single request carries the
        value. Here are four places it fits well and what each one takes to build.
      </PageIntro>

      <Section
        id="fit"
        tone="surface"
        eyebrow="Where it fits"
        title="Three signs a route should be paid."
      >
        <ul className={styles.fits}>
          {fits.map((fit) => (
            <li key={fit.title} className={styles.fit}>
              <span className={styles.fitIcon}>
                <Icon name={fit.icon} size={20} />
              </span>
              <h3 className={styles.fitTitle}>{fit.title}</h3>
              <p className={styles.fitBody}>{fit.body}</p>
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="use-cases"
        eyebrow="Use cases"
        title="Four ways to put it to work."
        lead="Turnstile moves the money and keeps the record. You build the service and set the price."
      >
        <ul className={styles.cases}>
          {useCases.map((useCase) => (
            <li key={useCase.id} className={styles.caseItem}>
              <UseCaseCard useCase={useCase} />
            </li>
          ))}
        </ul>
      </Section>

      <Section
        id="handled"
        tone="surface"
        eyebrow="In every case"
        title="What Turnstile takes care of."
      >
        <ul className={styles.handled}>
          {handled.map((item) => (
            <li key={item.title} className={styles.handledItem}>
              <span className={styles.handledIcon}>
                <Icon name={item.icon} size={18} />
              </span>
              <span>
                <strong className={styles.handledTitle}>{item.title}</strong>
                <span className={styles.handledBody}>{item.body}</span>
              </span>
            </li>
          ))}
        </ul>
      </Section>

      <section className={styles.closing} aria-labelledby="solutions-closing-title">
        <div className={styles.closingInner}>
          <h2 id="solutions-closing-title" className={styles.closingTitle}>
            Start with one route.
          </h2>
          <p className={styles.closingLead}>
            Wrap a single endpoint, point an agent at it and watch the first receipt land. You can
            add the rest once it feels right.
          </p>
          <div className={styles.closingActions}>
            <ButtonLink href="/docs/quickstart" icon="arrowRight">
              Charge for a route
            </ButtonLink>
            <ButtonLink href="/docs/agent-quickstart" variant="secondary">
              Let an agent pay
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
