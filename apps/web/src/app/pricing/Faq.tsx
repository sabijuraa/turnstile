import { Icon } from "@/components/Icon";
import styles from "./pricing.module.css";

const questions: readonly { question: string; answer: string }[] = [
  {
    question: "Is anything charged today?",
    answer: "No. The full amount of each payment reaches the service.",
  },
  {
    question: "Which stablecoin does it use?",
    answer: "A USDC-style token. The demo uses a test token with no value.",
  },
  {
    question: "Can the facilitator take my funds?",
    answer: "No. It can only submit payments your agent's key already signed.",
  },
  {
    question: "Can I get unspent funds back?",
    answer: "Yes. The owner can withdraw at any time. The agent cannot.",
  },
];

/** Pricing questions as native disclosure elements. Each one opens with Enter or Space. */
export function Faq() {
  return (
    <div className={styles.faq}>
      {questions.map((item) => (
        <details key={item.question} className={styles.faqItem}>
          <summary className={styles.faqQuestion}>
            <span>{item.question}</span>
            <Icon name="chevronDown" size={20} className={styles.faqChevron} />
          </summary>
          <p className={styles.faqAnswer}>{item.answer}</p>
        </details>
      ))}
    </div>
  );
}
