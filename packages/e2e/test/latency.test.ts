/**
 * NFR3. Twenty sequential paid requests through the agent SDK against the demo API, each timed
 * from the first unpaid request to the paid response body. Results go to stdout and to
 * results/latency.json, which stays out of git.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { cpus, loadavg } from "node:os";
import { join } from "node:path";
import { Keypair, PublicKey } from "@solana/web3.js";
import { createAgent } from "@turnstile/sdk-agent";
import { describe, expect, it } from "vitest";
import { createChain, loadCatalog, route } from "../src/chain.js";
import { loadDeployment, loadEnv, RESULTS_DIR } from "../src/env.js";

const RUNS = 20;
/** NFR3 budget for the median. Override with E2E_LATENCY_BUDGET_MS on a shared or slow host. */
const BUDGET_MS = Number(process.env.E2E_LATENCY_BUDGET_MS ?? 2000);
const env = loadEnv();
const deployment = loadDeployment(env.deploymentFile);

/** Nearest rank percentile of sorted samples. */
function percentile(sorted: number[], p: number): number {
  const rank = Math.max(1, Math.ceil((p / 100) * sorted.length));
  return sorted[rank - 1] as number;
}

describe("latency of the paid loop (NFR3)", () => {
  it(`measures ${RUNS} sequential paid requests and keeps the median under the NFR3 budget`, async () => {
    const chain = createChain(env, deployment);
    const catalog = await loadCatalog(env.services.demoApi);
    const summarize = route(catalog, "/v1/summarize");
    const price = BigInt(summarize.priceBaseUnits);
    const owner = await chain.fundedOwner(10_000_000n);
    const session = Keypair.generate();
    const wallet = await chain.createAgentWallet({
      owner,
      id: 0n,
      session: session.publicKey,
      perCallCap: price,
      dailyCap: price * BigInt(RUNS + 1),
      deposit: price * BigInt(RUNS + 1),
      allowList: [{ resourceId: summarize.resourceId, recipient: new PublicKey(catalog.payTo) }],
    });
    const agent = createAgent({
      connection: chain.connection,
      agentWallet: wallet.agentWallet,
      sessionKey: session,
    });
    const call = async () => {
      const started = performance.now();
      const res = await agent.fetch(`${env.services.demoApi}${summarize.path}`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text: "Agents pay per request. The chain enforces the owner's caps. Receipts are indexed.",
          sentences: 1,
        }),
      });
      await res.json();
      const ms = performance.now() - started;
      expect(res.status).toBe(200);
      expect(res.payment?.alreadySettled).toBe(false);
      return ms;
    };

    // One warm-up call loads the wallet into the SDK cache and warms the service connections.
    const loadBefore = loadavg()[0] as number;
    const warmupMs = await call();
    const samples: number[] = [];
    for (let i = 0; i < RUNS; i++) samples.push(await call());
    const sorted = [...samples].sort((a, b) => a - b);
    const round = (n: number) => Math.round(n * 10) / 10;
    const result = {
      measuredAt: new Date().toISOString(),
      requirement: "NFR3 median under 2000 ms from 402 to settled receipt on a local validator",
      runs: RUNS,
      budgetMs: BUDGET_MS,
      medianMs: round(percentile(sorted, 50)),
      p90Ms: round(percentile(sorted, 90)),
      minMs: round(sorted[0] as number),
      maxMs: round(sorted[sorted.length - 1] as number),
      warmupMs: round(warmupMs),
      samplesMs: samples.map(round),
      conditions: {
        what: "agent SDK fetch of POST /v1/summarize, unpaid request, 402, sign, paid retry, facilitator verify and settle at confirmed commitment, response body read",
        sequential: true,
        warmupCalls: 1,
        stack: env.stack,
        rpcUrl: env.rpcUrl,
        demoApiUrl: env.services.demoApi,
        facilitatorUrl: env.services.facilitator,
        price: summarize.price,
        node: process.version,
        cpus: cpus().length,
        loadAverage1mBefore: round(loadBefore),
        loadAverage1mAfter: round(loadavg()[0] as number),
        platform: `${process.platform} ${process.arch}`,
      },
    };
    mkdirSync(RESULTS_DIR, { recursive: true });
    writeFileSync(join(RESULTS_DIR, "latency.json"), `${JSON.stringify(result, null, 2)}\n`);
    process.stdout.write(
      `latency over ${RUNS} sequential paid requests: median ${result.medianMs} ms, p90 ${result.p90Ms} ms, min ${result.minMs} ms, max ${result.maxMs} ms (warm-up ${result.warmupMs} ms, ${env.stack} stack, ${env.rpcUrl}, ${result.conditions.cpus} cpus, load ${result.conditions.loadAverage1mBefore} then ${result.conditions.loadAverage1mAfter})\n`,
    );

    expect(await chain.tokenBalance(wallet.vault)).toBe(0n);
    expect(
      result.medianMs,
      `The median is over the ${BUDGET_MS} ms budget with a 1 minute load average of ${result.conditions.loadAverage1mAfter} on ${result.conditions.cpus} cpus.`,
    ).toBeLessThan(BUDGET_MS);
  });
});
