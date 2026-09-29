/**
 * A full demo run against a real validator and a real facilitator.
 *
 * Starts the demo API and the runner in this process and uses the facilitator at
 * FACILITATOR_URL. Needs TURNSTILE_INTEGRATION=1, SOLANA_RPC_URL, DEPLOYMENT_FILE, KEYS_DIR,
 * FACILITATOR_URL and a Postgres at TEST_DATABASE_URL. Skipped without TURNSTILE_INTEGRATION=1.
 */
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { AccountLayout } from "@solana/spl-token";
import { Connection, PublicKey } from "@solana/web3.js";
import { createAgent, readKeypairFile } from "@turnstile/sdk-agent";
import { createPaywall } from "@turnstile/sdk-resource";
import { vaultAddress } from "@turnstile/shared";
import { createPool, migrate, type Pool } from "@turnstile/shared/db";
import { fetchReceipt, parseProgramError } from "@turnstile/shared/programs";
import { testDatabaseUrl } from "@turnstile/shared/testing";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createApp, paywallRoutes } from "../src/app.js";
import { loadDeployment } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { createApiMetrics, createRunnerMetrics } from "../src/metrics.js";
import type { RunEvent } from "../src/runner/events.js";
import { DemoRunner } from "../src/runner/run.js";
import { SolanaDemoChain } from "../src/runner/solana-chain.js";
import { RunStore } from "../src/runner/store.js";

const enabled = process.env.TURNSTILE_INTEGRATION === "1";
const env = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set for the integration test.`);
  return v;
};
const TEST_DATABASE_URL = testDatabaseUrl("demo_api");

describe.skipIf(!enabled)("demo run against validator and facilitator", () => {
  let pool: Pool;
  let server: ReturnType<typeof serve>;
  let connection: Connection;
  let runner: DemoRunner;
  let store: RunStore;

  beforeAll(async () => {
    const deployment = loadDeployment(env("DEPLOYMENT_FILE"));
    connection = new Connection(env("SOLANA_RPC_URL"), "confirmed");
    pool = createPool(TEST_DATABASE_URL, 5);
    await migrate(pool);

    const logger = createLogger("silent", "demo-api");
    // Bind first so the public URL, and with it the resource ids, name the real port.
    const holder: { fetch?: (r: Request) => Response | Promise<Response> } = {};
    await new Promise<void>((resolve) => {
      server = serve(
        {
          fetch: (r) =>
            holder.fetch ? holder.fetch(r) : new Response("starting", { status: 503 }),
          port: 0,
          hostname: "127.0.0.1",
        },
        () => resolve(),
      );
    });
    const publicUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const config = {
      port: 0,
      network: "localnet" as const,
      deployment,
      facilitatorUrl: env("FACILITATOR_URL"),
      publicUrl,
      price: "0.005",
      priceBaseUnits: 5000n,
      payTo: deployment.demoRecipient,
      logLevel: "silent",
    };
    const paywall = createPaywall({
      facilitatorUrl: config.facilitatorUrl,
      payTo: config.payTo,
      publicUrl,
      routes: paywallRoutes(config),
    });
    const api = createApp({ config, paywall, logger, metrics: createApiMetrics(false) });
    holder.fetch = api.app.fetch;

    const owner = readKeypairFile(join(env("KEYS_DIR"), "demo-owner.json"));
    const session = readKeypairFile(join(env("KEYS_DIR"), "demo-session.json"));
    const mint = new PublicKey(deployment.mint);
    store = new RunStore(pool);
    runner = new DemoRunner({
      store,
      chain: new SolanaDemoChain({
        connection,
        owner,
        mint,
        mintDecimals: deployment.mintDecimals,
      }),
      logger: createLogger("silent", "demo-agent"),
      metrics: createRunnerMetrics(false),
      owner: owner.publicKey,
      sessionKey: session.publicKey,
      mint,
      mintDecimals: deployment.mintDecimals,
      network: deployment.caip2 ?? "solana:localnet",
      loadCatalog: async () => api.catalog,
      demoApiUrl: publicUrl,
      makeAgent: (agentWallet) =>
        createAgent({ connection, agentWallet, sessionKey: session, localPolicyCheck: false }),
    });
    await runner.recoverInterrupted();
  });

  afterAll(async () => {
    server?.close();
    await pool?.end();
  });

  it("settles six calls, and the chain refuses the seventh with DailyCapExceeded", async () => {
    const run = await runner.start();
    await runner.idle();
    const events = await store.events(run.id);
    expect(events.map((e) => e.type)).toEqual([
      "run.started",
      ...Array(6).fill("call.settled"),
      "call.refused",
      "run.finished",
    ]);
    const started = events[0] as RunEvent<"run.started">;
    const agentWallet = new PublicKey(started.data.agentWallet);

    const settled = events.filter((e) => e.type === "call.settled") as RunEvent<"call.settled">[];
    for (const e of settled) {
      const receipt = await fetchReceipt(connection, new PublicKey(e.data.receipt));
      expect(receipt?.amount).toBe(5_000n);
      expect(receipt?.agentWallet.equals(agentWallet)).toBe(true);
      const tx = await connection.getTransaction(e.data.transaction, {
        commitment: "confirmed",
        maxSupportedTransactionVersion: 0,
      });
      expect(tx?.meta?.err).toBeNull();
    }
    expect(settled.at(-1)?.data.rollingSpend.baseUnits).toBe("30000");

    const refused = events[7] as RunEvent<"call.refused">;
    expect(refused.data.reason).toBe("DailyCapExceeded");
    const failed = await connection.getTransaction(refused.data.failedTransaction, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    expect(failed?.meta?.err).not.toBeNull();
    expect(parseProgramError(failed?.meta?.err, failed?.meta?.logMessages ?? [])?.name).toBe(
      "DailyCapExceeded",
    );

    const finished = events[8] as RunEvent<"run.finished">;
    expect(finished.data).toMatchObject({ settledCalls: 6, refusedCalls: 1 });
    expect(finished.data.withdrawn.baseUnits).toBe("70000");
    const vault = await connection.getAccountInfo(vaultAddress(agentWallet)[0], "confirmed");
    expect(vault && AccountLayout.decode(vault.data).amount).toBe(0n);
    console.warn(
      JSON.stringify({
        agentWallet: agentWallet.toBase58(),
        receipts: settled.map((e) => e.data.receipt),
        refusedTx: refused.data.failedTransaction,
        durationMs: finished.data.durationMs,
      }),
    );
  });
});
