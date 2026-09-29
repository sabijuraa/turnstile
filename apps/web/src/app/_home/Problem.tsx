import { Section } from "@/components/Section";
import styles from "./home.module.css";

const problems = [
  {
    title: "Agents cannot click buy",
    body: "Checkout was built for a person with a card and a button. An agent makes thousands of calls an hour and has no one to press it.",
  },
  {
    title: "Cards give no per-call control",
    body: "A card on file has one limit for everything. You cannot tell it this agent may spend a cent per call and five dollars a day.",
  },
  {
    title: "Invoices arrive too late",
    body: "A monthly bill tells you what happened weeks ago. It cannot show which call cost what. It cannot stop the next one.",
  },
] as const;

export function Problem() {
  return (
    <Section
      id="problem"
      eyebrow="The problem"
      title="Paying online was built for people at a checkout."
    >
      <ol className={styles.problems}>
        {problems.map((problem, index) => (
          <li key={problem.title} className={styles.problem}>
            <span className={styles.problemIndex}>{String(index + 1).padStart(2, "0")}</span>
            <h3 className={styles.problemTitle}>{problem.title}</h3>
            <p className={styles.problemBody}>{problem.body}</p>
          </li>
        ))}
      </ol>
    </Section>
  );
}
