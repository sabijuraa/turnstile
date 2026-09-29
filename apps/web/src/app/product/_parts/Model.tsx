import { Icon, type IconName } from "@/components/Icon";
import { Container } from "@/components/Section";
import styles from "./product.module.css";

const parts: readonly { icon: IconName; title: string; body: string }[] = [
  {
    icon: "shield",
    title: "Programs on Solana",
    body: "They hold each agent's funds in a vault, check your policy on every payment and write a receipt when it settles.",
  },
  {
    icon: "code",
    title: "A facilitator and two SDKs",
    body: "One SDK turns a route into a paid route. The other lets an agent pay it on its own, inside its limits.",
  },
  {
    icon: "gauge",
    title: "The console",
    body: "Create agent wallets, fund them, set their limits and watch every payment land as it settles.",
  },
];

export function Model() {
  return (
    <section className={styles.model} aria-labelledby="model-title">
      <Container>
        <h2 id="model-title" className={`label ${styles.modelLabel}`}>
          Three parts make it work
        </h2>
        <ol className={styles.parts}>
          {parts.map((part) => (
            <li key={part.title} className={styles.part}>
              <span className={styles.partIcon}>
                <Icon name={part.icon} size={20} />
              </span>
              <h3 className={styles.partTitle}>{part.title}</h3>
              <p className={styles.partBody}>{part.body}</p>
            </li>
          ))}
        </ol>
      </Container>
    </section>
  );
}
