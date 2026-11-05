import type { Metadata } from "next";
import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";
import { DocHeader, DocSection } from "./_components/Doc";
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
    text: "Charge for an HTTP route.",
  },
  {
    href: "/docs/agent-quickstart",
    title: "Agent quickstart",
    icon: "agent",
    text: "Let an agent pay a 402.",
  },
  {
    href: "/docs/concepts",
    title: "Concepts",
    icon: "shield",
    text: "Wallets, keys, policies and receipts.",
  },
  {
    href: "/docs/reference",
    title: "Reference",
    icon: "code",
    text: "Endpoints, options and error codes.",
  },
];

export default function Page() {
  return (
    <article>
      <DocHeader eyebrow="Docs" title="Turnstile documentation">
        Pick the side you are building.
      </DocHeader>

      <DocSection id="start" title="Where to start">
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
        <ol className={styles.steps}>
          <li>The agent calls your route.</li>
          <li>
            Your route answers <code>402</code> with a price and a nonce.
          </li>
          <li>The agent signs that exact payment.</li>
          <li>The chain checks the limits and moves the funds.</li>
          <li>A receipt lands and your handler responds.</li>
        </ol>
      </DocSection>
    </article>
  );
}
