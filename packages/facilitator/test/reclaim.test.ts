import { Keypair, type PublicKey } from "@solana/web3.js";
import { RECEIPT_RETENTION_SECONDS } from "@turnstile/shared/programs";
import { describe, expect, it } from "vitest";
import type { CloseOutcome, FeePayerReceipt, ReclaimChain } from "../src/chain/types.js";
import { createLogger } from "../src/logger.js";
import { reclaimReceipts } from "../src/reclaim.js";

const NOW = 1_900_000_000n;
const RENT = 3_180_720n;

/** Behaves like close_receipt. It refuses the whole transaction when one receipt is not due. */
class FakeReclaimChain implements ReclaimChain {
  readonly feePayer: PublicKey = Keypair.generate().publicKey;
  readonly receipts = new Map<string, FeePayerReceipt>();
  readonly sent: string[][] = [];
  balance = 0n;
  failNext: string | null = null;

  constructor(public now: bigint) {}

  add(expiresAt: bigint): FeePayerReceipt {
    const r = { address: Keypair.generate().publicKey, expiresAt, lamports: RENT };
    this.receipts.set(r.address.toBase58(), r);
    return r;
  }

  async chainTime() {
    return this.now;
  }

  async listFeePayerReceipts() {
    return [...this.receipts.values()];
  }

  async closeReceipts(addresses: PublicKey[]): Promise<CloseOutcome> {
    const keys = addresses.map((a) => a.toBase58());
    this.sent.push(keys);
    if (this.failNext) {
      const detail = this.failNext;
      this.failNext = null;
      return { ok: false, detail };
    }
    for (const k of keys) {
      const r = this.receipts.get(k);
      if (!r) return { ok: false, detail: "AccountNotInitialized" };
      if (!(this.now > r.expiresAt + RECEIPT_RETENTION_SECONDS)) {
        return { ok: false, detail: "RetentionNotElapsed" };
      }
    }
    for (const k of keys) {
      this.balance += this.receipts.get(k)?.lamports ?? 0n;
      this.receipts.delete(k);
    }
    return { ok: true, signature: `sig${this.sent.length}` };
  }
}

const logger = createLogger("silent");
/** An expiry whose retention period ended `ago` seconds before NOW. */
const endedAgo = (ago: bigint) => NOW - RECEIPT_RETENTION_SECONDS - ago;

describe("reclaimReceipts", () => {
  it("closes only receipts past the retention period and counts the lamports", async () => {
    const chain = new FakeReclaimChain(NOW);
    const due = [chain.add(endedAgo(1n)), chain.add(endedAgo(86_400n))];
    // Exactly at the boundary the program still refuses, one second later it accepts.
    const boundary = chain.add(endedAgo(0n));
    const fresh = chain.add(NOW - 60n);

    const s = await reclaimReceipts({ chain, logger });
    expect(s).toMatchObject({ found: 4, eligible: 2, retained: 2, closed: 2, failed: 0 });
    expect(s.lamportsReclaimed).toBe(2n * RENT);
    expect(chain.balance).toBe(2n * RENT);
    expect(chain.receipts.has(boundary.address.toBase58())).toBe(true);
    expect(chain.receipts.has(fresh.address.toBase58())).toBe(true);
    for (const r of due) expect(chain.receipts.has(r.address.toBase58())).toBe(false);
    expect(s.nextReclaimableAt).toBe(NOW + 1n);
  });

  it("closes the oldest first, in batches, up to the limit", async () => {
    const chain = new FakeReclaimChain(NOW);
    const made = Array.from({ length: 7 }, (_, i) => chain.add(endedAgo(BigInt(100 - i))));
    const s = await reclaimReceipts({ chain, logger }, { batchSize: 3, limit: 5 });
    expect(chain.sent.map((b) => b.length)).toEqual([3, 2]);
    expect(chain.sent.flat()).toEqual(made.slice(0, 5).map((r) => r.address.toBase58()));
    expect(s).toMatchObject({ eligible: 7, closed: 5, failed: 0 });
    expect(s.lamportsReclaimed).toBe(5n * RENT);
  });

  it("reports a failed batch, keeps going and does not count its lamports", async () => {
    const chain = new FakeReclaimChain(NOW);
    for (let i = 0; i < 4; i++) chain.add(endedAgo(BigInt(10 + i)));
    chain.failNext = "blockhash expired";
    const s = await reclaimReceipts({ chain, logger }, { batchSize: 2 });
    expect(s).toMatchObject({ closed: 2, failed: 2 });
    expect(s.lamportsReclaimed).toBe(2n * RENT);
    expect(s.batches.map((b) => b.ok)).toEqual([false, true]);
    expect(s.batches[0]?.detail).toBe("blockhash expired");
    expect(chain.receipts.size).toBe(2);
  });

  it("sends nothing on a dry run or when nothing is due", async () => {
    const chain = new FakeReclaimChain(NOW);
    chain.add(endedAgo(5n));
    const dry = await reclaimReceipts({ chain, logger }, { dryRun: true });
    expect(dry).toMatchObject({ eligible: 1, closed: 0 });
    expect(chain.sent).toEqual([]);

    const empty = new FakeReclaimChain(NOW);
    const s = await reclaimReceipts({ chain: empty, logger });
    expect(s).toMatchObject({ found: 0, closed: 0, failed: 0, nextReclaimableAt: null });
    expect(empty.sent).toEqual([]);
  });

  it("refuses a batch size outside 1 to 20", async () => {
    const chain = new FakeReclaimChain(NOW);
    await expect(reclaimReceipts({ chain, logger }, { batchSize: 21 })).rejects.toThrow(
      "batch size",
    );
    await expect(reclaimReceipts({ chain, logger }, { batchSize: 0 })).rejects.toThrow(
      "batch size",
    );
  });
});
