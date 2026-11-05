"use client";

import { Icon } from "@/components/Icon";
import styles from "./SettleAnatomy.module.css";
import { useStepLoop } from "./useStepLoop";

const settlementChecks = [
  { rule: "Not expired", code: "AuthorizationExpired" },
  { rule: "Expires within 24 hours", code: "ExpiryTooFar" },
  { rule: "Signature covers this payment", code: "SignatureMismatch" },
  { rule: "Nonce never used", code: "NonceAlreadyUsed" },
] as const;

const walletChecks = [
  { rule: "Session key active", code: "SessionKeyRevoked" },
  { rule: "Within the per-call cap", code: "PerCallCapExceeded" },
  { rule: "Route and payee allowed", code: "ResourceNotAllowed" },
  { rule: "Fits the rolling daily cap", code: "DailyCapExceeded" },
  { rule: "Vault can pay", code: "InsufficientFunds" },
] as const;

const effects = [
  { rule: "Tokens move to the recipient", code: "vault → recipient" },
  { rule: "Spend added to the current bucket", code: "spend_buckets" },
  { rule: "Receipt account created", code: "seeds: wallet + nonce" },
  { rule: "Event emitted for the indexer", code: "PaymentSettled" },
] as const;

const CHECKS = settlementChecks.length + walletChecks.length;
const TOTAL = CHECKS + effects.length;
/** The daily cap, the check a busy agent meets first, is the one the second pass fails on. */
const FAIL_AT = settlementChecks.length + 3;
const HOLD = 4;

/** Frame numbers for one passing run followed by one refused run. */
const PASS_FRAMES = TOTAL + HOLD;
const REFUSE_FRAMES = FAIL_AT + 1 + HOLD;

type RowState = "idle" | "pass" | "fail" | "reverted";

function CheckList({
  items,
  offset,
  reached,
  failAt,
}: {
  items: readonly { rule: string; code: string }[];
  offset: number;
  reached: number;
  failAt: number | null;
}) {
  return (
    <ol className={styles.list}>
      {items.map((item, i) => {
        const position = offset + i;
        let state: RowState = "idle";
        if (failAt !== null && position === failAt && reached >= failAt) state = "fail";
        else if (failAt !== null && reached >= failAt && position < failAt) state = "reverted";
        else if (position <= reached) state = "pass";
        return (
          <li key={item.rule} className={`${styles.row} ${styles[state]}`}>
            <span className={styles.mark} aria-hidden="true">
              {state === "fail" ? (
                <Icon name="close" size={13} />
              ) : state === "idle" ? null : (
                <Icon name="check" size={13} />
              )}
            </span>
            <span className={styles.rule}>{item.rule}</span>
            <code className={styles.code}>{item.code}</code>
          </li>
        );
      })}
    </ol>
  );
}

/**
 * What `settle` does, in the order the programs do it. Runs once to a receipt, then once to a
 * refusal, where a failed check takes back everything before it.
 */
export function SettleAnatomy() {
  const { ref, frame } = useStepLoop<HTMLElement>(PASS_FRAMES + REFUSE_FRAMES, 620, TOTAL);
  const refusing = frame >= PASS_FRAMES;
  const reached = refusing ? Math.min(frame - PASS_FRAMES, FAIL_AT) : Math.min(frame, TOTAL);
  const failAt = refusing ? FAIL_AT : null;
  const failed = refusing && reached >= FAIL_AT;
  const settled = !refusing && reached >= TOTAL - 1;

  return (
    <figure
      ref={ref}
      className={styles.figure}
      aria-label="One Solana transaction holds an Ed25519 signature check and the settle instruction. Settle checks expiry, signature and nonce, then calls the agent wallet program, which checks the session key, the per-call cap, the allow-list, the daily cap and the vault balance. Only then do tokens move and a receipt get written. Any failure reverts all of it."
    >
      <div className={styles.tx}>
        <span className={styles.txLabel}>One transaction</span>
        <code className={styles.ix}>
          <span>ix 0</span> Ed25519Program
        </code>
        <code className={styles.ix}>
          <span>ix 1</span> settlement::settle
        </code>
      </div>

      <div className={styles.stages}>
        <section className={styles.stage}>
          <h3 className={styles.stageTitle}>settlement</h3>
          <p className={styles.stageNote}>Is this the payment the key signed?</p>
          <CheckList items={settlementChecks} offset={0} reached={reached} failAt={failAt} />
        </section>

        <p className={styles.link}>
          <Icon name="arrowRight" size={16} />
          <span>CPI debit</span>
        </p>

        <section className={styles.stage}>
          <h3 className={styles.stageTitle}>agent_wallet</h3>
          <p className={styles.stageNote}>Does the owner&apos;s policy allow it?</p>
          <CheckList
            items={walletChecks}
            offset={settlementChecks.length}
            reached={reached}
            failAt={failAt}
          />
        </section>

        <p className={styles.link}>
          <Icon name="arrowRight" size={16} />
          <span>commit</span>
        </p>

        <section className={`${styles.stage} ${failed ? styles.dimmed : ""}`}>
          <h3 className={styles.stageTitle}>state changes</h3>
          <p className={styles.stageNote}>Only reached if every check passes.</p>
          <CheckList items={effects} offset={CHECKS} reached={reached} failAt={null} />
        </section>
      </div>

      <p
        className={[
          styles.status,
          failed ? styles.statusFail : "",
          settled ? styles.statusPass : "",
        ].join(" ")}
      >
        {failed ? (
          <>
            <code>DailyCapExceeded</code> The whole transaction reverts. No token moves and the
            nonce stays unspent.
          </>
        ) : settled ? (
          <>
            <code>settled</code> Funds, spend and receipt all landed in the same transaction.
          </>
        ) : (
          <>
            <code>running</code> Each check must pass before the next one runs.
          </>
        )}
      </p>
    </figure>
  );
}
