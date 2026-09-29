import type { PublicKey } from "@solana/web3.js";
import { RECEIPT_RETENTION_SECONDS, receiptReclaimable } from "@turnstile/shared/programs";
import type { FeePayerReceipt, ReclaimChain } from "./chain/types.js";
import type { Logger } from "./logger.js";

export const DEFAULT_RECLAIM_BATCH = 10;
/** One legacy transaction fits 20 closes well under the size and compute limits. */
export const MAX_RECLAIM_BATCH = 20;

export interface ReclaimOptions {
  /** Receipts closed per transaction. Default 10, at most 20. */
  batchSize?: number;
  /** Close at most this many receipts in one run. Default no limit. */
  limit?: number;
  /** Select and report without sending anything. */
  dryRun?: boolean;
}

export interface ReclaimBatch {
  receipts: string[];
  lamports: bigint;
  ok: boolean;
  signature?: string;
  detail?: string;
}

export interface ReclaimSummary {
  /** Receipts found with this facilitator as fee payer. */
  found: number;
  /** Receipts past their retention period, before the limit. */
  eligible: number;
  /** Receipts still inside their retention period. */
  retained: number;
  closed: number;
  failed: number;
  lamportsReclaimed: bigint;
  /** Chain time the selection used. */
  chainTime: bigint;
  /** Earliest chain time at which a retained receipt becomes closable, or null. */
  nextReclaimableAt: bigint | null;
  batches: ReclaimBatch[];
}

export interface ReclaimDeps {
  chain: ReclaimChain;
  logger: Logger;
}

/**
 * Finds the receipts this facilitator paid rent for, closes the ones whose retention period
 * has passed, oldest first, in batches, and reports the lamports that came back. A failed batch
 * is reported and the run goes on with the next one.
 */
export async function reclaimReceipts(
  deps: ReclaimDeps,
  opts: ReclaimOptions = {},
): Promise<ReclaimSummary> {
  const batchSize = opts.batchSize ?? DEFAULT_RECLAIM_BATCH;
  if (!Number.isInteger(batchSize) || batchSize < 1 || batchSize > MAX_RECLAIM_BATCH) {
    throw new RangeError(`batch size must be a whole number from 1 to ${MAX_RECLAIM_BATCH}`);
  }
  if (opts.limit !== undefined && (!Number.isInteger(opts.limit) || opts.limit < 1)) {
    throw new RangeError("limit must be a whole number of at least 1");
  }
  const { chain, logger } = deps;
  const now = await chain.chainTime();
  const all = await chain.listFeePayerReceipts();
  const due: FeePayerReceipt[] = [];
  let nextReclaimableAt: bigint | null = null;
  for (const r of all) {
    if (receiptReclaimable(r, now)) {
      due.push(r);
      continue;
    }
    const at = r.expiresAt + RECEIPT_RETENTION_SECONDS + 1n;
    if (nextReclaimableAt === null || at < nextReclaimableAt) nextReclaimableAt = at;
  }
  due.sort((a, b) => (a.expiresAt < b.expiresAt ? -1 : a.expiresAt > b.expiresAt ? 1 : 0));
  const selected = opts.limit === undefined ? due : due.slice(0, opts.limit);

  const summary: ReclaimSummary = {
    found: all.length,
    eligible: due.length,
    retained: all.length - due.length,
    closed: 0,
    failed: 0,
    lamportsReclaimed: 0n,
    chainTime: now,
    nextReclaimableAt,
    batches: [],
  };
  logger.info(
    {
      feePayer: chain.feePayer.toBase58(),
      found: summary.found,
      eligible: summary.eligible,
      selected: selected.length,
      chainTime: now.toString(),
    },
    "receipt reclaim scan finished",
  );
  if (opts.dryRun) return summary;

  for (let i = 0; i < selected.length; i += batchSize) {
    const batch = selected.slice(i, i + batchSize);
    const addresses: PublicKey[] = batch.map((r) => r.address);
    const lamports = batch.reduce((sum, r) => sum + r.lamports, 0n);
    const receipts = addresses.map((a) => a.toBase58());
    const outcome = await chain.closeReceipts(addresses);
    if (outcome.ok) {
      summary.closed += batch.length;
      summary.lamportsReclaimed += lamports;
      summary.batches.push({ receipts, lamports, ok: true, signature: outcome.signature });
      logger.info(
        { signature: outcome.signature, receipts: batch.length, lamports: lamports.toString() },
        "closed receipts",
      );
    } else {
      summary.failed += batch.length;
      summary.batches.push({
        receipts,
        lamports: 0n,
        ok: false,
        detail: outcome.detail,
        ...(outcome.signature ? { signature: outcome.signature } : {}),
      });
      logger.error(
        { signature: outcome.signature, receipts, detail: outcome.detail },
        "closing receipts failed. They stay on chain and the next run tries again.",
      );
    }
  }
  logger.info(
    {
      closed: summary.closed,
      failed: summary.failed,
      lamportsReclaimed: summary.lamportsReclaimed.toString(),
    },
    "receipt reclaim finished",
  );
  return summary;
}
