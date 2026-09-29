"use client";

import { type FormEvent, useEffect, useState } from "react";
import { Button, ButtonLink } from "@/components/Button";
import { useToast } from "@/components/Toast";
import { useConsoleSession } from "@/lib/console/context";
import type { AgentDetail } from "@/lib/console/types";
import { useChainAction } from "@/lib/console/useChainAction";
import { useResource } from "@/lib/console/useResource";
import { ChainStatus } from "../../../_components/ChainStatus";
import styles from "../../../_components/console.module.css";
import { agentName } from "../../../_components/format";
import { LoadError, PageHeader, Skeleton } from "../../../_components/Page";
import {
  newAllowRow,
  type PolicyDraft,
  PolicyFields,
  validatePolicy,
} from "../../../_components/PolicyFields";
import editor from "./policy.module.css";

function draftFrom(agent: AgentDetail): PolicyDraft {
  return {
    perCallCap: agent.perCallCap.displayAmount,
    dailyCap: agent.dailyCap.displayAmount,
    allowList: agent.allowList.map((e) => newAllowRow(e.resource ?? e.resourceId, e.recipient)),
  };
}

function sameDraft(a: PolicyDraft, b: PolicyDraft): boolean {
  const rows = (d: PolicyDraft) =>
    d.allowList.map((r) => `${r.resource.trim()} ${r.recipient.trim()}`).join("\n");
  return (
    a.perCallCap.trim() === b.perCallCap.trim() &&
    a.dailyCap.trim() === b.dailyCap.trim() &&
    rows(a) === rows(b)
  );
}

export function PolicyEditor({ address }: { address: string }) {
  const { deployment } = useConsoleSession();
  const toast = useToast();
  const chain = useChainAction();
  const agent = useResource<{ agent: AgentDetail }>(`/v1/agents/${address}`);
  const [draft, setDraft] = useState<PolicyDraft | null>(null);
  const [saved, setSaved] = useState<PolicyDraft | null>(null);
  const [tried, setTried] = useState(false);
  const a = agent.data?.agent;

  useEffect(() => {
    if (!a) return;
    const fresh = draftFrom(a);
    setSaved(fresh);
    setDraft((current) => current ?? fresh);
  }, [a]);

  const back = { href: `/console/agents/${address}`, label: a ? agentName(a) : "Agent" };

  if (agent.error) {
    return (
      <>
        <PageHeader title="Edit policy" back={back} />
        <LoadError what="This agent" error={agent.error} onRetry={agent.reload} />
      </>
    );
  }

  if (!a || !draft) {
    return (
      <>
        <PageHeader title="Edit policy" back={back} lead="Loading the policy from the chain." />
        <div aria-busy="true" style={{ display: "grid", gap: "var(--space-4)" }}>
          <span className="visually-hidden">Loading the policy</span>
          <Skeleton height="6rem" />
          <Skeleton height="14rem" />
        </div>
      </>
    );
  }

  const check = validatePolicy(draft, deployment.mintDecimals);
  const unchanged = saved !== null && sameDraft(draft, saved);

  async function save(event: FormEvent) {
    event.preventDefault();
    setTried(true);
    if (!check.body || unchanged) return;
    const built = await chain.run("/v1/tx/update-policy", {
      agentWallet: address,
      ...check.body,
    });
    if (built) {
      toast.show({ tone: "positive", title: "Policy saved" });
      setSaved(draft);
      setTried(false);
      agent.reload();
    }
  }

  return (
    <>
      <PageHeader
        title="Edit policy"
        back={back}
        lead={`Caps and allow-list for ${agentName(a)}. Saving replaces the whole policy on chain in one transaction.`}
      />
      <form onSubmit={save} noValidate className={editor.form}>
        <div className={styles.panel}>
          <PolicyFields
            draft={draft}
            onChange={(next) => {
              setDraft(next);
              if (chain.state.phase === "confirmed" || chain.state.phase === "failed")
                chain.reset();
            }}
            errors={check.errors}
            showErrors={tried}
            asset={deployment.mintSymbol}
            disabled={chain.pending}
          />
        </div>
        <div className={editor.bar}>
          <ChainStatus state={chain.state} done="Policy saved" failed="Policy not saved" />
          {tried && !check.body ? (
            <p className={editor.hint} role="alert">
              Fix the fields marked above, then save again.
            </p>
          ) : null}
          <div className={editor.actions}>
            <Button
              type="submit"
              loading={chain.pending}
              loadingLabel="Saving policy"
              disabled={unchanged && !chain.pending}
            >
              Save policy
            </Button>
            <Button
              variant="secondary"
              disabled={chain.pending || unchanged}
              onClick={() => {
                setDraft(saved);
                setTried(false);
                chain.reset();
              }}
            >
              Discard changes
            </Button>
            <ButtonLink href={back.href} variant="quiet">
              Back to agent
            </ButtonLink>
            {unchanged && chain.state.phase === "idle" ? (
              <span className={editor.hint}>No changes yet.</span>
            ) : null}
          </div>
        </div>
      </form>
    </>
  );
}
