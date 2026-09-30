"use client";

import { type CSSProperties, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/Button";
import { Gate } from "@/components/Gate";
import { InlineStatus } from "@/components/InlineStatus";
import { ReceiptList } from "@/components/ReceiptList";
import { SpendMeter } from "@/components/SpendMeter";
import { formatTimestamp } from "@/lib/format";
import {
  type DemoPolicyView,
  isCallEvent,
  isTerminal,
  parseApiError,
  parseRunEvent,
  parseSnapshot,
  RUN_EVENT_TYPES,
  type RunEvent,
  type RunSnapshot,
} from "../_lib/events";
import type { DemoNetwork } from "../_lib/network";
import {
  DEMO_ASSET,
  expectedSettled,
  gateOf,
  receiptIdOf,
  receiptsOf,
  units,
  viewOf,
} from "../_lib/view";
import { CallDetail } from "./CallDetail";
import styles from "./demo.module.css";
import { OnChain } from "./OnChain";
import { PolicySide } from "./PolicySide";
import { CALL_DWELL_MS, usePlayback, usePrefersReducedMotion } from "./usePlayback";

export interface DemoRunProps {
  network: DemoNetwork;
  policy: DemoPolicyView | null;
  initial: RunSnapshot | null;
  /** True when the runner did not answer while the page rendered. */
  offline: boolean;
  settlementProgram: { address: string; url: string };
}

type Mode = "idle" | "starting" | "running" | "watching";

type Notice =
  | { kind: "busy"; runId: string | null }
  | { kind: "error"; title: string; message: string }
  | { kind: "reconnecting" };

interface Stream {
  runId: string;
  after: number;
}

const API = "/demo/api";

function lastSeq(events: readonly RunEvent[]): number {
  return events.at(-1)?.seq ?? 0;
}

async function readBody(res: Response): Promise<unknown> {
  try {
    return await res.json();
  } catch {
    // A body that is not JSON carries nothing the page can use. The status code decides.
    return null;
  }
}

export function DemoRun({ network, policy, initial, offline, settlementProgram }: DemoRunProps) {
  const reduced = usePrefersReducedMotion();
  const [events, setEvents] = useState<RunEvent[]>(() => initial?.events ?? []);
  const [instantUntil, setInstantUntil] = useState(() => lastSeq(initial?.events ?? []));
  const [mode, setMode] = useState<Mode>(() =>
    initial?.run.status === "running" ? "watching" : "idle",
  );
  const [stream, setStream] = useState<Stream | null>(() =>
    initial?.run.status === "running"
      ? { runId: initial.run.id, after: lastSeq(initial.events) }
      : null,
  );
  const [notice, setNotice] = useState<Notice | null>(() =>
    offline
      ? {
          kind: "error",
          title: "The demo agent is offline",
          message: "Runs cannot start right now. Try again in a few minutes.",
        }
      : null,
  );
  const [announcement, setAnnouncement] = useState("");
  const statusRef = useRef<HTMLDivElement>(null);
  const actionRef = useRef<HTMLDivElement>(null);
  // Set when the status held focus as the run ended, so focus moves on to the button.
  const focusButton = useRef(false);
  // Set when the visitor starts a run, so focus follows the button into the status that replaces it.
  const focusStatus = useRef(false);

  useEffect(() => {
    if (mode === "running" && focusStatus.current) {
      focusStatus.current = false;
      statusRef.current?.focus();
    }
    if (mode === "idle" && focusButton.current) {
      focusButton.current = false;
      actionRef.current?.querySelector("button")?.focus();
    }
  }, [mode]);
  const runIdRef = useRef<string | null>(initial?.run.id ?? null);

  const { revealed, committed } = usePlayback(events, instantUntil, reduced);
  const shown = useMemo(() => events.slice(0, committed), [events, committed]);
  const view = useMemo(() => viewOf(shown), [shown]);
  const activePolicy = view.started?.policy ?? policy;
  const explorer = network;
  const receipts = useMemo(() => receiptsOf(view, explorer), [view, explorer]);

  // The call on the gate is the newest revealed call, which can be ahead of the list by one.
  const gateCall = useMemo(() => {
    for (let i = revealed - 1; i >= 0; i -= 1) {
      const event = events[i];
      if (event && isCallEvent(event)) return event;
    }
    return null;
  }, [events, revealed]);
  const gateLive = gateCall !== null && gateCall.seq > instantUntil && !reduced;
  const gate = gateCall && activePolicy ? gateOf(gateCall, activePolicy.perCallCap) : null;

  const lastCommitted = shown.at(-1);
  const landing =
    lastCommitted && isCallEvent(lastCommitted) && lastCommitted.seq > instantUntil
      ? [receiptIdOf(lastCommitted)]
      : [];
  const done = lastCommitted ? isTerminal(lastCommitted) : false;
  const active = mode === "running" || mode === "watching";

  // A run is over for the page once its last event has played, not when it arrives.
  useEffect(() => {
    if (!done || !active) return;
    // Read focus while the status is still mounted. The effect on mode hands it to the button.
    focusButton.current = document.activeElement === statusRef.current;
    setMode("idle");
    const last = shown.at(-1);
    if (last?.type === "run.finished") {
      setAnnouncement(
        `Run finished. ${last.data.settledCalls} calls settled and ${last.data.refusedCalls} refused on chain.`,
      );
    } else if (last?.type === "run.failed") {
      setAnnouncement(`Run stopped. ${last.data.message}`);
    }
  }, [done, active, shown]);

  useEffect(() => {
    if (
      view.refusal &&
      lastCommitted?.type === "call.refused" &&
      lastCommitted.seq > instantUntil
    ) {
      setAnnouncement(
        `Call ${view.refusal.index} refused on chain with ${view.refusal.reason}. The limit held.`,
      );
    }
  }, [view.refusal, lastCommitted, instantUntil]);

  const append = useCallback((event: RunEvent) => {
    if (event.runId !== runIdRef.current) return;
    setEvents((prev) =>
      prev.some((e) => e.seq === event.seq) ? prev : [...prev, event].sort((a, b) => a.seq - b.seq),
    );
  }, []);

  // The live feed. EventSource reconnects on its own and resends Last-Event-ID, which the proxy
  // passes on, so nothing is missed or repeated.
  useEffect(() => {
    if (!stream) return;
    const source = new EventSource(
      `${API}/runs/${stream.runId}/events${stream.after > 0 ? `?after=${stream.after}` : ""}`,
    );
    const onEvent = (message: MessageEvent<string>) => {
      let raw: unknown;
      try {
        raw = JSON.parse(message.data);
      } catch (err) {
        console.error("The demo feed sent an event that is not JSON.", err);
        return;
      }
      const event = parseRunEvent(raw);
      if (!event) {
        console.error("The demo feed sent an event with an unexpected shape.", raw);
        return;
      }
      append(event);
      if (isTerminal(event)) {
        source.close();
        setStream(null);
      }
    };
    for (const type of RUN_EVENT_TYPES) source.addEventListener(type, onEvent);
    source.onopen = () => setNotice((n) => (n?.kind === "reconnecting" ? null : n));
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED) {
        setStream(null);
        setMode("idle");
        setNotice({
          kind: "error",
          title: "The live feed closed",
          message:
            "The page lost its connection to the demo agent. Reload the page to see how the run ended.",
        });
      } else {
        setNotice({ kind: "reconnecting" });
      }
    };
    return () => source.close();
  }, [stream, append]);

  const watch = useCallback(async (runId: string | null) => {
    setNotice(null);
    const res = await fetch(runId ? `${API}/runs/${runId}` : `${API}/runs/latest`, {
      cache: "no-store",
    }).catch(() => null);
    const snapshot = res?.ok ? parseSnapshot(await readBody(res)) : null;
    if (!snapshot) {
      setNotice({
        kind: "error",
        title: "Could not open that run",
        message: "The demo agent did not return the run. Try again in a moment.",
      });
      return;
    }
    runIdRef.current = snapshot.run.id;
    setInstantUntil(lastSeq(snapshot.events));
    setEvents(snapshot.events);
    if (snapshot.run.status === "running") {
      setMode("watching");
      setStream({ runId: snapshot.run.id, after: lastSeq(snapshot.events) });
      setAnnouncement("Watching another visitor's run.");
    } else {
      setMode("idle");
    }
  }, []);

  const start = useCallback(async () => {
    setNotice(null);
    setMode("starting");
    let res: Response;
    try {
      res = await fetch(`${API}/runs`, { method: "POST", cache: "no-store" });
    } catch (err) {
      console.error("POST /demo/api/runs failed.", err);
      setMode("idle");
      setNotice({
        kind: "error",
        title: "The run did not start",
        message: "The page could not reach the demo. Check your connection and try again.",
      });
      return;
    }
    const body = await readBody(res);
    if (res.status === 202 && body && typeof body === "object" && "runId" in body) {
      const runId = String((body as { runId: unknown }).runId);
      runIdRef.current = runId;
      setInstantUntil(0);
      setEvents([]);
      setMode("running");
      setStream({ runId, after: 0 });
      setAnnouncement("Run started. The agent is setting up a fresh wallet.");
      focusStatus.current = true;
      return;
    }
    setMode("idle");
    const error = parseApiError(body);
    if (res.status === 409) {
      setNotice({ kind: "busy", runId: error?.runId ?? null });
      return;
    }
    setNotice({
      kind: "error",
      title: "The run did not start",
      message: error?.message ?? `The demo answered ${res.status}. Try again in a minute.`,
    });
  }, []);

  const settleable = activePolicy ? expectedSettled(activePolicy) : null;
  const callCount = view.calls.length;
  const lastRunAt = view.finished || view.failed ? shown.at(-1)?.at : undefined;

  let line: string;
  if (mode === "starting") line = "Asking the demo agent to start a run.";
  else if (active && !view.started) line = "Creating a fresh agent wallet and funding it.";
  else if (active && callCount === 0) line = "Wallet funded. The first call is on its way.";
  else if (active) {
    const last = view.lastCall;
    line =
      last?.type === "call.refused"
        ? `Call ${last.data.index} refused on chain. Returning what is left to the owner.`
        : `Call ${callCount} settled. ${mode === "watching" ? "Watching another visitor's run." : "The agent keeps calling."}`;
  } else if (view.finished && lastRunAt) {
    line = `Last run ${formatTimestamp(lastRunAt)} UTC. ${view.finished.settledCalls} calls settled, ${view.finished.refusedCalls} refused on chain.`;
  } else if (view.failed && lastRunAt) {
    line = `Last run ${formatTimestamp(lastRunAt)} UTC stopped before the end.`;
  } else if (offline) line = "The demo agent is offline right now.";
  else line = "No run yet. Yours will be the first.";

  const meterDetail =
    activePolicy && settleable !== null
      ? `${activePolicy.pricePerCall.display} ${DEMO_ASSET} per call. ${settleable} calls fit under the cap.`
      : undefined;

  return (
    <div className={styles.layout}>
      <section className={styles.run} aria-labelledby="run-title">
        <div className={styles.runBar}>
          <div className={styles.runMeta}>
            <h2 id="run-title" className={styles.runTitle}>
              Agent run
            </h2>
            <p className={styles.runLine}>{line}</p>
          </div>
          <div ref={actionRef} className={styles.runAction}>
            {active ? (
              <div ref={statusRef} tabIndex={-1} className={styles.liveStatus} role="status">
                <span className={styles.liveDot} aria-hidden="true" />
                {mode === "watching" ? "Watching live" : "Agent running"}
              </div>
            ) : (
              <Button
                leadingIcon="play"
                loading={mode === "starting"}
                loadingLabel="Starting the agent"
                onClick={start}
              >
                Run the agent
              </Button>
            )}
          </div>
        </div>

        {notice ? (
          <div className={styles.notice}>
            {notice.kind === "busy" ? (
              <InlineStatus
                tone="caution"
                title="Another visitor's run is in progress"
                action={
                  <Button
                    variant="secondary"
                    size="sm"
                    icon="arrowRight"
                    onClick={() => void watch(notice.runId)}
                  >
                    Watch that run
                  </Button>
                }
              >
                One run goes at a time so every payment is easy to follow. Watch it now and start
                yours when it ends.
              </InlineStatus>
            ) : notice.kind === "reconnecting" ? (
              <InlineStatus tone="pending" title="Reconnecting to the live feed">
                The run keeps going on chain. The page picks up where it left off.
              </InlineStatus>
            ) : (
              <InlineStatus tone="critical" title={notice.title}>
                {notice.message}
              </InlineStatus>
            )}
          </div>
        ) : null}

        <div className={styles.stage}>
          <div
            className={styles.gateSlot}
            style={{ "--demo-cycle": `${CALL_DWELL_MS}ms` } as CSSProperties}
          >
            {gate ? (
              <Gate
                key={gate.key}
                request={gate.request}
                checks={gate.checks}
                outcome={gate.outcome}
                motion={gateLive ? "once" : "still"}
              />
            ) : (
              <div className={styles.gateEmpty}>
                <p>Each call passes the policy check here before it settles.</p>
              </div>
            )}
          </div>
          <div className={styles.detailSlot}>
            <CallDetail
              view={view}
              mode={mode}
              policy={activePolicy}
              network={network}
              settleable={settleable}
            />
          </div>
        </div>

        <div className={styles.meterRow}>
          {activePolicy ? (
            <SpendMeter
              label="Daily cap, rolling 24 hours"
              spent={view.spent}
              cap={units(activePolicy.dailyCap)}
              asset={DEMO_ASSET}
              detail={meterDetail}
            />
          ) : null}
        </div>

        <div className={styles.receipts}>
          <div className={styles.receiptsHead}>
            <h3 className={styles.receiptsTitle}>Receipts</h3>
            <p className={styles.receiptsNote}>Newest first. Each one is an account on chain.</p>
          </div>
          <div
            className={styles.receiptsBody}
            style={{ "--demo-rows": (settleable ?? 6) + 1 } as CSSProperties}
          >
            <ReceiptList
              label="Receipts from this run"
              receipts={receipts}
              landingIds={landing}
              live
              empty={
                <p>
                  No receipts yet. When the agent runs, each paid call lands here with a link to its
                  receipt on the explorer.
                </p>
              }
            />
          </div>
        </div>
      </section>

      <aside className={styles.side} aria-label="Policy and on-chain records">
        <PolicySide policy={activePolicy} settleable={settleable} />
        <OnChain view={view} network={network} settlementProgram={settlementProgram} />
      </aside>

      <p className="visually-hidden" aria-live="polite">
        {announcement}
      </p>
    </div>
  );
}
