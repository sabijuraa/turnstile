import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";
import styles from "./solutions.module.css";

export interface UseCase {
  id: string;
  icon: IconName;
  name: string;
  title: string;
  body: string;
  /** What the builder does. Short sentences. */
  steps: readonly string[];
  /** One line on how you would build it. */
  build: string;
  links: readonly { href: string; label: string }[];
}

/** One use case with what it enables, what the builder does and where to start in the docs. */
export function UseCaseCard({ useCase }: { useCase: UseCase }) {
  const titleId = `${useCase.id}-title`;
  return (
    <article className={styles.case} aria-labelledby={titleId}>
      <p className={styles.caseName}>
        <span className={styles.caseIcon}>
          <Icon name={useCase.icon} size={20} />
        </span>
        {useCase.name}
      </p>
      <h3 id={titleId} className={styles.caseTitle}>
        {useCase.title}
      </h3>
      <p className={styles.caseBody}>{useCase.body}</p>
      <div className={styles.caseSteps}>
        <p className="label">What you do</p>
        <ul>
          {useCase.steps.map((step) => (
            <li key={step}>
              <Icon name="check" size={16} />
              {step}
            </li>
          ))}
        </ul>
      </div>
      <div className={styles.caseBuild}>
        <p className="label">How you would build it</p>
        <p className={styles.caseBuildLine}>{useCase.build}</p>
        <p className={styles.caseLinks}>
          {useCase.links.map((link) => (
            <Link key={link.href} href={link.href} className={styles.textLink}>
              {link.label}
              <Icon name="arrowRight" size={16} />
            </Link>
          ))}
        </p>
      </div>
    </article>
  );
}
