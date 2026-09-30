import type { Metadata } from "next";
import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";
import { DocHeader, DocSection, Prose } from "./_components/Doc";
import styles from "./_components/docs.module.css";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "Quickstarts, concepts and reference for taking payments with the resource SDK and paying with the agent SDK.",
};

const starts: readonly { href: string; title: string; icon: IconName; text: string }[] = [
  {
    href: "/docs/quickstart",
    title: "Quickstart",
    icon: "endpoint",
    text: "Put a price on an HTTP route with the resource SDK and take a first payment.",
  },
  {
    href: "/docs/agent-quickstart",
    title: "Agent quickstart",
    icon: "agent",
    text: "Give an agent a wallet, a session key and a policy, then let it pay a 402.",
  },
  {
    href: "/docs/concepts",
    title: "Concepts",
    icon: "shield",
    text: "Agent wallets, session keys, policies, the facilitator, receipts and replay protection.",
  },
  {
    href: "/docs/reference",
    title: "Reference",
    icon: "code",
    text: "Facilitator endpoints, SDK options, console API and every error code.",
  },
];

export default function Page() {
  return (
    <article>
      <DocHeader eyebrow="Docs" title="Turnstile documentation">
        Turnstile lets software pay for an HTTP request with a stablecoin on Solana. The owner sets
        the limits once and the chain checks them on every payment.
      </DocHeader>

      <DocSection id="start" title="Where to start">
        <Prose>
          <p>Pick the side you are building.</p>
          <ul>
            <li>You run an API and want to charge per call. Start with the quickstart.</li>
            <li>You run an agent that needs to pay for calls. Start with the agent quickstart.</li>
          </ul>
        </Prose>
        <ul className={styles.cards}>
          {starts.map((start) => (
            <li key={start.href}>
              <Link href={start.href} className={styles.cardLink}>
                <span className={styles.cardTitle}>
                  {start.title}
                  <Icon name={start.icon} size={20} />
                </span>
                <span className={styles.cardText}>{start.text}</span>
              </Link>
            </li>
          ))}
        </ul>
      </DocSection>

      <DocSection id="flow" title="How a paid request works">
        <Prose>
          <p>Every paid call follows the same six steps.</p>
        </Prose>
        <ol className={styles.steps}>
          <li>The agent calls your route like any other HTTP request.</li>
          <li>
            The resource SDK answers <code>402 Payment Required</code> with the price, the recipient
            and a fresh nonce.
          </li>
          <li>
            The agent SDK checks the price against its policy and signs a payment authorization with
            its session key.
          </li>
          <li>
            The facilitator verifies the signature and submits one settlement transaction. The
            programs check the policy again on chain and move the funds.
          </li>
          <li>The settlement writes a receipt account that anyone can read.</li>
          <li>Your handler runs and the response carries the receipt address.</li>
        </ol>
      </DocSection>

      <DocSection id="packages" title="What you work with">
        <Prose>
          <p>Four pieces, all in the Turnstile repository.</p>
          <ul>
            <li>
              <code>@turnstile/sdk-resource</code> is middleware for Hono, Express and any server
              that speaks WHATWG Request.
            </li>
            <li>
              <code>@turnstile/sdk-agent</code> wraps <code>fetch</code> so an agent pays a 402
              inside its policy. It ships the <code>turnstile-agent</code> CLI.
            </li>
            <li>
              <code>@turnstile/shared</code> holds the program ids, the x402 types and the
              instruction builders for owner transactions.
            </li>
            <li>
              The facilitator is an HTTP service that verifies payments and submits settlements. It
              pays network fees and can never move funds on its own.
            </li>
          </ul>
          <p>
            The packages are private workspace packages today. Add them to a package in the monorepo
            with <code>workspace:*</code>. The programs run on a local validator and use the same
            program ids on devnet.
          </p>
        </Prose>
      </DocSection>
    </article>
  );
}
