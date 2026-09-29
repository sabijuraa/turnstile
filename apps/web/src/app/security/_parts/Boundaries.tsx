import { Icon, type IconName } from "@/components/Icon";
import { Section } from "@/components/Section";
import styles from "./security.module.css";

const parties: readonly {
  icon: IconName;
  name: string;
  holds: string;
  can: string;
  cannot: string;
}[] = [
  {
    icon: "shield",
    name: "The chain",
    holds: "Agent funds, policies, session keys and receipts.",
    can: "Pay a service from a vault, only when a signed payment passes every rule.",
    cannot: "Accept a policy change the owner did not sign.",
  },
  {
    icon: "wallet",
    name: "Your wallet",
    holds: "The owner key for each agent wallet.",
    can: "Fund, withdraw, set the policy, add and revoke session keys.",
    cannot: "Be reached by Turnstile. The key never leaves it.",
  },
  {
    icon: "agent",
    name: "The agent",
    holds: "One scoped session key.",
    can: "Sign a payment inside your limits.",
    cannot: "Change a limit, withdraw or sign anything else.",
  },
  {
    icon: "pulse",
    name: "The facilitator",
    holds: "A fee payer key.",
    can: "Submit signed payments and pay the network fees.",
    cannot: "Move funds, change an amount or pick a recipient.",
  },
  {
    icon: "gauge",
    name: "Console and website",
    holds: "No agent key and no owner key.",
    can: "Prepare transactions for your wallet to sign and show your receipts.",
    cannot: "Sign for you or spend from any vault.",
  },
];

export function Boundaries() {
  return (
    <Section
      id="boundaries"
      eyebrow="Trust boundaries"
      title="The chain is the source of truth."
      lead="Each part of Turnstile holds one kind of key and can do one kind of thing. The chain decides. Everything else is there for speed."
    >
      <ul className={styles.parties}>
        {parties.map((party) => (
          <li key={party.name} className={styles.party}>
            <h3 className={styles.partyName}>
              <span className={styles.partyIcon}>
                <Icon name={party.icon} size={18} />
              </span>
              {party.name}
            </h3>
            <dl className={styles.partyFacts}>
              <div>
                <dt>Holds</dt>
                <dd>{party.holds}</dd>
              </div>
              <div>
                <dt>Can</dt>
                <dd>{party.can}</dd>
              </div>
              <div>
                <dt className={styles.cannot}>Cannot</dt>
                <dd>{party.cannot}</dd>
              </div>
            </dl>
          </li>
        ))}
      </ul>
    </Section>
  );
}
