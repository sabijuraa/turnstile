import { Counter, collectDefaultMetrics, Gauge, Histogram, Registry } from "prom-client";

export type TickOutcome = "progress" | "idle" | "error";

export interface IndexerMetrics {
  registry: Registry;
  receiptsIndexed: Counter<"stream">;
  transactionsProcessed: Counter<"stream" | "status">;
  ticks: Counter<"stream" | "outcome">;
  tickErrors: Counter<"stream" | "kind">;
  tickDuration: Histogram<"stream" | "outcome">;
  lagSlots: Gauge<"stream">;
  checkpointSlot: Gauge<"stream">;
  tipSlot: Gauge<"stream">;
  lastSuccess: Gauge<"stream">;
  consecutiveFailures: Gauge<"stream">;
  slotResumes: Counter<"stream">;
  ledgerResets: Counter<"stream">;
  missingReceiptAccounts: Counter<"stream">;
  historyGaps: Counter<"stream">;
  historyGapSlots: Counter<"stream">;
  receiptsBackfilled: Counter<"stream">;
}

/** Each indexer gets its own registry so several can live in one process, as in tests. */
export function createMetrics(defaultMetrics = true): IndexerMetrics {
  const registry = new Registry();
  if (defaultMetrics) collectDefaultMetrics({ register: registry, prefix: "turnstile_indexer_" });
  const registers = [registry];
  return {
    registry,
    receiptsIndexed: new Counter({
      name: "turnstile_indexer_receipts_indexed_total",
      help: "Receipts written to Postgres. Rows that already existed are not counted.",
      labelNames: ["stream"],
      registers,
    }),
    transactionsProcessed: new Counter({
      name: "turnstile_indexer_transactions_processed_total",
      help: "Settlement program transactions processed, by status (succeeded or failed).",
      labelNames: ["stream", "status"],
      registers,
    }),
    ticks: new Counter({
      name: "turnstile_indexer_ticks_total",
      help: "Indexer ticks, by outcome (progress, idle or error).",
      labelNames: ["stream", "outcome"],
      registers,
    }),
    tickErrors: new Counter({
      name: "turnstile_indexer_tick_errors_total",
      help: "Failed ticks, by kind (rpc, database, integrity or conflict).",
      labelNames: ["stream", "kind"],
      registers,
    }),
    tickDuration: new Histogram({
      name: "turnstile_indexer_tick_duration_seconds",
      help: "Duration of one indexer tick in seconds, by outcome.",
      labelNames: ["stream", "outcome"],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30],
      registers,
    }),
    lagSlots: new Gauge({
      name: "turnstile_indexer_lag_slots",
      help: "Slots between the chain tip and the checkpoint. Zero when every known signature is processed.",
      labelNames: ["stream"],
      registers,
    }),
    checkpointSlot: new Gauge({
      name: "turnstile_indexer_checkpoint_slot",
      help: "Slot of the last processed settlement program signature.",
      labelNames: ["stream"],
      registers,
    }),
    tipSlot: new Gauge({
      name: "turnstile_indexer_tip_slot",
      help: "Confirmed slot of the chain seen at the start of the last successful tick.",
      labelNames: ["stream"],
      registers,
    }),
    lastSuccess: new Gauge({
      name: "turnstile_indexer_last_success_timestamp_seconds",
      help: "Unix time of the last successful tick.",
      labelNames: ["stream"],
      registers,
    }),
    consecutiveFailures: new Gauge({
      name: "turnstile_indexer_consecutive_failures",
      help: "Failed ticks since the last successful one.",
      labelNames: ["stream"],
      registers,
    }),
    slotResumes: new Counter({
      name: "turnstile_indexer_slot_resumes_total",
      help: "Ticks that resumed by slot because the RPC node no longer knew the checkpoint signature.",
      labelNames: ["stream"],
      registers,
    }),
    ledgerResets: new Counter({
      name: "turnstile_indexer_ledger_resets_total",
      help: "Times the stream started over because the ledger genesis hash changed.",
      labelNames: ["stream"],
      registers,
    }),
    missingReceiptAccounts: new Counter({
      name: "turnstile_indexer_missing_receipt_accounts_total",
      help: "Receipts indexed from the event alone because the receipt account could not be read.",
      labelNames: ["stream"],
      registers,
    }),
    historyGaps: new Counter({
      name: "turnstile_indexer_history_gaps_total",
      help: "Times the RPC node had purged history the stream still needed. Each one triggers a backfill from the live receipt accounts.",
      labelNames: ["stream"],
      registers,
    }),
    historyGapSlots: new Counter({
      name: "turnstile_indexer_history_gap_slots_total",
      help: "Slots whose transactions the node had purged before the indexer read them. Receipts closed inside them cannot be recovered.",
      labelNames: ["stream"],
      registers,
    }),
    receiptsBackfilled: new Counter({
      name: "turnstile_indexer_receipts_backfilled_total",
      help: "Receipts restored from their accounts because the node had purged their transactions.",
      labelNames: ["stream"],
      registers,
    }),
  };
}
