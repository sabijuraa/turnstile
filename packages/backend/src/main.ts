import { serve } from "@hono/node-server";
import { Connection } from "@solana/web3.js";
import { createPool, migrate } from "@turnstile/shared/db";
import { createApp } from "./app.js";
import { ConfigError, loadConfig } from "./config.js";
import { createLogger } from "./logger.js";

async function main(): Promise<void> {
  let config: ReturnType<typeof loadConfig>;
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
  const rpc = new Connection(config.rpcUrl, "confirmed");
  const { app } = createApp({ pool, rpc, config, logger });
  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    logger.info(
      {
        port: info.port,
        network: config.network,
        rpcUrl: config.rpcUrl,
        webOrigin: config.webOrigin,
      },
      "console backend listening",
    );
  });
  const shutdown = (signal: string) => {
    logger.info({ signal }, "shutting down");
    server.close(() => {
      pool.end().finally(() => process.exit(0));
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  console.error("Console backend failed to start.", err);
  process.exit(1);
});
