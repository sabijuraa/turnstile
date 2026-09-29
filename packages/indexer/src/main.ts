import { serve } from "@hono/node-server";
import { Connection } from "@solana/web3.js";
import { createPool, migrate } from "@turnstile/shared/db";
import { createApp } from "./app.js";
import { type Config, ConfigError, loadConfig } from "./config.js";
import { createSettlementDecoder } from "./decoder.js";
import { createIndexer } from "./indexer.js";
import { createLogger } from "./logger.js";
import { createMetrics } from "./metrics.js";
import { createRpcSource } from "./rpc-source.js";
import { createRunner } from "./runner.js";
import { createCheckpointStore } from "./store.js";

async function main(): Promise<void> {
  let config: Config;
  try {
    config = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
  const logger = createLogger(config.logLevel);
  const pool = createPool(config.databaseUrl);
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

  const metrics = createMetrics();
  const source = createRpcSource({
    rpc: new Connection(config.rpcUrl, "confirmed"),
    settlementProgram: config.settlementProgram,
    decoder: createSettlementDecoder(config.settlementProgram),
  });
  const indexer = createIndexer({
    source,
    store: createCheckpointStore(pool),
    stream: config.stream,
    network: config.networkId,
    settlementProgram: config.settlementProgram,
    ...(config.startSlot === undefined ? {} : { startSlot: config.startSlot }),
    batchSize: config.batchSize,
    logger,
    metrics,
  });
  const runner = createRunner({
    indexer,
    pollMs: config.pollMs,
    maxBackoffMs: config.maxBackoffMs,
    logger,
  });
  const app = createApp({ indexer, pool, metrics, logger, readyStaleMs: config.readyStaleMs });
  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    logger.info(
      {
        port: info.port,
        network: config.network,
        rpcUrl: config.rpcUrl,
        stream: config.stream,
        settlementProgram: config.settlementProgram.toBase58(),
        startSlot: config.startSlot ?? 0,
        pollMs: config.pollMs,
        batchSize: config.batchSize,
      },
      "indexer listening",
    );
  });
  runner.start();

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    logger.info({ signal }, "shutting down after the tick in flight");
    runner
      .stop()
      .then(
        () =>
          new Promise<void>((resolve) => {
            server.close(() => resolve());
          }),
      )
      .then(() => pool.end())
      .then(
        () => process.exit(0),
        (err: unknown) => {
          logger.error({ err }, "shutdown failed");
          process.exit(1);
        },
      );
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  console.error("Indexer failed to start.", err);
  process.exit(1);
});
