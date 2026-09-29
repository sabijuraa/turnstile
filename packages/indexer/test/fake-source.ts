import { randomBytes } from "node:crypto";
import { Keypair, PublicKey } from "@solana/web3.js";
import { bytesToHex, receiptAddress, SETTLEMENT_PROGRAM_ID } from "@turnstile/shared";
import bs58 from "bs58";
import type {
  ReceiptSource,
  SettledReceipt,
  SettlementTransaction,
  SignatureInfo,
  SignaturePage,
} from "../src/source.js";

export interface FakeTx {
  signature: string;
  slot: number;
  failed: boolean;
  receipts: SettledReceipt[];
}

type Method = keyof ReceiptSource;

const addr = (): string => Keypair.generate().publicKey.toBase58();

export function fakeSignature(): string {
  return bs58.encode(randomBytes(64));
}

/** A receipt with a correct PDA for a random agent wallet and nonce. */
export function makeReceipt(slot: number, overrides: Partial<SettledReceipt> = {}): SettledReceipt {
  const agentWallet = overrides.agentWallet ?? addr();
  const nonce = overrides.nonce ?? bytesToHex(randomBytes(32));
  const [pda] = receiptAddress(new PublicKey(agentWallet), Buffer.from(nonce, "hex"));
  return {
    receiptAddress: pda.toBase58(),
    agentWallet,
    owner: addr(),
    sessionKey: addr(),
    recipient: addr(),
    recipientToken: addr(),
    mint: addr(),
    amount: BigInt(1000 + Math.floor(Math.random() * 1_000_000)),
    resourceId: bytesToHex(randomBytes(32)),
    nonce,
    slot: BigInt(slot),
    unixTimestamp: BigInt(1_790_000_000 + slot),
    feePayer: addr(),
    ...overrides,
  };
}

/**
 * An in-memory ledger that answers like a Solana RPC node. Signatures come back newest first,
 * `until` stops at a signature the node knows and is ignored when it does not know it, as the
 * real node does. Every method can be told to fail.
 */
export class FakeLedger implements ReceiptSource {
  genesis = bs58.encode(randomBytes(32));
  tip = 0;
  /** Oldest first, as they landed. */
  txs: FakeTx[] = [];
  /** Signatures the node forgot, for example after pruning. */
  forgotten = new Set<string>();
  /** Signatures whose transaction the node does not return yet. */
  unavailable = new Set<string>();
  /** Receipt account data that differs from the event, keyed by receipt address. */
  accountOverrides = new Map<string, SettledReceipt | null>();
  calls: Record<Method, number> = {
    genesisHash: 0,
    tipSlot: 0,
    signatures: 0,
    signatureKnown: 0,
    transaction: 0,
    receiptAccounts: 0,
  };
  fetched: string[] = [];
  private failures = new Map<Method, { remaining: number; after: number; error: Error }>();

  /** Appends a transaction in a new slot, or in `slot` when given. */
  add(opts: { receipts?: number; failed?: boolean; slot?: number } = {}): FakeTx {
    const last = this.txs[this.txs.length - 1];
    const slot = opts.slot ?? (last ? last.slot + 3 : 10);
    const failed = opts.failed ?? false;
    const count = failed ? 0 : (opts.receipts ?? 1);
    const tx: FakeTx = {
      signature: fakeSignature(),
      slot,
      failed,
      receipts: Array.from({ length: count }, () => makeReceipt(slot)),
    };
    this.txs.push(tx);
    this.tip = Math.max(this.tip, slot + 2);
    return tx;
  }

  addMany(n: number, opts: { receipts?: number } = {}): FakeTx[] {
    return Array.from({ length: n }, () => this.add(opts));
  }

  allReceipts(): SettledReceipt[] {
    return this.txs.flatMap((t) => t.receipts);
  }

  /** Makes the next `times` calls of `method` throw, after letting `after` calls through. */
  fail(method: Method, error: Error, times = 1, after = 0): void {
    this.failures.set(method, { remaining: times, after, error });
  }

  private enter(method: Method): void {
    this.calls[method]++;
    const f = this.failures.get(method);
    if (!f) return;
    if (f.after > 0) {
      f.after--;
      return;
    }
    if (f.remaining > 0) {
      f.remaining--;
      if (f.remaining === 0) this.failures.delete(method);
      throw f.error;
    }
  }

  async genesisHash(): Promise<string> {
    this.enter("genesisHash");
    return this.genesis;
  }

  async tipSlot(): Promise<number> {
    this.enter("tipSlot");
    return this.tip;
  }

  async signatures(page: SignaturePage): Promise<SignatureInfo[]> {
    this.enter("signatures");
    const newestFirst = [...this.txs].reverse().filter((t) => !this.forgotten.has(t.signature));
    let start = 0;
    if (page.before) {
      const i = newestFirst.findIndex((t) => t.signature === page.before);
      start = i === -1 ? newestFirst.length : i + 1;
    }
    const out: SignatureInfo[] = [];
    for (const t of newestFirst.slice(start)) {
      if (page.until && t.signature === page.until) break;
      out.push({ signature: t.signature, slot: t.slot, failed: t.failed });
      if (out.length >= page.limit) break;
    }
    return out;
  }

  async signatureKnown(signature: string): Promise<boolean> {
    this.enter("signatureKnown");
    return this.txs.some((t) => t.signature === signature) && !this.forgotten.has(signature);
  }

  async transaction(signature: string): Promise<SettlementTransaction | null> {
    this.enter("transaction");
    this.fetched.push(signature);
    if (this.unavailable.has(signature)) return null;
    const tx = this.txs.find((t) => t.signature === signature);
    if (!tx || tx.failed) return null;
    return { signature, slot: tx.slot, receipts: tx.receipts.map((r) => ({ ...r })) };
  }

  async receiptAccounts(addresses: string[]): Promise<(SettledReceipt | null)[]> {
    this.enter("receiptAccounts");
    const all = new Map(this.allReceipts().map((r) => [r.receiptAddress, r]));
    return addresses.map((a) => {
      if (this.accountOverrides.has(a)) return this.accountOverrides.get(a) ?? null;
      const r = all.get(a);
      return r ? { ...r } : null;
    });
  }
}

export { SETTLEMENT_PROGRAM_ID };
