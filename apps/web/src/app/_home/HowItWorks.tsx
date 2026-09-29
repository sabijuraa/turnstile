import { Icon, type IconName } from "@/components/Icon";
import { Section } from "@/components/Section";
import styles from "./home.module.css";

const steps: readonly { icon: IconName; title: string; body: string }[] = [
  {
    icon: "endpoint",
    title: "Wrap the endpoint",
    body: "Add the SDK to a route. Unpaid calls get a price back instead of the response.",
  },
  {
    icon: "wallet",
    title: "Fund the agent",
    body: "Create an agent wallet and move stablecoin into its vault on Solana.",
  },
  {
    icon: "gauge",
    title: "Set the limits",
    body: "Choose a per-call cap, a daily cap and the services the agent may pay.",
  },
  {
    icon: "receipt",
    title: "Watch receipts",
    body: "Each paid call settles on chain and lands in your console as it happens.",
  },
];

export function HowItWorks() {
  return (
    <Section
      id="how-it-works"
      eyebrow="How it works"
      title="From a free endpoint to a paid one in four steps."
      lead="The payment rides along with the request. Your agent pays. The service answers. The receipt is already on chain."
    >
      <div className={styles.flow}>
        <div className={styles.track} aria-hidden="true">
          <span className={styles.trackFill} />
        </div>
        <ol className={styles.steps}>
          {steps.map((step, index) => (
            <li key={step.title} className={styles.step}>
              <span className={styles.stepIcon}>
                <Icon name={step.icon} size={22} />
              </span>
              <span className={styles.stepNumber}>Step {index + 1}</span>
              <h3 className={styles.stepTitle}>{step.title}</h3>
              <p className={styles.stepBody}>{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}
