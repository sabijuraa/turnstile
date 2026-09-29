import type { CSSProperties } from "react";
import styles from "./Gate.module.css";
import { Icon } from "./Icon";

export type GateCheckState = "pass" | "fail" | "skip";

export interface GateCheck {
  /** The rule, for example "Per-call cap". */
  label: string;
  /** The figures that decided it, for example "0.004 ≤ 0.010". */
  detail: string;
  state: GateCheckState;
}

export interface GateRequest {
  method: string;
  /** Route path, for example "/v1/summarize". */
  path: string;
  /** Exact decimal price the 402 asked for. */
  price: string;
  asset: string;
}

export type GateOutcome =
  | {
      kind: "settled";
      amount: string;
      asset: string;
      /** Short receipt reference, for example a shortened receipt address. */
      reference: string;
    }
  | {
      kind: "refused";
      /** Plain reason, for example "Daily cap reached". */
      reason: string;
      /** Program error name, for example "DailyCapExceeded". */
      code?: string;
    };

export type GateMotion = "loop" | "once" | "still";

export interface GateProps {
  request: GateRequest;
  checks: readonly GateCheck[];
  outcome: GateOutcome;
  /** `full` is the hero element. `compact` is a single row echo for strips and the demo header. */
  variant?: "full" | "compact";
  /**
   * `loop` replays forever after a pause, `once` plays a single pass (change the React key to
   * replay it for each new request), `still` shows the end state only.
   */
  motion?: GateMotion;
}

function summary(request: GateRequest, checks: readonly GateCheck[], outcome: GateOutcome): string {
  const rules = checks.map((check) => check.label.toLowerCase()).join(", ");
  const head = `A ${request.method} request to ${request.path} asks ${request.price} ${request.asset}. It is checked against ${rules}.`;
  if (outcome.kind === "settled") {
    return `${head} It passes and settles ${outcome.amount} ${outcome.asset} with receipt ${outcome.reference}.`;
  }
  const failed = checks.find((check) => check.state === "fail");
  return `${head} ${failed ? `${failed.label} fails. ` : ""}The payment is refused on chain. ${outcome.reason}.`;
}

/**
 * The signature motion element. A request enters, is checked against the policy, passes the gate
 * and a receipt lands. The markup is the finished state, so the first frame is complete with no
 * script and with reduced motion. CSS replays the flow on top of it.
 */
export function Gate({ request, checks, outcome, variant = "full", motion = "loop" }: GateProps) {
  const refused = outcome.kind === "refused";
  const classes = [styles.gate, styles[variant], styles[`motion-${motion}`]].join(" ");
  return (
    <figure className={classes} data-outcome={outcome.kind}>
      <figcaption className="visually-hidden">{summary(request, checks, outcome)}</figcaption>
      <div className={styles.stage} aria-hidden="true">
        <span className={styles.lane} />
        <span className={styles.token} />

        <div className={styles.request}>
          <span className={styles.kicker}>Request</span>
          <span className={styles.route}>
            <span className={styles.method}>{request.method}</span>
            <span className={styles.path}>{request.path}</span>
          </span>
          <span className={styles.price}>
            <span className={styles.status402}>402</span>
            <span>
              {request.price} {request.asset}
            </span>
          </span>
        </div>

        <div className={styles.gatePanel}>
          <span className={styles.barrier}>
            <span className={styles.post} />
            <span className={`${styles.arm} ${styles.armLeft}`} />
            <span className={`${styles.arm} ${styles.armRight}`} />
            <span className={styles.post} />
          </span>
          <span className={styles.panelHead}>
            <span className={styles.kicker}>Policy check</span>
            <span className={styles.onchain}>
              <Icon name="lock" size={12} />
              On chain
            </span>
          </span>
          <ul className={styles.checks}>
            {checks.map((check, index) => (
              <li
                key={check.label}
                className={styles.check}
                data-state={check.state}
                style={{ "--i": index } as CSSProperties}
              >
                <span className={styles.mark}>
                  <span className={styles.ring} />
                  <span className={styles.tick}>
                    <Icon
                      name={
                        check.state === "fail"
                          ? "close"
                          : check.state === "pass"
                            ? "check"
                            : "clock"
                      }
                      size={12}
                      strokeWidth={2}
                    />
                  </span>
                </span>
                <span className={styles.checkLabel}>{check.label}</span>
                <span className={styles.checkDetail}>
                  {check.state === "skip" ? "Not reached" : check.detail}
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className={styles.outcome}>
          {refused ? (
            <>
              <span className={styles.outcomeHead}>
                <span className={styles.refusedPill}>
                  <Icon name="close" size={12} strokeWidth={2} />
                  Refused
                </span>
                {outcome.code ? <span className={styles.reference}>{outcome.code}</span> : null}
              </span>
              <span className={styles.refusedReason}>{outcome.reason}</span>
            </>
          ) : (
            <>
              <span className={styles.outcomeHead}>
                <span className={styles.settledPill}>
                  <Icon name="check" size={12} strokeWidth={2} />
                  Settled
                </span>
                <span className={styles.reference}>{outcome.reference}</span>
              </span>
              <span className={styles.amount}>
                {outcome.amount}
                <span className={styles.asset}>{outcome.asset}</span>
              </span>
            </>
          )}
        </div>
      </div>
    </figure>
  );
}
