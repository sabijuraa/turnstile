import Link from "next/link";
import { Icon, type IconName } from "@/components/Icon";
import { Section } from "@/components/Section";
import styles from "./product.module.css";

const points: readonly { icon: IconName; title: string; body: string }[] = [
  {
    icon: "lock",
    title: "Your limits hold on their own",
    body: "The chain checks every payment against your policy. A bug or a breach in any service cannot raise a cap.",
  },
  {
    icon: "wallet",
    title: "Your key stays with you",
    body: "You sign policy and funding changes in your own wallet. Turnstile never asks for your key.",
  },
  {
    icon: "key",
    title: "The agent key can only pay",
    body: "It signs payments inside your limits and nothing else. Revoke it the moment something looks wrong.",
  },
  {
    icon: "shield",
    title: "The relay cannot touch funds",
    body: "The facilitator submits payments and pays network fees. It has no authority over any vault.",
  },
];

export function Posture() {
  return (
    <Section
      id="security"
      eyebrow="Security"
      title="No single service can spend your money."
      lead="Turnstile is built so the part you trust most, the chain, is the only part that can move funds."
    >
      <ul className={styles.posture}>
        {points.map((point) => (
          <li key={point.title} className={styles.posturePoint}>
            <Icon name={point.icon} size={20} className={styles.postureIcon} />
            <h3 className={styles.postureTitle}>{point.title}</h3>
            <p className={styles.postureBody}>{point.body}</p>
          </li>
        ))}
      </ul>
      <Link className={styles.textLink} href="/security">
        Read the full security model
        <Icon name="arrowRight" size={16} />
      </Link>
    </Section>
  );
}
