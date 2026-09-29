import { Icon, type IconName } from "@/components/Icon";
import { Section } from "@/components/Section";
import styles from "./home.module.css";

const audiences: readonly {
  icon: IconName;
  label: string;
  title: string;
  points: readonly string[];
}[] = [
  {
    icon: "code",
    label: "For builders",
    title: "Charge per request without building billing.",
    points: [
      "Wrap a route with the SDK and set a price in stablecoin.",
      "Get paid when the call settles. No accounts to open, no invoices to chase.",
      "It speaks x402, so any agent that supports the standard can pay you.",
    ],
  },
  {
    icon: "agent",
    label: "For owners",
    title: "Give agents a budget, not a blank check.",
    points: [
      "Set per-call and daily caps that the chain enforces.",
      "Allow only the services you trust and the wallets they pay.",
      "See every payment as it happens and export the record.",
    ],
  },
];

export function Audiences() {
  return (
    <Section
      id="audiences"
      tone="surface"
      eyebrow="Who it is for"
      title="Two sides of every paid call."
    >
      <div className={styles.audiences}>
        {audiences.map((audience) => (
          <article key={audience.label} className={styles.audience}>
            <p className={styles.audienceLabel}>
              <Icon name={audience.icon} size={18} />
              {audience.label}
            </p>
            <h3 className={styles.audienceTitle}>{audience.title}</h3>
            <ul className={styles.audiencePoints}>
              {audience.points.map((point) => (
                <li key={point}>
                  <Icon name="check" size={16} />
                  {point}
                </li>
              ))}
            </ul>
          </article>
        ))}
      </div>
    </Section>
  );
}
