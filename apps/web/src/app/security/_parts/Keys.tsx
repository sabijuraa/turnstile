import { MAX_SESSION_KEYS } from "@turnstile/shared";
import { Icon, type IconName } from "@/components/Icon";
import { Section } from "@/components/Section";
import styles from "./security.module.css";

const keys: readonly { icon: IconName; name: string; points: readonly string[] }[] = [
  {
    icon: "wallet",
    name: "Owner key",
    points: [
      "Stays in your own wallet. You sign funding, policy and key changes in the browser.",
      "Turnstile never sees it and never asks for it.",
    ],
  },
  {
    icon: "key",
    name: "Session keys",
    points: [
      `Up to ${MAX_SESSION_KEYS} per agent wallet, each signing payments and nothing else.`,
      "Each one can carry an expiry. Once it passes, the key is refused on its own.",
      "Revoke a key and the next payment it signs is refused.",
    ],
  },
  {
    icon: "lock",
    name: "Console API keys",
    points: [
      "Shown once, when you create them. Copy it then.",
      "Stored only as a SHA-256 hash, so a copy of the database does not reveal them.",
      "Revoke any key in settings and it stops working at once.",
    ],
  },
];

const rotation: readonly { title: string; body: string }[] = [
  {
    title: "Add a new session key",
    body: "Sign the change in your wallet. Give it an expiry that suits how long the agent runs.",
  },
  {
    title: "Move the agent to it",
    body: "Point the agent at the new key. Both keys work while you switch, so no call fails.",
  },
  {
    title: "Revoke the old key",
    body: "Sign once more. Anything the old key signs from now on is refused on chain.",
  },
];

export function Keys() {
  return (
    <Section
      id="keys"
      tone="surface"
      eyebrow="Key handling and rotation"
      title="Every key has one job and a way out."
      lead="Keys that can spend are scoped, capped and easy to replace. The one key that controls everything never leaves your wallet."
    >
      <ul className={styles.keys}>
        {keys.map((key) => (
          <li key={key.name} className={styles.key}>
            <h3 className={styles.keyName}>
              <span className={styles.keyIcon}>
                <Icon name={key.icon} size={18} />
              </span>
              {key.name}
            </h3>
            <ul className={styles.keyPoints}>
              {key.points.map((point) => (
                <li key={point}>
                  <Icon name="check" size={16} />
                  {point}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ul>

      <div className={styles.rotation}>
        <h3 className={styles.rotationTitle}>Rotate a session key without downtime</h3>
        <ol className={styles.rotationSteps}>
          {rotation.map((step, index) => (
            <li key={step.title} className={styles.rotationStep}>
              <span className={styles.rotationIndex}>{index + 1}</span>
              <h4>{step.title}</h4>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}
