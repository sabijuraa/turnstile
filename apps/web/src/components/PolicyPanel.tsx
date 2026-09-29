import type { ReactNode } from "react";
import { Icon } from "./Icon";
import styles from "./PolicyPanel.module.css";

export interface PolicyAllowEntry {
  /** Canonical resource, for example "https://api.example.com/v1/summarize". */
  resource: string;
  /** Recipient wallet, usually shortened for display. */
  recipient: string;
}

export interface PolicyPanelProps {
  /** Heading for the panel, for example the agent name. */
  title: string;
  /** Exact decimal strings. */
  perCallCap: string;
  dailyCap: string;
  asset: string;
  allowList: readonly PolicyAllowEntry[];
  /** Session key summary, for example "8xR2…Qm1c, active, no expiry". */
  sessionKey?: string;
  /** Slot under the rules, usually a SpendMeter. */
  meter?: ReactNode;
  /** Action area in the header, for example an Edit policy button in the console. */
  action?: ReactNode;
  headingLevel?: 2 | 3 | 4;
}

/** A read only view of an agent's policy that reads like a permissions panel. */
export function PolicyPanel({
  title,
  perCallCap,
  dailyCap,
  asset,
  allowList,
  sessionKey,
  meter,
  action,
  headingLevel = 3,
}: PolicyPanelProps) {
  const Heading = `h${headingLevel}` as const;
  return (
    <section className={styles.panel} aria-label={`Policy for ${title}`}>
      <header className={styles.head}>
        <div className={styles.titleWrap}>
          <span className={styles.icon}>
            <Icon name="shield" size={18} />
          </span>
          <div>
            <Heading className={styles.title}>{title}</Heading>
            <p className={styles.sub}>Enforced by the agent wallet program on Solana</p>
          </div>
        </div>
        {action}
      </header>
      <dl className={styles.rules}>
        <div className={styles.rule}>
          <dt>
            <Icon name="coins" size={16} />
            Per-call cap
          </dt>
          <dd className={styles.figure}>
            {perCallCap} <span className={styles.unit}>{asset}</span>
          </dd>
        </div>
        <div className={styles.rule}>
          <dt>
            <Icon name="clock" size={16} />
            Daily cap, rolling 24 hours
          </dt>
          <dd className={styles.figure}>
            {dailyCap} <span className={styles.unit}>{asset}</span>
          </dd>
        </div>
        {sessionKey ? (
          <div className={styles.rule}>
            <dt>
              <Icon name="key" size={16} />
              Session key
            </dt>
            <dd>{sessionKey}</dd>
          </div>
        ) : null}
      </dl>
      {meter ? <div className={styles.meter}>{meter}</div> : null}
      <div className={styles.allow}>
        <p className={styles.allowTitle}>
          <Icon name="list" size={16} />
          Allow-list
          <span className={styles.count}>{allowList.length}</span>
        </p>
        {allowList.length === 0 ? (
          <p className={styles.allowEmpty}>
            Empty. This agent can pay nothing until you add a service.
          </p>
        ) : (
          <ul className={styles.allowList}>
            {allowList.map((entry) => (
              <li key={`${entry.resource}-${entry.recipient}`}>
                <span className={styles.resource}>{entry.resource}</span>
                <span className={styles.recipient}>
                  <Icon name="arrowRight" size={14} />
                  {entry.recipient}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
