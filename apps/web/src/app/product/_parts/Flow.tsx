import { Gate } from "@/components/Gate";
import { Icon, type IconName } from "@/components/Icon";
import { Illustration } from "@/components/Illustration";
import { Section } from "@/components/Section";
import { sampleChecks, sampleOutcome, sampleRequest } from "./illustration";
import styles from "./product.module.css";

const steps: readonly { icon: IconName; title: string; tag: string; body: string }[] = [
  {
    icon: "agent",
    title: "Request",
    tag: "POST /v1/summarize",
    body: "Your agent calls a paid route the same way it calls any other API.",
  },
  {
    icon: "coins",
    title: "402 Payment Required",
    tag: "PAYMENT-REQUIRED",
    body: "The service answers with the price, the asset, who gets paid and a fresh nonce.",
  },
  {
    icon: "key",
    title: "Signed payment",
    tag: "PAYMENT-SIGNATURE",
    body: "The agent signs that exact payment with its session key and sends the request again.",
  },
  {
    icon: "shield",
    title: "Settlement",
    tag: "settle",
    body: "The settlement program checks the signature and your policy before a single token moves.",
  },
  {
    icon: "receipt",
    title: "Receipt",
    tag: "Receipt account",
    body: "A receipt is written in the same transaction, keyed by the nonce so it can never settle twice.",
  },
  {
    icon: "check",
    title: "Resource",
    tag: "PAYMENT-RESPONSE",
    body: "The service returns the response with proof of the settled payment attached.",
  },
];

export function Flow() {
  return (
    <Section
      id="flow"
      tone="surface"
      eyebrow="The payment flow"
      title="From request to receipt in one exchange."
      lead="Payment happens inside the HTTP call. The agent never leaves the request to go and pay, and the service never waits on an invoice."
    >
      <div className={styles.flowGrid}>
        <div className={styles.flowVisual}>
          <Illustration note="Illustration. A sample request and receipt, not live data.">
            <Gate request={sampleRequest} checks={sampleChecks} outcome={sampleOutcome} />
          </Illustration>
        </div>
        <ol className={styles.sequence}>
          {steps.map((step, index) => (
            <li key={step.title} className={styles.seqStep}>
              <span className={styles.seqIcon}>
                <Icon name={step.icon} size={20} />
              </span>
              <div className={styles.seqText}>
                <p className={styles.seqMeta}>
                  <span className={styles.seqNumber}>{String(index + 1).padStart(2, "0")}</span>
                  <code className={styles.seqTag}>{step.tag}</code>
                </p>
                <h3 className={styles.seqTitle}>{step.title}</h3>
                <p className={styles.seqBody}>{step.body}</p>
              </div>
            </li>
          ))}
        </ol>
      </div>
    </Section>
  );
}
