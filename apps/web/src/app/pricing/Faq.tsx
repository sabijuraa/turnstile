import { Icon } from "@/components/Icon";
import styles from "./pricing.module.css";

const questions: readonly { id: string; question: string; answer: readonly string[] }[] = [
  {
    id: "fee",
    question: "What does the fee cover?",
    answer: [
      "In the illustrative model the fee pays for running the facilitator, the network fees it covers on each settlement, the indexer that keeps your receipts searchable and the console.",
      "The SDKs, the receipts and the statements come with it. There is nothing extra to buy.",
    ],
  },
  {
    id: "today",
    question: "Is anything charged today?",
    answer: [
      "No. Turnstile is a portfolio build with no commercial offering. The programs send the full amount of each payment to the service and take no cut.",
    ],
  },
  {
    id: "stablecoin",
    question: "Which stablecoin does it use?",
    answer: [
      "A USDC-style stablecoin with 6 decimals, so the smallest amount is one millionth of a token.",
      "The live demo runs on a test stablecoin minted just for the demo. It has no value.",
    ],
  },
  {
    id: "network",
    question: "Which network does it run on?",
    answer: [
      "Solana. The live demo runs on devnet. In development everything runs against a local validator.",
    ],
  },
  {
    id: "limits",
    question: "How are my limits enforced?",
    answer: [
      "On chain, on every payment. The settlement program checks the per-call cap, the daily cap over a rolling 24 hours and the allow-list of resource and recipient before any funds move.",
      "A payment that breaks any of them fails at the program, whatever an off-chain service claims. The agent SDK checks the same limits first so it can refuse before it signs.",
    ],
  },
  {
    id: "failure",
    question: "What happens if a payment fails?",
    answer: [
      "No funds move and the resource is not served. The agent gets a specific reason back, for example that the daily cap is reached or the route is not on its allow-list.",
      "If the failure was in transport rather than policy, the payment is queued and replayed. A replay never charges twice, because each payment carries a nonce that can settle only once.",
    ],
  },
  {
    id: "facilitator",
    question: "Can the facilitator take funds from my agent?",
    answer: [
      "No. The facilitator can only submit a payment that your agent's session key already signed. It has no authority over the vault. Apart from you, only the settlement program can move funds out of it, and only inside your policy.",
    ],
  },
  {
    id: "network-fees",
    question: "Who pays the network fees?",
    answer: [
      "The facilitator pays the Solana network fee for every settlement. Your agent pays the price of the call and nothing more.",
    ],
  },
  {
    id: "withdraw",
    question: "Can I get unspent funds back?",
    answer: [
      "Yes. As the owner you can withdraw from your agent wallet at any time. The agent cannot.",
    ],
  },
];

/** Pricing questions as native disclosure elements. Each one opens with Enter or Space. */
export function Faq() {
  return (
    <div className={styles.faq}>
      {questions.map((item) => (
        <details key={item.id} className={styles.faqItem}>
          <summary className={styles.faqQuestion}>
            <span>{item.question}</span>
            <Icon name="chevronDown" size={20} className={styles.faqChevron} />
          </summary>
          <div className={styles.faqAnswer}>
            {item.answer.map((paragraph) => (
              <p key={paragraph}>{paragraph}</p>
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}
