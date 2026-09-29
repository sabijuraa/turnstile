"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { type FormEvent, useEffect, useMemo, useState } from "react";
import { Button, buttonClassName } from "@/components/Button";
import { Field, Input } from "@/components/Field";
import { Icon } from "@/components/Icon";
import { ReceiptStatusPill } from "@/components/Receipt";
import { Table, type TableColumn } from "@/components/Table";
import { api, BACKEND_BASE, errorMessage, isUnauthenticated, query } from "@/lib/console/api";
import { useConsoleSession } from "@/lib/console/context";
import type { AgentSummary, ReceiptDto, ReceiptPage } from "@/lib/console/types";
import { redirectToSignIn, useResource } from "@/lib/console/useResource";
import { shortAddress } from "@/lib/format";
import type { SortState } from "@/lib/sort";
import styles from "../_components/console.module.css";
import { agentName, amountText, dateTimeText } from "../_components/format";
import {
  EmptyState,
  FirstAgentAction,
  LoadError,
  PageHeader,
  SkeletonRows,
} from "../_components/Page";
import ledger from "./receipts.module.css";

type Sort = "newest" | "oldest" | "amount_desc" | "amount_asc";

interface Filters {
  agent: string;
  resource: string;
  from: string;
  to: string;
  search: string;
  sort: Sort;
}

const SORTS: Sort[] = ["newest", "oldest", "amount_desc", "amount_asc"];

function readFilters(params: URLSearchParams): Filters {
  const sort = params.get("sort") as Sort | null;
  return {
    agent: params.get("agent") ?? "",
    resource: params.get("resource") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
    search: params.get("search") ?? "",
    sort: sort && SORTS.includes(sort) ? sort : "newest",
  };
}

/** The day after a yyyy-mm-dd date, so the chosen end day is included. */
function dayAfter(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function backendQuery(f: Filters, extra: Record<string, string | number | undefined> = {}) {
  return query({
    agent: f.agent || undefined,
    resource: f.resource.trim() || undefined,
    from: f.from || undefined,
    to: f.to ? dayAfter(f.to) : undefined,
    search: f.search.trim() || undefined,
    sort: f.sort,
    ...extra,
  });
}

function tableSort(sort: Sort): SortState {
  if (sort === "newest") return { key: "time", direction: "descending" };
  if (sort === "oldest") return { key: "time", direction: "ascending" };
  if (sort === "amount_desc") return { key: "amount", direction: "descending" };
  return { key: "amount", direction: "ascending" };
}

function fromTableSort(s: SortState): Sort {
  if (s.key === "amount") return s.direction === "descending" ? "amount_desc" : "amount_asc";
  return s.direction === "descending" ? "newest" : "oldest";
}

const PAGE = 50;

export function Receipts() {
  const { deployment } = useConsoleSession();
  const asset = deployment.mintSymbol;
  const router = useRouter();
  const pathname = usePathname();
  const params = useSearchParams();
  const applied = useMemo(() => readFilters(new URLSearchParams(params.toString())), [params]);
  const [draft, setDraft] = useState<Filters>(applied);
  const agents = useResource<{ agents: AgentSummary[] }>("/v1/agents");
  const first = useResource<ReceiptPage>(`/v1/receipts${backendQuery(applied, { limit: PAGE })}`);
  const [more, setMore] = useState<ReceiptDto[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [moreError, setMoreError] = useState<string | null>(null);

  useEffect(() => setDraft(applied), [applied]);

  useEffect(() => {
    setMore([]);
    setMoreError(null);
    setCursor(first.data?.nextCursor ?? null);
  }, [first.data]);

  function apply(next: Filters) {
    const q = query({
      agent: next.agent || undefined,
      resource: next.resource.trim() || undefined,
      from: next.from || undefined,
      to: next.to || undefined,
      search: next.search.trim() || undefined,
      sort: next.sort === "newest" ? undefined : next.sort,
    });
    router.replace(`${pathname}${q}`, { scroll: false });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    apply(draft);
  }

  async function loadMore() {
    if (!cursor) return;
    setLoadingMore(true);
    setMoreError(null);
    try {
      const page = await api<ReceiptPage>(
        `/v1/receipts${backendQuery(applied, { limit: PAGE, cursor })}`,
      );
      setMore((m) => [...m, ...page.receipts]);
      setCursor(page.nextCursor);
    } catch (error) {
      if (isUnauthenticated(error)) redirectToSignIn();
      setMoreError(errorMessage(error));
    } finally {
      setLoadingMore(false);
    }
  }

  const receipts = first.data ? [...first.data.receipts, ...more] : [];
  const filtered =
    applied.agent || applied.resource || applied.from || applied.to || applied.search;
  const dateError =
    draft.from && draft.to && draft.from > draft.to
      ? "The start date is after the end date. Swap them."
      : undefined;
  const noAgents = agents.data?.agents.length === 0;

  const columns: TableColumn[] = [
    { key: "time", label: "Settled, UTC", sortable: true, width: "12rem" },
    { key: "agent", label: "Agent" },
    { key: "resource", label: "Resource" },
    { key: "amount", label: `Amount, ${asset}`, numeric: true, sortable: true },
    { key: "status", label: "State" },
    { key: "link", label: "Receipt" },
  ];

  const rows = receipts.map((r) => ({
    id: r.receiptAddress,
    cells: {
      time: {
        value: r.blockTime,
        display: (
          <span className={ledger.nowrap}>{dateTimeText(r.blockTime).replace(" UTC", "")}</span>
        ),
      },
      agent: {
        value: r.agentLabel ?? r.agentWallet,
        display: (
          <span className={ledger.agent}>
            <span>{r.agentLabel ?? "Unnamed agent"}</span>
            <span className={ledger.sub}>{shortAddress(r.agentWallet)}</span>
          </span>
        ),
      },
      resource: {
        value: r.resource ?? r.resourceId,
        display: (
          <span className={ledger.resource}>
            {r.resource ?? `id ${shortAddress(r.resourceId, 8, 8)}`}
          </span>
        ),
      },
      amount: { value: BigInt(r.amount), display: amountText(r.displayAmount) },
      status: { value: r.status, display: <ReceiptStatusPill status={r.status} /> },
      link: {
        value: r.signature,
        display: (
          <a href={r.explorerUrl} target="_blank" rel="noreferrer" className={ledger.link}>
            <span className={ledger.mono}>{shortAddress(r.signature, 4, 4)}</span>
            <Icon name="external" size={14} />
            <span className="visually-hidden">
              View settlement transaction on Solana Explorer (opens in a new tab)
            </span>
          </a>
        ),
      },
    },
  }));

  return (
    <>
      <PageHeader
        title="Receipts"
        lead="Every paid request your agents made, read from the chain. Filter it, sort it and export it as a statement."
        actions={
          <a
            href={`${BACKEND_BASE}/v1/receipts.csv${backendQuery(applied)}`}
            download
            className={buttonClassName("secondary", "md")}
          >
            <span className={ledger.buttonContent}>
              <Icon name="download" size={18} />
              <span>Export CSV</span>
            </span>
          </a>
        }
      />

      <form className={ledger.filters} onSubmit={submit} aria-label="Filter receipts">
        <div className={ledger.search}>
          <Field
            label="Search"
            help="Start of a signature, address or nonce. Any part of a route or agent name."
          >
            <Input
              type="search"
              value={draft.search}
              placeholder="Search receipts"
              onChange={(e) => setDraft({ ...draft, search: e.target.value })}
            />
          </Field>
        </div>
        <Field label="Agent">
          <select
            className={ledger.select}
            value={draft.agent}
            onChange={(e) => setDraft({ ...draft, agent: e.target.value })}
          >
            <option value="">All agents</option>
            {agents.data?.agents.map((a) => (
              <option key={a.address} value={a.address}>
                {agentName(a)} ({shortAddress(a.address)})
              </option>
            ))}
            {draft.agent &&
            agents.data &&
            !agents.data.agents.some((a) => a.address === draft.agent) ? (
              <option value={draft.agent}>{shortAddress(draft.agent)}</option>
            ) : null}
          </select>
        </Field>
        <Field label="Resource" hint="URL or id">
          <Input
            mono
            value={draft.resource}
            placeholder="https://api.example.com/v1/route"
            onChange={(e) => setDraft({ ...draft, resource: e.target.value })}
          />
        </Field>
        <Field label="From" hint="UTC">
          <Input
            type="date"
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </Field>
        <Field label="To" hint="UTC, included" error={dateError}>
          <Input
            type="date"
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </Field>
        <div className={ledger.filterActions}>
          <Button type="submit" size="sm" leadingIcon="search" disabled={Boolean(dateError)}>
            Apply filters
          </Button>
          {filtered ? (
            <Button
              variant="quiet"
              size="sm"
              onClick={() =>
                apply({ agent: "", resource: "", from: "", to: "", search: "", sort: applied.sort })
              }
            >
              Clear filters
            </Button>
          ) : null}
        </div>
      </form>

      <div className={styles.section}>
        {first.error ? (
          <LoadError what="Receipts" error={first.error} onRetry={first.reload} />
        ) : !first.data ? (
          <SkeletonRows rows={8} height="3rem" />
        ) : receipts.length === 0 && !filtered ? (
          <EmptyState
            icon="receipt"
            title="No receipts yet"
            action={noAgents ? <FirstAgentAction /> : undefined}
          >
            Each paid request lands here once it settles, with the amount, the route, the agent and
            a link to the transaction.{" "}
            {noAgents
              ? "Create an agent and let it pay to see the first one."
              : "They appear as soon as your agents pay."}
          </EmptyState>
        ) : (
          <div className={first.refreshing ? styles.refreshing : undefined}>
            <Table
              caption="Receipts"
              columns={columns}
              rows={rows}
              sort={tableSort(applied.sort)}
              onSortChange={(s) => apply({ ...applied, sort: fromTableSort(s) })}
              empty={
                <span>
                  No receipts match these filters. Widen the dates or{" "}
                  <button
                    type="button"
                    className={ledger.inlineButton}
                    onClick={() =>
                      apply({
                        agent: "",
                        resource: "",
                        from: "",
                        to: "",
                        search: "",
                        sort: applied.sort,
                      })
                    }
                  >
                    clear the filters
                  </button>
                  .
                </span>
              }
            />
          </div>
        )}
        {first.data && receipts.length > 0 ? (
          <div className={ledger.footer}>
            <p className={styles.faint} aria-live="polite">
              Showing {receipts.length} {receipts.length === 1 ? "receipt" : "receipts"}
              {cursor ? "" : ", the full list"}.
            </p>
            {cursor ? (
              <Button
                variant="secondary"
                size="sm"
                onClick={loadMore}
                loading={loadingMore}
                loadingLabel="Loading more receipts"
              >
                Load more receipts
              </Button>
            ) : null}
            {moreError ? (
              <p className={ledger.error} role="alert">
                {moreError}
              </p>
            ) : null}
          </div>
        ) : null}
      </div>
    </>
  );
}
