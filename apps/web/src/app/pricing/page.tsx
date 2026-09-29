import type { Metadata } from "next";
import { ButtonLink } from "@/components/Button";
import { Icon, type IconName } from "@/components/Icon";
import { PageIntro } from "@/components/PageIntro";
import { Section } from "@/components/Section";
import { Faq } from "./Faq";
import { Included } from "./Included";
import { PriceCard } from "./PriceCard";
import styles from "./pricing.module.css";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "Turnstile is a portfolio build with nothing to buy yet. Here is the simple model it would use, what is included and plain answers to common questions.",
};

const rules: readonly { icon: IconName; title: string; body: string }[] = [
  {
    icon: "coins",
    title: "A share of settled volume",
    body: "The fee is a small percentage of each payment that settles on chain. No seats, no setup fee, no monthly minimum.",
  },
  {
    icon: "pulse",
    title: "Network fees included",
    body: "The facilitator pays the Solana network fee on every settlement. Your agent pays only the price of the call.",
  },
  {
    icon: "shield",
    title: "Nothing on a refusal",
    body: "A refused or failed payment moves no funds. There is nothing to take a fee from.",
  },
  {
    icon: "receipt",
    title: "Easy to check",
    body: "Every fee would trace back to a receipt you can read on chain and export.",
  },
];

export default function PricingPage() {
  return (
    <>
      <PageIntro eyebrow="Pricing" title="A small fee on what settles.">
        Turnstile is a portfolio build and has nothing to buy yet. Nothing is charged today. This
        page shows the simple model it would use, with numbers that are illustrative.
      </PageIntro>

      <Section id="model" labelledBy="model-title" tone="surface">
        <div className={styles.split}>
          <div className={styles.splitCopy}>
            <p className={`label ${styles.eyebrow}`}>The model</p>
            <h2 id="model-title" className={styles.splitTitle}>
              Pay only when a payment settles.
            </h2>
            <p className={styles.splitLead}>
              One percentage of settled volume and nothing else. If a call is not paid, it costs
              nothing.
            </p>
            <ul className={styles.rules}>
              {rules.map((rule) => (
                <li key={rule.title} className={styles.rule}>
                  <span className={styles.ruleIcon}>
                    <Icon name={rule.icon} size={18} />
                  </span>
                  <span>
                    <strong className={styles.ruleTitle}>{rule.title}</strong>
                    <span className={styles.ruleBody}>{rule.body}</span>
                  </span>
                </li>
              ))}
            </ul>
          </div>
          <PriceCard />
        </div>
      </Section>

      <Section
        id="included"
        eyebrow="What is included"
        title="Every part, on every account."
        lead="There are no tiers and no add-ons. Builders and owners each use the parts that fit their side of the call."
      >
        <Included />
      </Section>

      <Section id="faq" labelledBy="faq-title" tone="surface">
        <div className={styles.faqLayout}>
          <div className={styles.faqHead}>
            <p className={`label ${styles.eyebrow}`}>Questions</p>
            <h2 id="faq-title" className={styles.splitTitle}>
              Straight answers before you start.
            </h2>
            <p className={styles.splitLead}>
              What the fee covers, where the money lives and what happens when a payment does not go
              through.
            </p>
          </div>
          <Faq />
        </div>
      </Section>

      <section className={styles.closing} aria-labelledby="pricing-closing-title">
        <div className={styles.closingInner}>
          <h2 id="pricing-closing-title" className={styles.closingTitle}>
            See it work before you think about price.
          </h2>
          <p className={styles.closingLead}>
            The live demo is open to anyone. Watch a real agent pay a metered API until its daily
            cap stops it.
          </p>
          <div className={styles.closingActions}>
            <ButtonLink href="/demo" icon="arrowRight">
              Open the live demo
            </ButtonLink>
            <ButtonLink href="/docs" variant="secondary">
              Read the docs
            </ButtonLink>
          </div>
        </div>
      </section>
    </>
  );
}
