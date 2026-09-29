import { existsSync, readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { NETWORKS, type NetworkName, SETTLEMENT_PROGRAM_ID } from "@turnstile/shared";
import { z } from "zod";

const deploymentSchema = z.looseObject({
  network: z.string().optional(),
  programs: z.looseObject({ settlement: z.string().optional() }).optional(),
});

const optionalInt = (name: string, min: number, max: number) =>
  z.coerce
    .number({ error: `${name} must be a whole number` })
    .int(`${name} must be a whole number`)
    .min(min, `${name} must be between ${min} and ${max}`)
    .max(max, `${name} must be between ${min} and ${max}`);

const envSchema = z.object({
  PORT: optionalInt("PORT", 1, 65535).default(4023),
  DATABASE_URL: z
    .string({ error: "DATABASE_URL is not set. Point it at the Turnstile Postgres database." })
    .regex(/^postgres(ql)?:\/\//, "DATABASE_URL must start with postgres:// or postgresql://"),
  TURNSTILE_NETWORK: z
    .enum(["localnet", "devnet"], { error: "TURNSTILE_NETWORK must be localnet or devnet" })
    .default("localnet"),
  SOLANA_RPC_URL: z.url("SOLANA_RPC_URL must be an http or https URL").optional(),
  DEPLOYMENT_FILE: z.string().min(1).optional(),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
  INDEXER_START_SLOT: optionalInt("INDEXER_START_SLOT", 0, Number.MAX_SAFE_INTEGER).optional(),
  INDEXER_POLL_MS: optionalInt("INDEXER_POLL_MS", 50, 600_000).default(1000),
  INDEXER_STREAM: z
    .string()
    .regex(
      /^[\w:.-]{1,128}$/,
      "INDEXER_STREAM may hold letters, digits, colon, dot, dash and underscore, up to 128 characters",
    )
    .optional(),
  INDEXER_BATCH: optionalInt("INDEXER_BATCH", 1, 1000).default(200),
  INDEXER_MAX_BACKOFF_MS: optionalInt("INDEXER_MAX_BACKOFF_MS", 100, 3_600_000).default(30_000),
  INDEXER_READY_STALE_MS: optionalInt("INDEXER_READY_STALE_MS", 1000, 3_600_000).optional(),
});

export interface Config {
  port: number;
  databaseUrl: string;
  network: NetworkName;
  /** CAIP-2 id written to receipts.network. */
  networkId: string;
  rpcUrl: string;
  settlementProgram: PublicKey;
  logLevel: string;
  stream: string;
  startSlot: number | undefined;
  pollMs: number;
  batchSize: number;
  maxBackoffMs: number;
  /** Readiness fails when the last successful tick is older than this. */
  readyStaleMs: number;
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

function settlementFromDeployment(path: string): PublicKey | null {
  if (!existsSync(path)) {
    throw new ConfigError(
      `DEPLOYMENT_FILE points at ${path}, which does not exist. Deploy the programs first or unset DEPLOYMENT_FILE.`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new ConfigError(
      `DEPLOYMENT_FILE ${path} is not valid JSON (${(err as Error).message}). Fix the file or redeploy.`,
    );
  }
  const parsed = deploymentSchema.safeParse(raw);
  if (!parsed.success) {
    throw new ConfigError(`DEPLOYMENT_FILE ${path} is not a deployment object. Redeploy.`);
  }
  const id = parsed.data.programs?.settlement;
  if (!id) return null;
  try {
    return new PublicKey(id);
  } catch {
    throw new ConfigError(
      `DEPLOYMENT_FILE ${path} has programs.settlement "${id}", which is not a public key. Redeploy.`,
    );
  }
}

/** Reads and validates the environment. Throws a ConfigError that names every bad variable. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `${i.path.join(".") || "env"} ${i.message}`);
    throw new ConfigError(`Invalid indexer configuration.\n${lines.join("\n")}`);
  }
  const e = parsed.data;
  const network = NETWORKS[e.TURNSTILE_NETWORK];
  const pollMs = e.INDEXER_POLL_MS;
  return {
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    network: e.TURNSTILE_NETWORK,
    networkId: network.caip2,
    rpcUrl: e.SOLANA_RPC_URL ?? network.rpcUrl,
    settlementProgram:
      (e.DEPLOYMENT_FILE ? settlementFromDeployment(e.DEPLOYMENT_FILE) : null) ??
      SETTLEMENT_PROGRAM_ID,
    logLevel: e.LOG_LEVEL,
    stream: e.INDEXER_STREAM ?? `settlement:${e.TURNSTILE_NETWORK}`,
    startSlot: e.INDEXER_START_SLOT,
    pollMs,
    batchSize: e.INDEXER_BATCH,
    maxBackoffMs: e.INDEXER_MAX_BACKOFF_MS,
    readyStaleMs:
      e.INDEXER_READY_STALE_MS ?? Math.max(30_000, pollMs * 10, e.INDEXER_MAX_BACKOFF_MS * 2),
  };
}
