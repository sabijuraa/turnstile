import { Icon } from "@/components/Icon";
import { InlineStatus } from "@/components/InlineStatus";
import { StatusPill } from "@/components/StatusPill";
import { shortAddress } from "@/lib/format";
import type { DemoPolicyView } from "../_lib/events";
import { explorerLink } from "../_lib/explorer";
import type { DemoNetwork } from "../_lib/network";
import {
  DEMO_ASSET,
  DEMO_METHOD,
  DEMO_PATH,
  errorLogLine,
  percentOf,
  type RunView,
} from "../_lib/view";
import styles from "./demo.module.css";

interface CallDetailProps {
  view: RunView;
  mode: "idle" | "starting" | "running" | "watching";
  policy: DemoPolicyView | null;
  network: DemoNetwork;
  settleable: number | null;
}

function ExternalLink({ href, children }: { href: string; children: string }) {
  return (
    <a className={styles.link} href={href} target="_blank" rel="noreferrer">
      {children}
      <Icon name="arrowUpRight" size={14} />
      <span className="visually-hidden">(opens in a new tab)</span>
    </a>
  );
}

/**
 * The panel beside the gate. It shows the work each paid call bought, and when the chain says no,
 * it becomes the refusal. It fills a fixed slot so nothing below it moves.
 */
export function CallDetail({ view, mode, policy, network, settleable }: CallDetailProps) {
  const { refusal, lastCall, started, failed } = view;

  if (refusal) {
    const capCase = refusal.reason === "DailyCapExceeded";
    const log = errorLogLine(refusal.programLogs);
    return (
      <article className={`${styles.card} ${styles.refusal}`} aria-labelledby="refusal-title">
        <div className={styles.cardHead}>
          <StatusPill tone="critical" icon="close">
            Refused on chain
          </StatusPill>
          <span className={styles.cardMeta}>Call {refusal.index}</span>
        </div>
        <h3 id="refusal-title" className={styles.cardTitle}>
          {capCase ? "The daily cap held." : "The policy held."}
        </h3>
        <p className={styles.cardText}>
          {capCase
            ? `Call ${refusal.index} asked for ${refusal.amount.display} ${DEMO_ASSET}. The agent had already spent ${refusal.rollingSpend.display} of its ${refusal.dailyCap.display} ${DEMO_ASSET} daily cap, so the agent wallet program refused the payment. No funds moved.`
            : refusal.message}
        </p>
        <p className={styles.cardNote}>
          The facilitator turned the payment down first. To prove the limit lives on chain, the
          agent then sent the same signed payment straight to the settlement program. The program
          refused it too.
        </p>
        <div className={styles.errorBox}>
          <code className={styles.errorName}>{refusal.reason}</code>
          {log ? <code className={styles.errorLog}>{log}</code> : null}
        </div>
        <ExternalLink href={explorerLink(network.explorerTx, refusal.failedTransaction)}>
          View the refused transaction
        </ExternalLink>
      </article>
    );
  }

  if (failed) {
    return (
      <div className={styles.card}>
        <InlineStatus tone="critical" title="The run stopped early">
          {failed.message}
        </InlineStatus>
      </div>
    );
  }

  if (lastCall?.type === "call.settled") {
    const call = lastCall.data;
    return (
      <article className={styles.card} aria-labelledby="call-title">
        <div className={styles.cardHead}>
          <StatusPill tone="settled">Call {call.index} settled</StatusPill>
          <span className={styles.cardMeta}>in {call.latencyMs} ms</span>
        </div>
        <p className={styles.cardKicker}>
          <span className={styles.method}>{DEMO_METHOD}</span>
          <span className={styles.mono}>{DEMO_PATH}</span> summarized
        </p>
        <h3 id="call-title" className={`${styles.cardTitle} ${styles.callTitle}`}>
          {call.passage.title}
        </h3>
        <p className={styles.cardByline}>
          {call.passage.author}, {call.passage.year}
        </p>
        <blockquote className={styles.excerpt}>
          <p>{call.summaryExcerpt}</p>
        </blockquote>
        <p className={styles.cardNote}>
          The API returned this summary at {percentOf(call.compressionRatio)} of the original length
          after the payment settled.
        </p>
        <ExternalLink href={explorerLink(network.explorerTx, call.transaction)}>
          View the payment transaction
        </ExternalLink>
      </article>
    );
  }

  if (started) {
    return (
      <article className={styles.card} aria-labelledby="wallet-title">
        <div className={styles.cardHead}>
          <StatusPill tone="positive" icon="wallet">
            Wallet ready
          </StatusPill>
        </div>
        <h3 id="wallet-title" className={styles.cardTitle}>
          A fresh agent wallet
        </h3>
        <p className={styles.cardText}>
          Agent wallet {shortAddress(started.agentWallet)} holds {started.policy.funding.display}{" "}
          {DEMO_ASSET} and one session key. Its limits are set on chain before the first call.
        </p>
        <ExternalLink href={explorerLink(network.explorerTx, started.setupTransaction)}>
          View the setup transaction
        </ExternalLink>
      </article>
    );
  }

  if (mode === "running" || mode === "watching" || mode === "starting") {
    return (
      <div className={`${styles.card} ${styles.cardQuiet}`}>
        <InlineStatus tone="pending" title="Setting up">
          The agent is creating its wallet and funding it on chain.
        </InlineStatus>
      </div>
    );
  }

  return (
    <article className={`${styles.card} ${styles.cardQuiet}`} aria-labelledby="empty-title">
      <span className={styles.emptyIcon} aria-hidden="true">
        <Icon name="agent" size={22} />
      </span>
      <h3 id="empty-title" className={styles.cardTitle}>
        Nothing has run yet
      </h3>
      <p className={styles.cardText}>
        {policy && settleable !== null
          ? `Press Run the agent. A fresh agent wallet gets ${policy.funding.display} ${DEMO_ASSET} and pays ${policy.pricePerCall.display} for each summary. Call ${settleable + 1} would pass the ${policy.dailyCap.display} daily cap, and you will watch the chain refuse it.`
          : "Press Run the agent. A fresh agent wallet pays for each summary until its daily cap refuses the next call."}
      </p>
    </article>
  );
}
