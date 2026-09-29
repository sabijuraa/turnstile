import { existsSync, readFileSync } from "node:fs";
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  AGENT_WALLET_PROGRAM_ID,
  NETWORKS,
  type NetworkName,
  SETTLEMENT_PROGRAM_ID,
} from "@turnstile/shared";
import { z } from "zod";

const base58Key = z.string().refine((v) => {
  try {
    return new PublicKey(v).toBase58() === v;
  } catch {
    return false;
  }
}, "must be a base58 Solana address");

const deploymentSchema = z.looseObject({
  network: z.enum(["localnet", "devnet"], { error: "network must be localnet or devnet" }),
  caip2: z
    .string()
    .regex(/^solana:\w+$/, "caip2 must look like solana:<id>")
    .optional(),
  programs: z.object({ agentWallet: base58Key, settlement: base58Key }),
  mint: base58Key,
  mintDecimals: z.number().int().min(0).max(18),
  facilitator: base58Key.optional(),
  demoRecipient: base58Key.optional(),
});

export type Deployment = z.infer<typeof deploymentSchema>;

const envSchema = z.object({
  PORT: z.coerce
    .number()
    .int()
    .min(1, "PORT must be between 1 and 65535")
    .max(65535, "PORT must be between 1 and 65535")
    .default(4020),
  DATABASE_URL: z
    .string({ error: "DATABASE_URL is not set. Point it at the Turnstile Postgres database." })
    .regex(/^postgres(ql)?:\/\//, "DATABASE_URL must start with postgres:// or postgresql://"),
  TURNSTILE_NETWORK: z
    .enum(["localnet", "devnet"], { error: "TURNSTILE_NETWORK must be localnet or devnet" })
    .default("localnet"),
  SOLANA_RPC_URL: z.url("SOLANA_RPC_URL must be an http or https URL").optional(),
  SOLANA_WS_URL: z.url("SOLANA_WS_URL must be a ws or wss URL").optional(),
  DEPLOYMENT_FILE: z.string({
    error: "DEPLOYMENT_FILE is not set. Point it at deployments/<network>.json.",
  }),
  FACILITATOR_KEYPAIR: z.string({
    error: "FACILITATOR_KEYPAIR is not set. Point it at the fee payer keypair JSON file.",
  }),
  FACILITATOR_PUBLIC_URL: z
    .url("FACILITATOR_PUBLIC_URL must be the full URL other services use to reach the facilitator")
    .default("http://127.0.0.1:4020"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export interface Config {
  port: number;
  databaseUrl: string;
  network: NetworkName;
  /** CAIP-2 id put in every payment requirement. */
  caip2: string;
  rpcUrl: string;
  wsUrl: string;
  deployment: Deployment;
  mint: PublicKey;
  mintDecimals: number;
  settlementProgram: PublicKey;
  agentWalletProgram: PublicKey;
  /** Base URL without a trailing slash. */
  publicUrl: string;
  logLevel: string;
  /** Default and upper bound for maxTimeoutSeconds in requirements. */
  defaultTimeoutSeconds: number;
  maxTimeoutSeconds: number;
  /** Largest request body the facilitator reads. */
  bodyLimitBytes: number;
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

export function loadDeployment(path: string): Deployment {
  if (!existsSync(path)) {
    throw new ConfigError(
      `DEPLOYMENT_FILE points at ${path}, which does not exist. Deploy the programs and run the bootstrap first.`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new ConfigError(
      `DEPLOYMENT_FILE ${path} is not valid JSON (${(err as Error).message}). Fix the file or run the bootstrap again.`,
    );
  }
  const parsed = deploymentSchema.safeParse(raw);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`);
    throw new ConfigError(
      `DEPLOYMENT_FILE ${path} is not a valid deployment record.\n${lines.join("\n")}`,
    );
  }
  return parsed.data;
}

/**
 * Reads a Solana CLI keypair file. The error never includes file contents, so a
 * malformed secret key cannot leak into logs.
 */
export function loadKeypair(path: string): Keypair {
  if (!existsSync(path)) {
    throw new ConfigError(
      `FACILITATOR_KEYPAIR points at ${path}, which does not exist. Run the bootstrap or create one with solana-keygen new.`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch {
    throw new ConfigError(`FACILITATOR_KEYPAIR ${path} is not valid JSON. Replace the file.`);
  }
  if (
    !Array.isArray(raw) ||
    raw.length !== 64 ||
    !raw.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
  ) {
    throw new ConfigError(
      `FACILITATOR_KEYPAIR ${path} is not a 64 byte Solana keypair file. Replace the file.`,
    );
  }
  try {
    return Keypair.fromSecretKey(Uint8Array.from(raw as number[]));
  } catch {
    throw new ConfigError(
      `FACILITATOR_KEYPAIR ${path} holds bytes that are not a valid Ed25519 keypair. Replace the file.`,
    );
  }
}

export interface LoadedConfig {
  config: Config;
  feePayer: Keypair;
}

/** Reads and validates the environment. Throws a ConfigError that names every bad variable. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): LoadedConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `${i.path.join(".") || "env"} ${i.message}`);
    throw new ConfigError(`Invalid facilitator configuration.\n${lines.join("\n")}`);
  }
  const e = parsed.data;
  const deployment = loadDeployment(e.DEPLOYMENT_FILE);
  if (deployment.network !== e.TURNSTILE_NETWORK) {
    throw new ConfigError(
      `DEPLOYMENT_FILE is for ${deployment.network} but TURNSTILE_NETWORK is ${e.TURNSTILE_NETWORK}. Point them at the same network.`,
    );
  }
  const settlementProgram = new PublicKey(deployment.programs.settlement);
  const agentWalletProgram = new PublicKey(deployment.programs.agentWallet);
  if (
    !settlementProgram.equals(SETTLEMENT_PROGRAM_ID) ||
    !agentWalletProgram.equals(AGENT_WALLET_PROGRAM_ID)
  ) {
    throw new ConfigError(
      "The program ids in DEPLOYMENT_FILE differ from the ids in @turnstile/shared. Deploy with the repository program keypairs or update the shared constants.",
    );
  }
  const feePayer = loadKeypair(e.FACILITATOR_KEYPAIR);
  const net = NETWORKS[e.TURNSTILE_NETWORK];
  const rpcUrl = e.SOLANA_RPC_URL ?? net.rpcUrl;
  return {
    feePayer,
    config: {
      port: e.PORT,
      databaseUrl: e.DATABASE_URL,
      network: e.TURNSTILE_NETWORK,
      caip2: deployment.caip2 ?? net.caip2,
      rpcUrl,
      wsUrl: e.SOLANA_WS_URL ?? (e.SOLANA_RPC_URL ? deriveWsUrl(rpcUrl) : net.wsUrl),
      deployment,
      mint: new PublicKey(deployment.mint),
      mintDecimals: deployment.mintDecimals,
      settlementProgram,
      agentWalletProgram,
      publicUrl: e.FACILITATOR_PUBLIC_URL.replace(/\/+$/, ""),
      logLevel: e.LOG_LEVEL,
      defaultTimeoutSeconds: 60,
      maxTimeoutSeconds: 3600,
      bodyLimitBytes: 64 * 1024,
    },
  };
}

/** The validator serves websockets on the RPC port plus one. */
function deriveWsUrl(rpcUrl: string): string {
  const u = new URL(rpcUrl);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  if (u.port) u.port = String(Number(u.port) + 1);
  return u.toString().replace(/\/$/, "");
}
