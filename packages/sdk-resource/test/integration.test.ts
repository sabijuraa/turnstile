/**
 * End to end against a real solana-test-validator with both programs loaded, a real
 * facilitator and a real resource server. Runs only with TURNSTILE_INTEGRATION=1.
 *
 *   TURNSTILE_INTEGRATION=1 pnpm --filter @turnstile/sdk-resource test test/integration.test.ts
 *
 * Ports default to 38899 (RPC), 38900 (websocket) and 38001 (gossip), away from a stack
 * that may already use 8899. Override the base with INTEGRATION_RPC_PORT.
 */
import { type ChildProcess, spawn } from "node:child_process";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { serve } from "@hono/node-server";
import { createAssociatedTokenAccount, createMint, getAccount, mintTo } from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  createApp,
  createLogger,
  createMetrics,
  createSolanaChain,
  createStore,
  turnstileCodec,
} from "@turnstile/facilitator";
import {
  AGENT_WALLET_PROGRAM_ID,
  agentWalletAddress,
  authorizationToWire,
  bytesToHex,
  decodeHeader,
  encodeHeader,
  hexToBytes,
  type PaymentAuthorization,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  resourceId,
  SETTLEMENT_PROGRAM_ID,
  type SettlementResponse,
  signAuthorization,
  vaultAddress,
  X402_VERSION,
} from "@turnstile/shared";
import { createPool, migrate, type Pool } from "@turnstile/shared/db";
import {
  createWalletInstruction,
  depositInstruction,
  fetchReceipt,
  updatePolicyInstruction,
} from "@turnstile/shared/programs";
import bs58 from "bs58";
import { Hono } from "hono";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { honoPaywall, type PaywallEnv } from "../src/hono.js";
import type { PaymentRejected } from "../src/paywall.js";

const enabled = process.env.TURNSTILE_INTEGRATION === "1";
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const deployDir = join(repoRoot, "target/deploy");
const RPC_PORT = Number(process.env.INTEGRATION_RPC_PORT ?? 38899);
const RPC_URL = `http://127.0.0.1:${RPC_PORT}`;
const WS_URL = `ws://127.0.0.1:${RPC_PORT + 1}`;
const DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  "postgres://turnstile_facilitator_test:turnstile_facilitator_test@127.0.0.1:5432/turnstile_facilitator_test";

const PRICE = "0.005";
const PRICE_UNITS = 5_000n;
const PER_CALL_CAP = 100_000n; // 0.1 tUSDC
const DAILY_CAP = 10_000_000n; // 10 tUSDC
const DEPOSIT = 20_000_000n;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function listen(fetchFn: (req: Request) => Response | Promise<Response>) {
  const server = serve({ fetch: fetchFn, port: 0, hostname: "127.0.0.1" }) as Server;
  await new Promise<void>((r) => server.once("listening", () => r()));
  const { port } = server.address() as AddressInfo;
  return { server, url: `http://127.0.0.1:${port}` };
}

const close = (s: Server | undefined) => new Promise<void>((r) => (s ? s.close(() => r()) : r()));

describe.skipIf(!enabled)("paid request on a real validator", () => {
  let validator: ChildProcess | undefined;
  let ledger = "";
  let conn: Connection;
  let pool: Pool;
  let facilitatorServer: Server | undefined;
  let apiServer: Server | undefined;
  let deadApiServer: Server | undefined;
  let apiUrl = "";
  let deadApiUrl = "";
  let mint: PublicKey;
  let recipient: Keypair;
  let recipientToken: PublicKey;
  let session: Keypair;
  let agentWallet: PublicKey;
  let vault: PublicKey;
  let handlerRuns = 0;

  async function send(ixs: TransactionInstruction[], signers: Keypair[]): Promise<string> {
    return sendAndConfirmTransaction(conn, new Transaction().add(...ixs), signers, {
      commitment: "confirmed",
    });
  }

  async function airdrop(to: PublicKey, sol: number): Promise<void> {
    const sig = await conn.requestAirdrop(to, sol * LAMPORTS_PER_SOL);
    const bh = await conn.getLatestBlockhash("confirmed");
    await conn.confirmTransaction({ signature: sig, ...bh }, "confirmed");
  }

  const balance = async (account: PublicKey): Promise<bigint> =>
    (await getAccount(conn, account, "confirmed")).amount;

  beforeAll(async () => {
    for (const so of ["agent_wallet.so", "settlement.so"]) {
      if (!existsSync(join(deployDir, so))) {
        throw new Error(`${so} is missing in target/deploy. Build the programs first.`);
      }
    }
    ledger = mkdtempSync(join(tmpdir(), "turnstile-it-ledger-"));
    validator = spawn(
      "solana-test-validator",
      [
        "--ledger",
        ledger,
        "--reset",
        "--quiet",
        "--rpc-port",
        String(RPC_PORT),
        "--faucet-port",
        String(RPC_PORT + 91),
        "--gossip-port",
        String(RPC_PORT - 898),
        "--dynamic-port-range",
        `${RPC_PORT - 889}-${RPC_PORT - 829}`,
        "--bind-address",
        "127.0.0.1",
        "--bpf-program",
        AGENT_WALLET_PROGRAM_ID.toBase58(),
        join(deployDir, "agent_wallet.so"),
        "--bpf-program",
        SETTLEMENT_PROGRAM_ID.toBase58(),
        join(deployDir, "settlement.so"),
      ],
      { stdio: "ignore" },
    );
    conn = new Connection(RPC_URL, { commitment: "confirmed", wsEndpoint: WS_URL });
    const deadline = Date.now() + 90_000;
    for (;;) {
      try {
        await conn.getSlot();
        const info = await conn.getAccountInfo(SETTLEMENT_PROGRAM_ID);
        if (info?.executable) break;
      } catch {
        // still starting
      }
      if (Date.now() > deadline) throw new Error("solana-test-validator did not start in 90 s");
      await sleep(500);
    }

    // Money setup. The mint authority also pays for token accounts.
    const authority = Keypair.generate();
    const owner = Keypair.generate();
    const feePayer = Keypair.generate();
    recipient = Keypair.generate();
    session = Keypair.generate();
    await Promise.all([airdrop(authority.publicKey, 10), airdrop(owner.publicKey, 10)]);
    await airdrop(feePayer.publicKey, 10);
    mint = await createMint(conn, authority, authority.publicKey, null, 6, undefined, {
      commitment: "confirmed",
    });
    recipientToken = await createAssociatedTokenAccount(
      conn,
      authority,
      mint,
      recipient.publicKey,
      { commitment: "confirmed" },
    );
    const ownerToken = await createAssociatedTokenAccount(conn, authority, mint, owner.publicKey, {
      commitment: "confirmed",
    });
    await mintTo(conn, authority, mint, ownerToken, authority, 100_000_000n, [], {
      commitment: "confirmed",
    });

    // Facilitator on a real port.
    pool = createPool(DATABASE_URL, 5);
    await migrate(pool);
    const logger = createLogger(process.env.INTEGRATION_LOG_LEVEL ?? "silent");
    const chain = createSolanaChain({
      rpcUrl: RPC_URL,
      wsUrl: WS_URL,
      feePayer,
      codec: turnstileCodec,
      agentWalletProgram: AGENT_WALLET_PROGRAM_ID,
      settlementProgram: SETTLEMENT_PROGRAM_ID,
      logger,
    });
    const fac = await listen((req) => facApp.fetch(req));
    facilitatorServer = fac.server;
    const { app: facApp } = createApp({
      config: {
        port: 0,
        databaseUrl: DATABASE_URL,
        network: "localnet",
        caip2: "solana:localnet",
        rpcUrl: RPC_URL,
        wsUrl: WS_URL,
        deployment: {
          network: "localnet",
          programs: {
            agentWallet: AGENT_WALLET_PROGRAM_ID.toBase58(),
            settlement: SETTLEMENT_PROGRAM_ID.toBase58(),
          },
          mint: mint.toBase58(),
          mintDecimals: 6,
          mintSymbol: "tUSDC",
        },
        mint,
        mintDecimals: 6,
        settlementProgram: SETTLEMENT_PROGRAM_ID,
        agentWalletProgram: AGENT_WALLET_PROGRAM_ID,
        publicUrl: fac.url,
        logLevel: "silent",
        defaultTimeoutSeconds: 60,
        maxTimeoutSeconds: 3600,
        bodyLimitBytes: 64 * 1024,
      },
      chain,
      store: createStore(pool),
      logger,
      metrics: createMetrics(false),
    });

    // Resource server. The origin is only known after listening, so the paywall is built lazily.
    let api: Hono<PaywallEnv> | undefined;
    const apiListen = await listen((req) => {
      if (!api) throw new Error("api not ready");
      return api.fetch(req);
    });
    apiServer = apiListen.server;
    apiUrl = apiListen.url;
    const routes = {
      "POST /v1/summarize": { price: PRICE, description: "Summarize a text" },
      "POST /v1/premium": { price: "0.5", description: "Above the per-call cap" },
      "POST /v1/other": { price: PRICE, description: "Not on the allow-list" },
    };
    const build = (facilitatorUrl: string) => {
      const app = new Hono<PaywallEnv>();
      app.use(
        "*",
        honoPaywall({
          facilitatorUrl,
          payTo: recipient.publicKey.toBase58(),
          publicUrl: apiUrl,
          routes,
        }),
      );
      app.post("/v1/:name", async (c) => {
        handlerRuns++;
        const body = (await c.req.json()) as { text: string };
        return c.json({
          summary: body.text.split(" ")[0],
          receipt: c.get("turnstilePayment")?.receipt,
        });
      });
      return app;
    };
    api = build(fac.url);
    let deadApi: Hono<PaywallEnv> | undefined;
    const dead = await listen((req) => {
      if (!deadApi) throw new Error("api not ready");
      return deadApi.fetch(req);
    });
    deadApiServer = dead.server;
    deadApiUrl = dead.url;
    deadApi = build("http://127.0.0.1:9"); // discard port, nothing listens

    // Agent wallet with the summarize and premium routes on the allow-list.
    [agentWallet] = agentWalletAddress(owner.publicKey, 1n);
    [vault] = vaultAddress(agentWallet);
    await send(
      [
        createWalletInstruction({
          owner: owner.publicKey,
          mint,
          id: 1n,
          perCallCap: PER_CALL_CAP,
          dailyCap: DAILY_CAP,
          sessionKey: session.publicKey,
          sessionExpiresAt: 0n,
        }),
        depositInstruction({
          owner: owner.publicKey,
          agentWallet,
          ownerToken,
          amount: DEPOSIT,
        }),
        updatePolicyInstruction({
          owner: owner.publicKey,
          agentWallet,
          perCallCap: PER_CALL_CAP,
          dailyCap: DAILY_CAP,
          allowList: ["/v1/summarize", "/v1/premium"].map((p) => ({
            resourceId: resourceId(`${apiUrl}${p}`),
            recipient: recipient.publicKey,
          })),
        }),
      ],
      [owner],
    );
  }, 180_000);

  afterAll(async () => {
    await Promise.all([close(apiServer), close(deadApiServer), close(facilitatorServer)]);
    await pool?.end();
    validator?.kill("SIGINT");
    await sleep(500);
    if (ledger) rmSync(ledger, { recursive: true, force: true });
  });

  const post = (url: string, header?: string) =>
    fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(header ? { "payment-signature": header } : {}),
      },
      body: JSON.stringify({ text: "Turnstile settles one payment per request." }),
    });

  async function requirementsFor(url: string): Promise<PaymentRequirements> {
    const res = await post(url);
    expect(res.status).toBe(402);
    const body = decodeHeader<PaymentRequired>(res.headers.get("payment-required") ?? "");
    const req = body.accepts[0];
    if (!req) throw new Error("402 without requirements");
    return req;
  }

  /** What the agent SDK does. Built by hand here with the shared helpers. */
  function sign(req: PaymentRequirements, expiresAt?: bigint): string {
    const auth: PaymentAuthorization = {
      agentWallet,
      sessionKey: session.publicKey,
      recipient: recipient.publicKey,
      mint,
      amount: BigInt(req.amount),
      resourceId: hexToBytes(req.extra.resourceId),
      nonce: hexToBytes(req.extra.nonce),
      expiresAt: expiresAt ?? BigInt(req.extra.expiresAt),
    };
    const payload: PaymentPayload = {
      x402Version: X402_VERSION,
      resource: req.resource,
      accepted: req,
      payload: {
        authorization: authorizationToWire(auth),
        signature: bs58.encode(signAuthorization(auth, session.secretKey)),
      },
    };
    return encodeHeader(payload);
  }

  let firstHeader = "";
  let firstSettlement: SettlementResponse | undefined;

  it("pays, settles on chain, writes the receipt and returns the resource", async () => {
    const vaultBefore = await balance(vault);
    const recipientBefore = await balance(recipientToken);
    const req = await requirementsFor(`${apiUrl}/v1/summarize`);
    expect(req).toMatchObject({
      amount: "5000",
      asset: mint.toBase58(),
      resource: `${apiUrl}/v1/summarize`,
    });

    firstHeader = sign(req);
    const res = await post(`${apiUrl}/v1/summarize`, firstHeader);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { summary: string; receipt: string };
    expect(body.summary).toBe("Turnstile");
    const settlement = decodeHeader<SettlementResponse>(res.headers.get("payment-response") ?? "");
    firstSettlement = settlement;
    expect(settlement).toMatchObject({
      success: true,
      network: "solana:localnet",
      payer: agentWallet.toBase58(),
    });
    expect(body.receipt).toBe(settlement.receipt);

    const receipt = await fetchReceipt(conn, new PublicKey(settlement.receipt ?? ""));
    expect(receipt).not.toBeNull();
    expect(receipt?.amount).toBe(PRICE_UNITS);
    expect(receipt?.agentWallet.equals(agentWallet)).toBe(true);
    expect(receipt?.recipient.equals(recipient.publicKey)).toBe(true);
    expect(bytesToHex(receipt?.resourceId ?? new Uint8Array())).toBe(req.extra.resourceId);
    expect(bytesToHex(receipt?.nonce ?? new Uint8Array())).toBe(req.extra.nonce);

    const tx = await conn.getTransaction(settlement.transaction, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    expect(tx?.meta?.err).toBeNull();
    expect(await balance(vault)).toBe(vaultBefore - PRICE_UNITS);
    expect(await balance(recipientToken)).toBe(recipientBefore + PRICE_UNITS);
  });

  it("answers a replayed payment header with the same settlement and no second debit", async () => {
    const vaultBefore = await balance(vault);
    const runsBefore = handlerRuns;
    const res = await post(`${apiUrl}/v1/summarize`, firstHeader);
    expect(res.status).toBe(200);
    const settlement = decodeHeader<SettlementResponse>(res.headers.get("payment-response") ?? "");
    expect(settlement).toMatchObject({
      success: true,
      alreadySettled: true,
      transaction: firstSettlement?.transaction,
      receipt: firstSettlement?.receipt,
    });
    expect(handlerRuns).toBe(runsBefore + 1);
    expect(await balance(vault)).toBe(vaultBefore);
  });

  it("settles concurrent copies of one payment exactly once", async () => {
    const vaultBefore = await balance(vault);
    const header = sign(await requirementsFor(`${apiUrl}/v1/summarize`));
    const responses = await Promise.all(
      Array.from({ length: 5 }, () => post(`${apiUrl}/v1/summarize`, header)),
    );
    const settlements = responses.map((r) =>
      decodeHeader<SettlementResponse>(r.headers.get("payment-response") ?? ""),
    );
    expect(responses.map((r) => r.status)).toEqual([200, 200, 200, 200, 200]);
    expect(new Set(settlements.map((s) => s.transaction)).size).toBe(1);
    expect(await balance(vault)).toBe(vaultBefore - PRICE_UNITS);
  });

  it("refuses a price above the per-call cap before anything moves", async () => {
    const vaultBefore = await balance(vault);
    const runsBefore = handlerRuns;
    const header = sign(await requirementsFor(`${apiUrl}/v1/premium`));
    const res = await post(`${apiUrl}/v1/premium`, header);
    expect(res.status).toBe(402);
    const body = (await res.json()) as PaymentRejected;
    expect(body.reason).toBe("PerCallCapExceeded");
    expect(body.message).toContain("per-call cap");
    expect(body.accepts).toHaveLength(1);
    expect(handlerRuns).toBe(runsBefore);
    expect(await balance(vault)).toBe(vaultBefore);
  });

  it("refuses a resource that is not on the allow-list", async () => {
    const vaultBefore = await balance(vault);
    const header = sign(await requirementsFor(`${apiUrl}/v1/other`));
    const res = await post(`${apiUrl}/v1/other`, header);
    expect(res.status).toBe(402);
    expect(((await res.json()) as PaymentRejected).reason).toBe("ResourceNotAllowed");
    expect(await balance(vault)).toBe(vaultBefore);
  });

  it("refuses an expired authorization", async () => {
    const req = await requirementsFor(`${apiUrl}/v1/summarize`);
    const past = BigInt(Math.floor(Date.now() / 1000) - 10);
    const res = await post(`${apiUrl}/v1/summarize`, sign(req, past));
    expect(res.status).toBe(402);
    expect(((await res.json()) as PaymentRejected).reason).toBe("authorization_expired");
  });

  it("serves nothing when the facilitator is unreachable", async () => {
    const runsBefore = handlerRuns;
    const unpaid = await post(`${deadApiUrl}/v1/summarize`);
    expect(unpaid.status).toBe(503);
    const req = await requirementsFor(`${apiUrl}/v1/summarize`);
    const paid = await post(`${deadApiUrl}/v1/summarize`, sign(req));
    expect(paid.status).toBe(503);
    const body = (await paid.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("payment_service_unavailable");
    expect(handlerRuns).toBe(runsBefore);
  });

  it("keeps the median paid request under two seconds (NFR3)", async () => {
    const runs = Number(process.env.INTEGRATION_LATENCY_RUNS ?? 25);
    const paid: number[] = [];
    const loop: number[] = [];
    for (let i = 0; i < runs; i++) {
      const loopStart = performance.now();
      const req = await requirementsFor(`${apiUrl}/v1/summarize`);
      const header = sign(req);
      const paidStart = performance.now();
      const res = await post(`${apiUrl}/v1/summarize`, header);
      await res.json();
      const end = performance.now();
      expect(res.status).toBe(200);
      paid.push(end - paidStart);
      loop.push(end - loopStart);
    }
    const stats = (xs: number[]) => {
      const s = [...xs].sort((a, b) => a - b);
      const at = (q: number) => s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? 0;
      const median =
        s.length % 2 ? at(0.5) : ((s[s.length / 2 - 1] ?? 0) + (s[s.length / 2] ?? 0)) / 2;
      return {
        median: Math.round(median),
        p90: Math.round(at(0.9)),
        min: Math.round(s[0] ?? 0),
        max: Math.round(s[s.length - 1] ?? 0),
      };
    };
    const result = { runs, paidRequestMs: stats(paid), fullLoopMs: stats(loop) };
    process.stderr.write(`NFR3 latency ${JSON.stringify(result)}\n`);
    expect(result.paidRequestMs.median).toBeLessThan(2000);
  }, 180_000);
});
