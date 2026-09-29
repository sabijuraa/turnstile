import { MAX_ALLOW_LIST, MAX_SESSION_KEYS } from "@turnstile/shared";
import { Icon, type IconName } from "@/components/Icon";
import { Illustration } from "@/components/Illustration";
import { PolicyPanel } from "@/components/PolicyPanel";
import { Section } from "@/components/Section";
import { SpendMeter } from "@/components/SpendMeter";
import { sampleAsset, samplePolicy } from "./illustration";
import styles from "./product.module.css";

const terms: readonly { icon: IconName; title: string; body: string }[] = [
  {
    icon: "key",
    title: "Session key",
    body: `The agent holds a scoped key that signs payments and nothing else. A wallet holds up to ${MAX_SESSION_KEYS}, each with an optional expiry. A revoked key stops working on the next payment.`,
  },
  {
    icon: "coins",
    title: "Per-call cap",
    body: "The most a single request can cost. A price above it is refused, whatever the service asks.",
  },
  {
    icon: "clock",
    title: "Daily cap",
    body: "A ceiling on spend in any rolling 24 hours. It is counted in 15 minute buckets and rounds in your favor, so a payment always counts for at least a full day.",
  },
  {
    icon: "list",
    title: "Allow-list",
    body: `Pairs of a service route and the wallet it pays, up to ${MAX_ALLOW_LIST}. Both halves must match. An empty list allows nothing.`,
  },
];

const refusals: readonly { code: string; meaning: string }[] = [
  { code: "PerCallCapExceeded", meaning: "The price is above the per-call cap." },
  { code: "DailyCapExceeded", meaning: "The payment would take the last 24 hours past the cap." },
  { code: "ResourceNotAllowed", meaning: "The route and payee pair is not on the allow-list." },
  { code: "SessionKeyRevoked", meaning: "The owner revoked the key that signed it." },
  { code: "SessionKeyExpired", meaning: "The key that signed it is past its expiry." },
  { code: "NonceAlreadyUsed", meaning: "This exact payment has already settled once." },
  { code: "InsufficientFunds", meaning: "The vault does not hold enough to pay." },
];

export function Policy() {
  return (
    <Section id="policy" labelledBy="policy-title">
      <div className={styles.split}>
        <div className={styles.splitCopy}>
          <p className={`label ${styles.eyebrow}`}>Policy and control</p>
          <h2 id="policy-title" className={styles.splitTitle}>
            Limits you set once. Checked on every payment.
          </h2>
          <p className={styles.splitLead}>
            Your policy is stored in the agent wallet on Solana. You change it by signing with your
            own wallet. The agent cannot change it, and neither can any service it pays.
          </p>
          <ul className={styles.terms}>
            {terms.map((term) => (
              <li key={term.title} className={styles.term}>
                <span className={styles.termIcon}>
                  <Icon name={term.icon} size={18} />
                </span>
                <span>
                  <strong className={styles.termTitle}>{term.title}</strong>
                  <span className={styles.termBody}>{term.body}</span>
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

      <div className={styles.refusals}>
        <div className={styles.refusalsHead}>
          <h3 className={styles.refusalsTitle}>When a rule says no</h3>
          <p className={styles.refusalsLead}>
            A refused payment moves nothing and the request is not served. The reason comes back by
            name, the same one the chain gives.
          </p>
        </div>
        <dl className={styles.refusalList}>
          {refusals.map((refusal) => (
            <div key={refusal.code} className={styles.refusal}>
              <dt>
                <code>{refusal.code}</code>
              </dt>
              <dd>{refusal.meaning}</dd>
            </div>
          ))}
        </dl>
      </div>
    </Section>
  );
}
