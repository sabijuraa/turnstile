import { AUTHORIZATION_MESSAGE_LEN } from "@turnstile/shared";
import { Gate, type GateCheck } from "@/components/Gate";
import { Icon } from "@/components/Icon";
import { Illustration } from "@/components/Illustration";
import { Section } from "@/components/Section";
import styles from "./security.module.css";

const checks: readonly { rule: string; codes: readonly string[] }[] = [
  { rule: "The payment has not passed its expiry.", codes: ["AuthorizationExpired"] },
  {
    rule: `The session key signed this exact ${AUTHORIZATION_MESSAGE_LEN} byte payment. An Ed25519 check in the same transaction proves it.`,
    codes: ["SignatureMismatch"],
  },
  { rule: "Its nonce has never settled before.", codes: ["NonceAlreadyUsed"] },
  {
    rule: "The session key belongs to the wallet, is active and has not expired.",
    codes: ["SessionKeyNotFound", "SessionKeyRevoked", "SessionKeyExpired"],
  },
  { rule: "The amount is within the per-call cap.", codes: ["PerCallCapExceeded"] },
  { rule: "The route and recipient pair is on the allow-list.", codes: ["ResourceNotAllowed"] },
  {
    rule: "The amount fits under the daily cap for the rolling 24 hours.",
    codes: ["DailyCapExceeded"],
  },
  { rule: "The vault holds enough to pay.", codes: ["InsufficientFunds"] },
];

const limits: readonly string[] = [
  "A leaked session key can spend up to your caps, on the pairs you allowed, until you revoke it or it expires. That is why caps and expiries exist.",
  "Anyone with your owner key controls the wallet. Keep it in a wallet you trust.",
  "A service can take a fair payment and return a poor answer. The receipt proves you paid, not what you got.",
  "Below your per-call cap, each service sets its own price.",
  "A facilitator that is down or compromised can delay payments. It cannot redirect them.",
  "The rules are the program code. Solana Explorer shows who is allowed to upgrade each program.",
];

const refusedChecks: readonly GateCheck[] = [
  { label: "Per-call cap", detail: "0.004 ≤ 0.01", state: "pass" },
  { label: "Allow-listed", detail: "route and payee", state: "pass" },
  { label: "Daily cap", detail: "4.998 + 0.004 > 5", state: "fail" },
];

export function Guarantee() {
  return (
    <Section id="guarantee" labelledBy="guarantee-title">
      <div className={styles.split}>
        <div className={styles.splitCopy}>
          <p className={`label ${styles.eyebrow}`}>The on-chain guarantee</p>
          <h2 id="guarantee-title" className={styles.splitTitle}>
            Nothing leaves a vault unless every rule passes.
          </h2>
          <p className={styles.splitLead}>
            Only the settlement program can ask an agent wallet to pay. It does so inside one Solana
            transaction, and only after every check below passes. If one fails, the whole
            transaction fails and nothing moves.
          </p>
          <p className={styles.splitNote}>
            The daily cap is counted in 15 minute buckets. A payment counts toward it for at least
            24 hours and at most 24 hours and 15 minutes. It errs on your side and never lets more
            than the cap through in any real 24 hours.
          </p>
        </div>
        <Illustration
          className={styles.splitVisual}
          note="Illustration. A sample refusal, not live data."
        >
          <Gate
            motion="still"
            request={{ method: "POST", path: "/v1/summarize", price: "0.004", asset: "USDC" }}
            checks={refusedChecks}
            outcome={{ kind: "refused", reason: "Daily cap reached", code: "DailyCapExceeded" }}
          />
        </Illustration>
      </div>

      <div className={styles.columns}>
        <div className={styles.column}>
          <h3 className={styles.columnTitle}>
            <Icon name="check" size={18} className={styles.iconPass} />
            Checked on every payment
          </h3>
          <ol className={styles.ruleList}>
            {checks.map((check, index) => (
              <li key={check.rule}>
                <span className={styles.ruleIndex}>{String(index + 1).padStart(2, "0")}</span>
                <span className={styles.ruleText}>
                  {check.rule}
                  <span className={styles.ruleCodes}>
                    {check.codes.map((code) => (
                      <code key={code}>{code}</code>
                    ))}
                  </span>
                </span>
              </li>
            ))}
          </ol>
        </div>
        <div className={styles.column}>
          <h3 className={styles.columnTitle}>
            <Icon name="alert" size={18} className={styles.iconWarn} />
            What it does not cover
          </h3>
          <ul className={styles.limitList}>
            {limits.map((limit) => (
              <li key={limit}>{limit}</li>
            ))}
          </ul>
        </div>
      </div>
    </Section>
  );
}
