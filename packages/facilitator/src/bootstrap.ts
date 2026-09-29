import { createPool, migrate } from "@turnstile/shared/db";
import type { Pool } from "pg";
import { turnstileCodec } from "./chain/codec.js";
import { createSolanaChain } from "./chain/solana.js";
import type { SettlementChain } from "./chain/types.js";
import { ConfigError, type LoadedConfig, loadConfig } from "./config.js";
import { createLogger, type Logger } from "./logger.js";
import { createStore, type FacilitatorStore } from "./store/store.js";

export interface Runtime extends LoadedConfig {
  logger: Logger;
  pool: Pool;
  store: FacilitatorStore;
  chain: SettlementChain;
}

/** Loads config, migrates the database and connects the chain. Exits with a clear message on failure. */
export async function bootstrap(): Promise<Runtime> {
  let loaded: LoadedConfig;
  try {
    loaded = loadConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
  const { config, feePayer } = loaded;
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
  const chain = createSolanaChain({
    rpcUrl: config.rpcUrl,
    wsUrl: config.wsUrl,
    feePayer,
    codec: turnstileCodec,
    agentWalletProgram: config.agentWalletProgram,
    settlementProgram: config.settlementProgram,
    logger,
  });
  return { config, feePayer, logger, pool, store: createStore(pool), chain };
}
