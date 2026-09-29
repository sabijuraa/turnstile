import { PublicKey } from "@solana/web3.js";
import { hexToBytes, receiptAddress } from "@turnstile/shared";
import type { Logger } from "./logger.js";
import type { IndexerMetrics, TickOutcome } from "./metrics.js";
import type { ReceiptSource, SettledReceipt, SignatureInfo } from "./source.js";
import {
  type Checkpoint,
  CheckpointConflictError,
  type CheckpointStore,
  type ReceiptRecord,
} from "./store.js";

export type { TickOutcome };

/** How a tick found where to start. */
export type ResumeMode = "signature" | "slot" | "start";

export type TickErrorKind = "rpc" | "database" | "integrity" | "conflict";

export interface TickResult {
  stream: string;
  outcome: TickOutcome;
  resumedBy: ResumeMode | null;
  /** True when this tick found a new ledger and started the stream over. */
  reset: boolean;
  /** Signatures processed and covered by the new checkpoint, failed ones included. */
  processed: number;
  /** Failed transactions skipped. They hold no receipt. */
  skippedFailed: number;
  /** Receipts decoded from the processed transactions. */
  receiptsSeen: number;
  /** Receipts that were new to Postgres. */
  receiptsInserted: number;
  /** Signatures found past the checkpoint and left for the next tick. */
  remaining: number;
  checkpoint: { lastSignature: string | null; lastSlot: number } | null;
  tipSlot: number | null;
  lagSlots: number | null;
  durationMs: number;
  error?: { kind: TickErrorKind; message: string };
}

export interface IndexerStatus {
  stream: string;
  lastSuccessAt: number | null;
  consecutiveFailures: number;
  lastResult: TickResult | null;
}

export interface IndexerDeps {
  source: ReceiptSource;
  store: CheckpointStore;
  /** Checkpoint row name. Different streams can index in parallel. */
  stream: string;
  /** Value of the receipts.network column, the CAIP-2 id of the cluster. */
  network: string;
  settlementProgram: PublicKey;
  /** Slot to start from when the stream has no checkpoint yet. */
  startSlot?: number;
  /** Signatures per `getSignaturesForAddress` page and most transactions handled per tick. */
  batchSize: number;
  logger: Logger;
  metrics?: IndexerMetrics;
  /** Milliseconds since the epoch. */
  clock?: () => number;
}

export interface Indexer {
  /** Does one bounded unit of work. Never throws. Failures come back as outcome "error". */
  tick(): Promise<TickResult>;
  status(): IndexerStatus;
}

/** A settlement event does not agree with the chain. The batch is refused, not skipped. */
export class IntegrityError extends Error {
  override name = "IntegrityError";
}

const FETCH_CONCURRENCY = 8;
const RECEIPT_FIELDS: (keyof SettledReceipt)[] = [
  "receiptAddress",
  "agentWallet",
  "owner",
  "sessionKey",
  "recipient",
  "recipientToken",
  "mint",
  "amount",
  "resourceId",
  "nonce",
  "slot",
  "unixTimestamp",
  "feePayer",
];

function errorKind(err: unknown): TickErrorKind {
  if (err instanceof IntegrityError) return "integrity";
  if (err instanceof CheckpointConflictError) return "conflict";
  if (err instanceof RpcStageError) return "rpc";
  return "database";
}

/** Wraps any failure that happened while talking to the chain. */
class RpcStageError extends Error {
  override name = "RpcStageError";
}

async function rpc<T>(what: string, fn: () => Promise<T>): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof RpcStageError || err instanceof IntegrityError) throw err;
    const msg = err instanceof Error ? err.message : String(err);
    throw new RpcStageError(
      `${what} failed (${msg}). Check SOLANA_RPC_URL and that the node is up.`,
      {
        cause: err,
      },
    );
  }
}

function describe(value: SettledReceipt[keyof SettledReceipt]): string {
  return typeof value === "bigint" ? value.toString() : value;
}

export function createIndexer(deps: IndexerDeps): Indexer {
  const { source, store, stream, logger, metrics } = deps;
  const clock = deps.clock ?? Date.now;
  const startSlot = deps.startSlot ?? 0;
  const log = logger.child({ stream });
  const state: IndexerStatus = {
    stream,
    lastSuccessAt: null,
    consecutiveFailures: 0,
    lastResult: null,
  };
  /** The last signature this process committed. The node just listed it, so it is known. */
  let committedSignature: string | null = null;

  function checkReceipt(signature: string, slot: number, r: SettledReceipt): void {
    let expected: PublicKey;
    try {
      [expected] = receiptAddress(
        new PublicKey(r.agentWallet),
        hexToBytes(r.nonce),
        deps.settlementProgram,
      );
    } catch (err) {
      throw new IntegrityError(
        `PaymentSettled in ${signature} holds an agent wallet or nonce that is not valid (${err instanceof Error ? err.message : String(err)}). The batch was not written.`,
        { cause: err },
      );
    }
    if (expected.toBase58() !== r.receiptAddress) {
      throw new IntegrityError(
        `PaymentSettled in ${signature} names receipt ${r.receiptAddress}, but the receipt PDA for agent wallet ${r.agentWallet} and nonce ${r.nonce} is ${expected.toBase58()}. The batch was not written. Check that the indexer points at the right settlement program.`,
      );
    }
    if (r.slot !== BigInt(slot)) {
      throw new IntegrityError(
        `PaymentSettled in ${signature} says slot ${r.slot} but the transaction landed in slot ${slot}. The batch was not written.`,
      );
    }
  }

  function crossCheck(
    signature: string,
    event: SettledReceipt,
    account: SettledReceipt | null,
  ): boolean {
    if (!account) return false;
    for (const field of RECEIPT_FIELDS) {
      if (account[field] !== event[field]) {
        throw new IntegrityError(
          `Receipt ${event.receiptAddress} from ${signature} disagrees with its account on ${field} (event ${describe(event[field])}, account ${describe(account[field])}). The batch was not written.`,
        );
      }
    }
    return true;
  }

  async function collectPending(cp: Checkpoint, mode: ResumeMode): Promise<SignatureInfo[]> {
    const until = mode === "signature" ? (cp.lastSignature ?? undefined) : undefined;
    // In every mode nothing older than the checkpoint slot is new. In signature mode the
    // node stops at `until` anyway. In slot mode this is the only stop, and signatures in
    // the checkpoint slot itself are processed again, which the receipt key makes harmless.
    const floor = cp.lastSlot;
    const pending: SignatureInfo[] = [];
    let before: string | undefined;
    for (;;) {
      const page = await rpc("getSignaturesForAddress", () =>
        source.signatures({
          ...(until ? { until } : {}),
          ...(before ? { before } : {}),
          limit: deps.batchSize,
        }),
      );
      let reachedCheckpoint = false;
      for (const s of page) {
        if (s.slot < floor || (cp.lastSignature !== null && s.signature === cp.lastSignature)) {
          reachedCheckpoint = true;
          break;
        }
        pending.push(s);
      }
      const last = page[page.length - 1];
      if (reachedCheckpoint || !last || page.length < deps.batchSize) break;
      before = last.signature;
    }
    return pending.reverse();
  }

  async function fetchBatch(
    batch: SignatureInfo[],
  ): Promise<{ done: SignatureInfo[]; receipts: ReceiptRecord[]; skipped: number }> {
    const done: SignatureInfo[] = [];
    const receipts: ReceiptRecord[] = [];
    let skipped = 0;
    for (let i = 0; i < batch.length; i += FETCH_CONCURRENCY) {
      const window = batch.slice(i, i + FETCH_CONCURRENCY);
      const txs = await Promise.all(
        window.map((s) =>
          s.failed
            ? Promise.resolve(null)
            : rpc(`getTransaction ${s.signature}`, () => source.transaction(s.signature)),
        ),
      );
      for (const [j, s] of window.entries()) {
        if (s.failed) {
          skipped++;
          done.push(s);
          continue;
        }
        const tx = txs[j];
        if (!tx) {
          // Everything before this signature is safe to commit. This one and the rest wait.
          if (done.length === 0) {
            throw new RpcStageError(
              `The node listed ${s.signature} but did not return the transaction. It is retried on the next tick.`,
            );
          }
          log.debug({ signature: s.signature }, "transaction not available yet, stopping batch");
          return { done, receipts, skipped };
        }
        for (const r of tx.receipts) {
          checkReceipt(s.signature, tx.slot, r);
          receipts.push({ ...r, signature: s.signature });
        }
        done.push(s);
      }
    }
    return { done, receipts, skipped };
  }

  async function resolveCheckpoint(genesis: string): Promise<{ cp: Checkpoint; reset: boolean }> {
    let cp = await store.ensure(stream, startSlot, genesis);
    if (cp.genesisHash === null) {
      await store.adoptGenesis(stream, genesis);
      cp = { ...cp, genesisHash: genesis };
      return { cp, reset: false };
    }
    if (cp.genesisHash === genesis) return { cp, reset: false };
    const { purged } = await store.reset(stream, deps.network, genesis, startSlot);
    log.error(
      {
        previousGenesis: cp.genesisHash,
        genesis,
        previousSignature: cp.lastSignature,
        previousSlot: cp.lastSlot,
        purgedReceipts: purged,
      },
      "LEDGER RESET DETECTED. The genesis hash changed, so the old checkpoint and its receipts belong to a ledger that no longer exists. Deleted those receipts and started the stream over from the start slot.",
    );
    metrics?.ledgerResets.inc({ stream });
    committedSignature = null;
    const fresh = await store.load(stream);
    if (!fresh) {
      throw new CheckpointConflictError(
        `Checkpoint row for stream ${stream} vanished during the reset. Another process removed it.`,
      );
    }
    return { cp: fresh, reset: true };
  }

  async function run(started: number): Promise<TickResult> {
    const genesis = await rpc("getGenesisHash", () => source.genesisHash());
    const tip = await rpc("getSlot", () => source.tipSlot());
    const { cp, reset } = await resolveCheckpoint(genesis);

    let mode: ResumeMode = "start";
    if (cp.lastSignature !== null) {
      const known =
        cp.lastSignature === committedSignature ||
        (await rpc("getSignatureStatuses", () => source.signatureKnown(cp.lastSignature ?? "")));
      if (known) {
        mode = "signature";
      } else {
        mode = "slot";
        metrics?.slotResumes.inc({ stream });
        log.warn(
          { signature: cp.lastSignature, slot: cp.lastSlot },
          "the RPC node no longer knows the checkpoint signature. Resuming from its slot instead. Signatures in that slot are processed again and duplicates are skipped by receipt address.",
        );
      }
    }

    const pending = await collectPending(cp, mode);
    const batch = pending.slice(0, deps.batchSize);
    const base = {
      stream,
      resumedBy: mode,
      reset,
      tipSlot: tip,
    };

    if (batch.length === 0) {
      return {
        ...base,
        outcome: "idle",
        processed: 0,
        skippedFailed: 0,
        receiptsSeen: 0,
        receiptsInserted: 0,
        remaining: 0,
        checkpoint: { lastSignature: cp.lastSignature, lastSlot: cp.lastSlot },
        lagSlots: 0,
        durationMs: clock() - started,
      };
    }

    const { done, receipts, skipped } = await fetchBatch(batch);
    const accounts = await rpc("getMultipleAccounts", () =>
      source.receiptAccounts(receipts.map((r) => r.receiptAddress)),
    );
    let missing = 0;
    for (const [i, r] of receipts.entries()) {
      if (!crossCheck(r.signature, r, accounts[i] ?? null)) missing++;
    }
    if (missing > 0) {
      metrics?.missingReceiptAccounts.inc({ stream }, missing);
      log.warn(
        { missing },
        "some receipt accounts could not be read. Indexed them from the PaymentSettled event alone.",
      );
    }

    const newest = done[done.length - 1];
    if (!newest) {
      throw new RpcStageError("A batch finished with no processed signature. Retrying next tick.");
    }
    const next = { lastSignature: newest.signature, lastSlot: newest.slot };
    const { inserted } = await store.commit({
      stream,
      expectedSignature: cp.lastSignature,
      genesisHash: genesis,
      network: deps.network,
      receipts,
      next,
    });
    committedSignature = next.lastSignature;
    const remaining = pending.length - done.length;
    metrics?.receiptsIndexed.inc({ stream }, inserted);
    metrics?.transactionsProcessed.inc({ stream, status: "succeeded" }, done.length - skipped);
    if (skipped > 0) metrics?.transactionsProcessed.inc({ stream, status: "failed" }, skipped);
    return {
      ...base,
      outcome: "progress",
      processed: done.length,
      skippedFailed: skipped,
      receiptsSeen: receipts.length,
      receiptsInserted: inserted,
      remaining,
      checkpoint: next,
      lagSlots: remaining > 0 ? Math.max(0, tip - next.lastSlot) : 0,
      durationMs: clock() - started,
    };
  }

  async function tick(): Promise<TickResult> {
    const started = clock();
    const timer = metrics?.tickDuration.startTimer({ stream });
    let result: TickResult;
    try {
      result = await run(started);
      state.lastSuccessAt = clock();
      state.consecutiveFailures = 0;
      const level = result.outcome === "progress" ? "info" : "debug";
      log[level](
        {
          outcome: result.outcome,
          resumedBy: result.resumedBy,
          processed: result.processed,
          skippedFailed: result.skippedFailed,
          receiptsSeen: result.receiptsSeen,
          receiptsInserted: result.receiptsInserted,
          remaining: result.remaining,
          checkpoint: result.checkpoint,
          lagSlots: result.lagSlots,
          ms: result.durationMs,
        },
        "tick",
      );
      if (result.checkpoint) metrics?.checkpointSlot.set({ stream }, result.checkpoint.lastSlot);
      if (result.tipSlot !== null) metrics?.tipSlot.set({ stream }, result.tipSlot);
      if (result.lagSlots !== null) metrics?.lagSlots.set({ stream }, result.lagSlots);
      metrics?.lastSuccess.set({ stream }, Math.floor(state.lastSuccessAt / 1000));
    } catch (err) {
      const kind = errorKind(err);
      const message = err instanceof Error ? err.message : String(err);
      state.consecutiveFailures++;
      result = {
        stream,
        outcome: "error",
        resumedBy: null,
        reset: false,
        processed: 0,
        skippedFailed: 0,
        receiptsSeen: 0,
        receiptsInserted: 0,
        remaining: 0,
        checkpoint: null,
        tipSlot: null,
        lagSlots: null,
        durationMs: clock() - started,
        error: { kind, message },
      };
      const level = kind === "integrity" ? "error" : "warn";
      log[level](
        { err, kind, consecutiveFailures: state.consecutiveFailures },
        "tick failed. The checkpoint did not move, so the same work is retried.",
      );
      metrics?.tickErrors.inc({ stream, kind });
    }
    metrics?.ticks.inc({ stream, outcome: result.outcome });
    metrics?.consecutiveFailures.set({ stream }, state.consecutiveFailures);
    timer?.({ outcome: result.outcome });
    state.lastResult = result;
    return result;
  }

  return {
    tick,
    status: () => ({ ...state }),
  };
}
