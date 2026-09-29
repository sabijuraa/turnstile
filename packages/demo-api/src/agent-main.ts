import { serve } from "@hono/node-server";
import { Connection, PublicKey } from "@solana/web3.js";
import { createAgent, readKeypairFile, TurnstileAgentError } from "@turnstile/sdk-agent";
import { createPool, migrate } from "@turnstile/shared/db";
import type { Catalog } from "./catalog.js";
import { type AgentConfig, ConfigError, loadAgentConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { createRunnerMetrics } from "./metrics.js";
import { createRunnerApp } from "./runner/app.js";
import { DemoRunner } from "./runner/run.js";
import { SolanaDemoChain } from "./runner/solana-chain.js";
import { RunStore } from "./runner/store.js";

const CATALOG_TTL_MS = 60_000;

function fail(message: string): never {
  console.error(message);
  process.exit(1);
}

async function main(): Promise<void> {
  let config: AgentConfig;
  try {
    config = loadAgentConfig();
  } catch (err) {
    if (err instanceof ConfigError) fail(err.message);
    throw err;
  }
  const logger = createLogger(config.logLevel, "demo-agent");
  const d = config.deployment;
  let owner: ReturnType<typeof readKeypairFile>;
  let session: ReturnType<typeof readKeypairFile>;
  try {
    owner = readKeypairFile(config.ownerKeypairPath);
    session = readKeypairFile(config.sessionKeypairPath);
  } catch (err) {
    if (err instanceof TurnstileAgentError) fail(err.message);
    throw err;
  }
  if (owner.publicKey.toBase58() !== d.demoOwner) {
    fail(
      `DEMO_OWNER_KEYPAIR holds ${owner.publicKey.toBase58()} but the deployment names ${d.demoOwner} as the demo owner. Point both at the same bootstrap output.`,
    );
  }
  if (session.publicKey.toBase58() !== d.demoSession) {
    fail(
      `DEMO_SESSION_KEYPAIR holds ${session.publicKey.toBase58()} but the deployment names ${d.demoSession} as the demo session key. Point both at the same bootstrap output.`,
    );
  }

  const pool = createPool(config.databaseUrl, 5);
  pool.on("error", (err) => logger.error({ err }, "idle postgres client failed"));
  try {
    const applied = await migrate(pool);
    logger.info({ applied }, applied.length ? "migrations applied" : "database is up to date");
  } catch (err) {
    logger.fatal(
      { err },
      "could not run migrations. Check DATABASE_URL and that Postgres is reachable, then restart.",
    );
    await pool.end();
    process.exit(1);
  }

  const connection = new Connection(config.rpcUrl, "confirmed");
  const mint = new PublicKey(d.mint);
  const agentWalletProgram = new PublicKey(d.programs.agentWallet);
  const settlementProgram = new PublicKey(d.programs.settlement);
  const chain = new SolanaDemoChain({
    connection,
    owner,
    mint,
    mintDecimals: d.mintDecimals,
  });

  let cachedCatalog: { catalog: Catalog; at: number } | null = null;
  const loadCatalog = async (): Promise<Catalog> => {
    if (cachedCatalog && Date.now() - cachedCatalog.at < CATALOG_TTL_MS)
      return cachedCatalog.catalog;
    const res = await fetch(`${config.demoApiUrl}/v1/catalog`, {
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) throw new Error(`GET ${config.demoApiUrl}/v1/catalog answered ${res.status}.`);
    const catalog = (await res.json()) as Catalog;
    if (catalog.payTo !== d.demoRecipient) {
      throw new Error(
        `The demo API pays ${catalog.payTo} but the deployment names ${d.demoRecipient} as the demo recipient.`,
      );
    }
    cachedCatalog = { catalog, at: Date.now() };
    return catalog;
  };

  const store = new RunStore(pool);
  const metrics = createRunnerMetrics();
  const runner = new DemoRunner({
    store,
    chain,
    logger,
    metrics,
    owner: owner.publicKey,
    sessionKey: session.publicKey,
    mint,
    mintDecimals: d.mintDecimals,
    network: d.caip2 ?? config.network,
    loadCatalog,
    demoApiUrl: config.demoApiUrl,
    // The chain is the one that says no in the demo, so the local policy check is off.
    makeAgent: (agentWallet) =>
      createAgent({
        connection,
        agentWallet,
        sessionKey: session,
        localPolicyCheck: false,
        settlementProgram,
        agentWalletProgram,
        mintDecimals: d.mintDecimals,
      }),
  });
  const recovered = await runner.recoverInterrupted();
  if (recovered)
    logger.warn({ runId: recovered.id }, "marked a run interrupted by the last restart as failed");

  const app = createRunnerApp({
    runner,
    store,
    logger,
    metrics,
    webOrigins: config.webOrigins,
    readiness: {
      database: () => pool.query("SELECT 1"),
      solana: () => connection.getSlot("confirmed"),
      demoApi: () => loadCatalog(),
    },
  });
  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    logger.info(
      {
        port: info.port,
        owner: owner.publicKey.toBase58(),
        sessionKey: session.publicKey.toBase58(),
        demoApi: config.demoApiUrl,
        webOrigins: config.webOrigins,
      },
      "demo agent listening",
    );
  });
  const shutdown = (signal: string) => {
    logger.info({ signal }, "shutting down");
    server.close(() => {
      runner
        .idle()
        .then(() => pool.end())
        .finally(() => process.exit(0));
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  console.error("Demo agent failed to start.", err);
  process.exit(1);
});
