"use client";

import Link from "next/link";
import { ButtonLink } from "@/components/Button";
import { SpendMeter } from "@/components/SpendMeter";
import { useConsoleSession } from "@/lib/console/context";
import type { AgentSummary } from "@/lib/console/types";
import { useResource } from "@/lib/console/useResource";
import { shortAddress } from "@/lib/format";
import { AgentStatusPill } from "../_components/AgentStatus";
import styles from "../_components/console.module.css";
import { agentName, amountText } from "../_components/format";
import {
  EmptyState,
  FirstAgentAction,
  LoadError,
  PageHeader,
  SkeletonRows,
} from "../_components/Page";
import list from "./agents.module.css";

function AgentRow({
  agent,
  asset,
  decimals,
}: {
  agent: AgentSummary;
  asset: string;
  decimals: number;
}) {
  return (
    <li className={list.row}>
      <div className={list.who}>
        <Link href={`/console/agents/${agent.address}`} className={list.name}>
          {agentName(agent)}
        </Link>
        <span className={list.address} title={agent.address}>
          {shortAddress(agent.address, 6, 6)}
        </span>
      </div>
      <div className={list.status}>
        <AgentStatusPill status={agent.status} />
      </div>
      <dl className={list.figures}>
        <div>
          <dt>Balance</dt>
          <dd>
            {amountText(agent.vaultBalance.displayAmount)}{" "}
            <span className={list.unit}>{asset}</span>
          </dd>
        </div>
        <div>
          <dt>Per call</dt>
          <dd>
            {amountText(agent.perCallCap.displayAmount)} <span className={list.unit}>{asset}</span>
          </dd>
        </div>
      </dl>
      <div className={list.meter}>
        <SpendMeter
          label="Last 24 hours"
          spent={BigInt(agent.rollingSpend.amount)}
          cap={BigInt(agent.dailyCap.amount)}
          decimals={decimals}
          asset={asset}
          size="sm"
        />
      </div>
    </li>
  );
}

export function AgentsList() {
  const { deployment } = useConsoleSession();
  const agents = useResource<{ agents: AgentSummary[] }>("/v1/agents");
  const data = agents.data?.agents;

  return (
    <>
      <PageHeader
        title="Agents"
        lead="Each agent has its own wallet, session key and spending policy on chain."
        actions={
          <ButtonLink href="/console/agents/new" leadingIcon="agent">
            Create agent
          </ButtonLink>
        }
      />
      {agents.error ? (
        <LoadError what="Agents" error={agents.error} onRetry={agents.reload} />
      ) : !data ? (
        <SkeletonRows rows={3} height="5.5rem" />
      ) : data.length === 0 ? (
        <EmptyState icon="agent" title="No agents yet" action={<FirstAgentAction />}>
          Your agent wallets appear here with their balance, their spend against the daily cap and
          whether they can pay. Create the first one to fund it and set its limits.
        </EmptyState>
      ) : (
        <>
          <p className={`${styles.faint} ${list.count}`}>
            {data.length} {data.length === 1 ? "agent" : "agents"}. Meters show the rolling 24 hour
            spend the chain checks against each daily cap.
          </p>
          <ul className={list.list} aria-label="Agents">
            {data.map((a) => (
              <AgentRow
                key={a.address}
                agent={a}
                asset={deployment.mintSymbol}
                decimals={deployment.mintDecimals}
              />
            ))}
          </ul>
        </>
      )}
    </>
  );
}
