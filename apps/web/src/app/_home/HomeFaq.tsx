import { Icon } from "@/components/Icon";
import { Reveal } from "@/components/Reveal";
import { Section } from "@/components/Section";
import styles from "./home.module.css";

const questions = [
  {
    question: "Can my agent overspend?",
    answer: "No. A payment past your cap fails on chain.",
  },
  {
    question: "Who holds the money?",
    answer: "You do. Withdraw from your agent wallet any time.",
  },
  {
    question: "What if a payment fails?",
    answer: "No funds move, and the agent gets the reason.",
  },
  {
    question: "Is it live?",
    answer: "It runs on Solana devnet with a test stablecoin that has no value.",
  },
] as const;

export function HomeFaq() {
  return (
    <Section id="faq" eyebrow="Questions" title="Quick answers." tone="surface" flush>
      <Reveal className={styles.faq}>
        {questions.map((item) => (
          <details key={item.question} className={styles.faqItem}>
            <summary>
              {item.question}
              <Icon name="chevronDown" size={20} className={styles.faqChevron} />
            </summary>
            <p>{item.answer}</p>
          </details>
        ))}
      </Reveal>
    </Section>
  );
}
