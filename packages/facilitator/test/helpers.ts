import { Keypair, PublicKey } from "@solana/web3.js";
import {
  AGENT_WALLET_PROGRAM_ID,
  authorizationToWire,
  bucketIndex,
  bytesToHex,
  hexToBytes,
  type PaymentAuthorization,
  type PaymentPayload,
  type PaymentRequirements,
  type PolicyState,
  receiptAddress,
  resourceId,
  SETTLEMENT_PROGRAM_ID,
  signAuthorization,
  X402_VERSION,
} from "@turnstile/shared";
import { createPool, migrate } from "@turnstile/shared/db";
import bs58 from "bs58";
import type { Pool } from "pg";
import { createApp } from "../src/app.js";
import type {
  ReceiptSnapshot,
  SettlementChain,
  SimulateOutcome,
  SubmitOutcome,
  WalletSnapshot,
} from "../src/chain/types.js";
import type { Config } from "../src/config.js";
import { ChainUnavailableError } from "../src/errors.js";
import { createLogger } from "../src/logger.js";
import { createMetrics, type Metrics } from "../src/metrics.js";
import { createStore, type FacilitatorStore } from "../src/store/store.js";

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://turnstile_facilitator_test:turnstile_facilitator_test@127.0.0.1:5432/turnstile_facilitator_test";

export const MINT = new PublicKey("So11111111111111111111111111111111111111112");
export const RESOURCE = "https://api.example.com/v1/summarize";

export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    databaseUrl: TEST_DATABASE_URL,
    network: "localnet",
    caip2: "solana:localnet",
    rpcUrl: "http://127.0.0.1:8899",
    wsUrl: "ws://127.0.0.1:8900",
    deployment: {
      network: "localnet",
      programs: {
        agentWallet: AGENT_WALLET_PROGRAM_ID.toBase58(),
        settlement: SETTLEMENT_PROGRAM_ID.toBase58(),
      },
      mint: MINT.toBase58(),
      mintDecimals: 6,
      mintSymbol: "tUSDC",
    },
    mint: MINT,
    mintDecimals: 6,
    settlementProgram: SETTLEMENT_PROGRAM_ID,
    agentWalletProgram: AGENT_WALLET_PROGRAM_ID,
    publicUrl: "http://facilitator.test",
    logLevel: "silent",
    defaultTimeoutSeconds: 60,
    maxTimeoutSeconds: 3600,
    bodyLimitBytes: 64 * 1024,
    ...overrides,
  };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * An in-memory chain that applies the same policy rules as the program. Receipts are keyed
 * by address, so a second settle of one nonce is refused exactly like on chain.
 */
export class FakeChain implements SettlementChain {
  readonly feePayer = Keypair.generate().publicKey;
  wallets = new Map<string, WalletSnapshot>();
  receipts = new Map<string, { receipt: ReceiptSnapshot; signature: string }>();
  down = false;
  /** Returns a program error name to refuse the simulation. */
  simulateHook: ((auth: PaymentAuthorization) => string | null) | null = null;
  /** Replaces the default submit behavior. */
  submitHook: ((auth: PaymentAuthorization) => SubmitOutcome | null) | null = null;
  /** Milliseconds each submit takes, so concurrent calls interleave. */
  submitDelayMs = 0;
  submits = 0;
  simulations = 0;
  private sigCounter = 0;

  constructor(private readonly clock: () => Date) {}

  private guard(): void {
    if (this.down) throw new ChainUnavailableError("connect ECONNREFUSED 127.0.0.1:8899");
  }

  async ping(): Promise<void> {
    this.guard();
  }

  async loadWallet(address: PublicKey): Promise<WalletSnapshot | null> {
    this.guard();
    return this.wallets.get(address.toBase58()) ?? null;
  }

  async loadReceipt(address: PublicKey): Promise<ReceiptSnapshot | null> {
    this.guard();
    return this.receipts.get(address.toBase58())?.receipt ?? null;
  }

  async receiptSignature(address: PublicKey): Promise<string | null> {
    this.guard();
    return this.receipts.get(address.toBase58())?.signature ?? null;
  }

  async simulateSettle(auth: PaymentAuthorization): Promise<SimulateOutcome> {
    this.guard();
    this.simulations++;
    const reason = this.simulateHook?.(auth) ?? null;
    return reason ? { ok: false, reason, detail: `custom program error ${reason}` } : { ok: true };
  }

  /** Writes a receipt and debits the vault, as a landed settlement would. */
  land(auth: PaymentAuthorization): string {
    const [addr] = receiptAddress(auth.agentWallet, auth.nonce);
    const signature = bs58.encode(Buffer.alloc(64, ++this.sigCounter));
    this.receipts.set(addr.toBase58(), {
      signature,
      receipt: {
        agentWallet: auth.agentWallet,
        sessionKey: auth.sessionKey,
        recipient: auth.recipient,
        mint: auth.mint,
        amount: auth.amount,
        resourceId: auth.resourceId,
        nonce: auth.nonce,
      },
    });
    const wallet = this.wallets.get(auth.agentWallet.toBase58());
    if (wallet) {
      wallet.policy.vaultBalance = (wallet.policy.vaultBalance ?? 0n) - auth.amount;
      const idx = bucketIndex(BigInt(Math.floor(this.clock().getTime() / 1000)));
      wallet.policy.spendBuckets.push({ index: idx, amount: auth.amount });
    }
    return signature;
  }

  async submitSettle(auth: PaymentAuthorization): Promise<SubmitOutcome> {
    this.guard();
    this.submits++;
    if (this.submitDelayMs) await sleep(this.submitDelayMs);
    const hooked = this.submitHook?.(auth);
    if (hooked) return hooked;
    const [addr] = receiptAddress(auth.agentWallet, auth.nonce);
    if (this.receipts.has(addr.toBase58())) {
      return { ok: false, kind: "rejected", reason: "NonceAlreadyUsed", detail: "custom 6103" };
    }
    return { ok: true, signature: this.land(auth) };
  }
}

export interface AgentFixture {
  owner: Keypair;
  session: Keypair;
  wallet: PublicKey;
  payTo: PublicKey;
}

/** Registers an agent wallet that allows RESOURCE paid to a fresh recipient. */
export function addWallet(chain: FakeChain, policy: Partial<PolicyState> = {}): AgentFixture {
  const owner = Keypair.generate();
  const session = Keypair.generate();
  const payTo = Keypair.generate().publicKey;
  const wallet = Keypair.generate().publicKey;
  chain.wallets.set(wallet.toBase58(), {
    address: wallet,
    owner: owner.publicKey,
    mint: MINT,
    vault: Keypair.generate().publicKey,
    policy: {
      perCallCap: 1_000_000n,
      dailyCap: 10_000_000n,
      sessionKeys: [{ key: session.publicKey, expiresAt: 0n, active: true }],
      allowList: [{ resourceId: resourceId(RESOURCE), recipient: payTo }],
      spendBuckets: [],
      vaultBalance: 50_000_000n,
      ...policy,
    },
  });
  return { owner, session, wallet, payTo };
}

/** Builds the payload an agent SDK would send for these requirements. */
export function buildPayload(
  req: PaymentRequirements,
  agent: AgentFixture,
  opts: { signer?: Keypair; expiresAt?: bigint; amount?: bigint } = {},
): { payload: PaymentPayload; auth: PaymentAuthorization } {
  const auth: PaymentAuthorization = {
    agentWallet: agent.wallet,
    sessionKey: (opts.signer ?? agent.session).publicKey,
    recipient: new PublicKey(req.payTo),
    mint: new PublicKey(req.asset),
    amount: opts.amount ?? BigInt(req.amount),
    resourceId: hexToBytes(req.extra.resourceId),
    nonce: hexToBytes(req.extra.nonce),
    expiresAt: opts.expiresAt ?? BigInt(req.extra.expiresAt),
  };
  const signature = signAuthorization(auth, (opts.signer ?? agent.session).secretKey);
  return {
    auth,
    payload: {
      x402Version: X402_VERSION,
      resource: req.resource,
      accepted: req,
      payload: { authorization: authorizationToWire(auth), signature: bs58.encode(signature) },
    },
  };
}

let sharedPool: Pool | undefined;
let migrated = false;

export async function testPool(): Promise<Pool> {
  if (!sharedPool) sharedPool = createPool(TEST_DATABASE_URL, 5);
  if (!migrated) {
    await migrate(sharedPool);
    migrated = true;
  }
  return sharedPool;
}

export async function closePool(): Promise<void> {
  await sharedPool?.end();
  sharedPool = undefined;
  migrated = false;
}

export async function resetDb(pool: Pool): Promise<void> {
  await pool.query("TRUNCATE resources, settlement_dead_letters RESTART IDENTITY");
}

export interface Harness {
  pool: Pool;
  store: FacilitatorStore;
  chain: FakeChain;
  app: ReturnType<typeof createApp>["app"];
  services: ReturnType<typeof createApp>["services"];
  metrics: Metrics;
  clock: { now: Date };
}

export async function harness(opts: { config?: Partial<Config> } = {}): Promise<Harness> {
  const pool = await testPool();
  const clock = { now: new Date("2026-09-29T12:30:00.000Z") };
  const chain = new FakeChain(() => clock.now);
  const metrics = createMetrics(false);
  const store = createStore(pool);
  const { app, services } = createApp({
    config: testConfig(opts.config),
    chain,
    store,
    clock: () => clock.now,
    logger: createLogger("silent"),
    metrics,
  });
  return { pool, store, chain, app, services, metrics, clock };
}

export function jsonPost(body: unknown): RequestInit {
  return {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  };
}

export async function issue(
  h: Harness,
  agent: AgentFixture,
  body: Record<string, unknown> = {},
): Promise<PaymentRequirements> {
  const res = await h.app.request(
    "/requirements",
    jsonPost({
      resource: RESOURCE,
      price: "0.005",
      payTo: agent.payTo.toBase58(),
      description: "Summarize a text",
      ...body,
    }),
  );
  if (res.status !== 200) throw new Error(`requirements failed with ${res.status}`);
  return (await res.json()) as PaymentRequirements;
}

export const hex = bytesToHex;
