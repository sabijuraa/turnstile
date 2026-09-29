import { Icon, type IconName } from "@/components/Icon";
import { Illustration } from "@/components/Illustration";
import { PolicyPanel } from "@/components/PolicyPanel";
import { Section } from "@/components/Section";
import { SpendMeter } from "@/components/SpendMeter";
import styles from "./home.module.css";
import { sampleAsset, samplePolicy } from "./illustration";

const rules: readonly { icon: IconName; title: string; body: string }[] = [
  {
    icon: "coins",
    title: "Per-call cap",
    body: "The most any single request can cost.",
  },
  {
    icon: "clock",
    title: "Daily cap",
    body: "A ceiling on everything the agent spends in any rolling 24 hours.",
  },
  {
    icon: "list",
    title: "Allow-list",
    body: "The exact services and payees the agent may pay. Anything else is refused.",
  },
  {
    icon: "key",
    title: "Session key",
    body: "The agent signs with a scoped key that can pay and do nothing else. Revoke it any time.",
  },
];

export function Control() {
  return (
    <Section id="control" labelledBy="control-title" tone="surface">
      <div className={styles.split}>
        <div className={styles.splitCopy}>
          <p className={`label ${styles.eyebrow}`}>Control</p>
          <h2 id="control-title" className={styles.splitTitle}>
            Set the limits once. The chain keeps them.
          </h2>
          <p className={styles.splitLead}>
            Your policy lives in the agent wallet on Solana. Every payment is checked against it
            before a single token moves. A runaway agent or a compromised server still cannot spend
            past it.
          </p>
          <ul className={styles.rules}>
            {rules.map((rule) => (
              <li key={rule.title} className={styles.rule}>
                <span className={styles.ruleIcon}>
                  <Icon name={rule.icon} size={18} />
                </span>
                <span>
                  <strong className={styles.ruleTitle}>{rule.title}</strong>
                  <span className={styles.ruleBody}>{rule.body}</span>
                </span>
              </li>
            ))}
          </ul>
        </div>
        <Illustration className={styles.splitVisual}>
          <PolicyPanel
            title={samplePolicy.title}
            perCallCap={samplePolicy.perCallCap}
            dailyCap={samplePolicy.dailyCap}
            asset={sampleAsset}
            sessionKey={samplePolicy.sessionKey}
            allowList={samplePolicy.allowList}
            meter={
              <SpendMeter
                label="Spent in the last 24 hours"
                spent={samplePolicy.spent}
                cap={samplePolicy.cap}
                asset={sampleAsset}
              />
            }
          />
        </Illustration>
      </div>
    </Section>
  );
}
