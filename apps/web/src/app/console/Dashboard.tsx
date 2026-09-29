"use client";

import Link from "next/link";
import { useState } from "react";
import { Icon } from "@/components/Icon";
import { InlineStatus } from "@/components/InlineStatus";
import { ReceiptList } from "@/components/ReceiptList";
import { SpendMeter } from "@/components/SpendMeter";
import { StatGrid, StatTile } from "@/components/StatTile";
import { StatusPill } from "@/components/StatusPill";
import { query } from "@/lib/console/api";
import { useConsoleSession } from "@/lib/console/context";
import type { AgentSummary, FailureDto, Range, SpendSeries, Summary } from "@/lib/console/types";
import { useResource } from "@/lib/console/useResource";
import { shortAddress } from "@/lib/format";
import { AgentStatusPill } from "./_components/AgentStatus";
import styles from "./_components/console.module.css";
import { agentName, amountText, dateTimeText } from "./_components/format";
import {
  ConsoleSection,
  EmptyState,
  FirstAgentAction,
  LoadError,
  PageHeader,
  Skeleton,
  SkeletonRows,
} from "./_components/Page";
import { RangeSwitch, rangeLong } from "./_components/RangeSwitch";
import { toReceiptView } from "./_components/receipts";
import { SpendChart } from "./_components/SpendChart";
import dash from "./dashboard.module.css";

function FailureRow({ failure, agents }: { failure: FailureDto; agents: AgentSummary[] }) {
  const agent = agents.find((a) => a.address === failure.agentWallet);
  return (
    <li className={dash.failure}>
      <div className={dash.failureHead}>
        <StatusPill tone="critical">Settlement failed</StatusPill>
        <span className={styles.faint}>
          {failure.attempts} {failure.attempts === 1 ? "attempt" : "attempts"}, last{" "}
          {dateTimeText(failure.updatedAt)}
        </span>
      </div>
      <p className={dash.failureText}>{failure.error}</p>
      <p className={styles.faint}>
        {agent ? agentName(agent) : shortAddress(failure.agentWallet)}
        {failure.resource ? ` paying ${failure.resource}` : ""}
        {failure.displayAmount ? `, ${amountText(failure.displayAmount)}` : ""}. The facilitator
        keeps it for replay, so no funds moved.
      </p>
    </li>
  );
}

export function Dashboard() {
  const { deployment } = useConsoleSession();
  const asset = deployment.mintSymbol;
  const [range, setRange] = useState<Range>("7d");
  const summary = useResource<Summary>(`/v1/summary${query({ range })}`);
  const spend = useResource<SpendSeries>(`/v1/spend${query({ range })}`);
  const agents = useResource<{ agents: AgentSummary[] }>("/v1/agents");

  const agentList = agents.data?.agents ?? [];
  const noAgents = agents.data !== undefined && agentList.length === 0;
  const attention = agentList.filter((a) => a.attention.length > 0);
  const nearCap = agentList.filter((a) => a.status === "near_cap" || a.status === "at_cap");
  const failures = summary.data?.failures;
  const needs = (failures?.pendingCount ?? 0) + attention.length;

  return (
    <>
      <PageHeader
        title="Dashboard"
        lead="What your agents spent, what settled and what needs you. Every figure comes from the chain and its receipts."
        actions={<RangeSwitch value={range} onChange={setRange} />}
      />

      <div className={styles.stack}>
        {summary.data?.notices?.map((notice) => (
          <InlineStatus key={notice} tone="caution" title="Partial data">
            {notice}
          </InlineStatus>
        ))}

        {summary.error ? (
          <LoadError what="The summary" error={summary.error} onRetry={summary.reload} />
        ) : (
          <StatGrid label={`Totals, ${rangeLong(range).toLowerCase()}`}>
            <StatTile
              label="Total spend"
              icon="coins"
              value={summary.data ? amountText(summary.data.totalSpend.displayAmount) : ""}
              unit={asset}
              detail={rangeLong(range)}
              loading={summary.loading}
            />
            <StatTile
              label="Settlements"
              icon="receipt"
              value={summary.data ? String(summary.data.settlementCount) : ""}
              detail="Paid requests with a receipt"
              loading={summary.loading}
            />
            <StatTile
              label="Active agents"
              icon="agent"
              value={summary.data ? String(summary.data.activeAgents) : ""}
              detail={
                agents.data
                  ? `Paid at least once, of ${agentList.length} ${agentList.length === 1 ? "wallet" : "wallets"}`
                  : "Paid at least once"
              }
              loading={summary.loading}
            />
            <StatTile
              label="Needs attention"
              icon="alert"
              value={summary.data && agents.data ? String(needs) : ""}
              tone={needs > 0 ? "critical" : "positive"}
              detail={
                needs > 0
                  ? `${failures?.pendingCount ?? 0} failed settlements, ${attention.length} agents`
                  : "Nothing is waiting on you"
              }
              loading={summary.loading || agents.loading}
            />
          </StatGrid>
        )}

        {failures && failures.pendingCount > 0 ? (
          <ConsoleSection
            id="failures"
            title="Failed settlements"
            note="These payments did not settle. The facilitator holds them for replay. Check the reason and the agent's funds."
          >
            <ul className={dash.failures}>
              {failures.items.map((f) => (
                <FailureRow key={f.id} failure={f} agents={agentList} />
              ))}
            </ul>
          </ConsoleSection>
        ) : null}

        {noAgents ? (
          <EmptyState icon="agent" title="No agents yet" action={<FirstAgentAction />}>
            Spend over time, recent receipts and agents near their cap appear here once an agent
            wallet exists and starts paying. Create one, fund it and set its limits in a few steps.
          </EmptyState>
        ) : null}

        <ConsoleSection
          id="spend"
          title="Spend over time"
          note={
            spend.data
              ? `${amountText(spend.data.totals.displayAmount)} ${asset} across ${spend.data.totals.count} settlements, per ${spend.data.bucket} in UTC`
              : `${rangeLong(range)}, in UTC`
          }
        >
          <div className={styles.panel}>
            {spend.error ? (
              <LoadError what="Spend over time" error={spend.error} onRetry={spend.reload} />
            ) : spend.data ? (
              <SpendChart series={spend.data} asset={asset} refreshing={spend.refreshing} />
            ) : (
              <Skeleton height="calc(232px + 2rem)" />
            )}
          </div>
        </ConsoleSection>

        <div className={styles.twoCol}>
          <ConsoleSection
            id="recent"
            title="Recent receipts"
            action={
              <Link href="/console/receipts" className={styles.textLink}>
                All receipts
                <Icon name="arrowRight" size={14} />
              </Link>
            }
          >
            {summary.error ? null : summary.data ? (
              <ReceiptList
                label="Recent receipts"
                receipts={summary.data.recentReceipts.map((r) => toReceiptView(r, asset))}
                empty={
                  <p>
                    No receipts yet. Each paid request your agents make lands here with its amount
                    and a link to the chain.
                  </p>
                }
              />
            ) : (
              <SkeletonRows rows={5} height="4.25rem" />
            )}
          </ConsoleSection>

          <ConsoleSection
            id="caps"
            title="Agents near their cap"
            note="Rolling 24 hour spend against each daily cap"
            action={
              <Link href="/console/agents" className={styles.textLink}>
                All agents
                <Icon name="arrowRight" size={14} />
              </Link>
            }
          >
            {agents.error ? (
              <LoadError what="Agents" error={agents.error} onRetry={agents.reload} />
            ) : agents.data ? (
              nearCap.length === 0 ? (
                <EmptyState
                  icon="gauge"
                  title={noAgents ? "No agents to watch yet" : "Every agent is inside its cap"}
                  action={noAgents ? <FirstAgentAction /> : undefined}
                >
                  {noAgents
                    ? "Agents that pass 80 percent of their daily cap show here with a meter."
                    : "An agent shows here once it passes 80 percent of its daily cap."}
                </EmptyState>
              ) : (
                <ul className={dash.caps}>
                  {nearCap.map((a) => (
                    <li key={a.address} className={styles.panel}>
                      <div className={dash.capHead}>
                        <Link href={`/console/agents/${a.address}`} className={dash.agentLink}>
                          {agentName(a)}
                        </Link>
                        <AgentStatusPill status={a.status} />
                      </div>
                      <SpendMeter
                        label="Daily cap, rolling 24 hours"
                        spent={BigInt(a.rollingSpend.amount)}
                        cap={BigInt(a.dailyCap.amount)}
                        decimals={deployment.mintDecimals}
                        asset={asset}
                        size="sm"
                      />
                    </li>
                  ))}
                </ul>
              )
            ) : (
              <SkeletonRows rows={2} height="6rem" />
            )}
          </ConsoleSection>
        </div>

        {agents.data && attention.some((a) => a.status !== "near_cap" && a.status !== "at_cap") ? (
          <ConsoleSection id="setup" title="Agents that cannot pay yet">
            <ul className={dash.caps}>
              {attention
                .filter((a) => a.status !== "near_cap" && a.status !== "at_cap")
                .map((a) => (
                  <li key={a.address} className={dash.setupRow}>
                    <Link href={`/console/agents/${a.address}`} className={dash.agentLink}>
                      {agentName(a)}
                    </Link>
                    <AgentStatusPill status={a.status} />
                  </li>
                ))}
            </ul>
          </ConsoleSection>
        ) : null}
      </div>
    </>
  );
}
