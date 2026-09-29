import { existsSync, readFileSync } from "node:fs";
import { PublicKey } from "@solana/web3.js";
import { NETWORKS, type NetworkName, parseUnits } from "@turnstile/shared";
import { z } from "zod";

export class ConfigError extends Error {
  override name = "ConfigError";
}

const base58Key = z.string().refine((v) => {
  try {
    return new PublicKey(v).toBase58() === v;
  } catch {
    return false;
  }
}, "must be a base58 Solana address");

const deploymentSchema = z.looseObject({
  network: z.enum(["localnet", "devnet"], { error: "network must be localnet or devnet" }),
  caip2: z.string().optional(),
  programs: z.object({ agentWallet: base58Key, settlement: base58Key }),
  mint: base58Key,
  mintDecimals: z.number().int().min(0).max(18),
  demoOwner: base58Key,
  demoSession: base58Key,
  demoRecipient: base58Key,
});

export type Deployment = z.infer<typeof deploymentSchema>;

export function loadDeployment(path: string): Deployment {
  if (!existsSync(path)) {
    throw new ConfigError(
      `DEPLOYMENT_FILE points at ${path}, which does not exist. Run the localnet bootstrap first.`,
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
      `DEPLOYMENT_FILE ${path} is missing fields the demo needs.\n${lines.join("\n")}`,
    );
  }
  return parsed.data;
}

const port = (fallback: number) =>
  z.coerce
    .number()
    .int()
    .min(1, "PORT must be between 1 and 65535")
    .max(65535, "PORT must be between 1 and 65535")
    .default(fallback);

const logLevel = z
  .enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"])
  .default("info");
const network = z
  .enum(["localnet", "devnet"], { error: "TURNSTILE_NETWORK must be localnet or devnet" })
  .default("localnet");
const deploymentFile = z.string({
  error: "DEPLOYMENT_FILE is not set. Point it at deployments/<network>.json.",
});

function parseEnv<T extends z.ZodType>(
  schema: T,
  env: NodeJS.ProcessEnv,
  what: string,
): z.infer<T> {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `${i.path.join(".") || "env"} ${i.message}`);
    throw new ConfigError(`Invalid ${what} configuration.\n${lines.join("\n")}`);
  }
  return parsed.data;
}

const apiEnvSchema = z.object({
  PORT: port(4021),
  TURNSTILE_NETWORK: network,
  DEPLOYMENT_FILE: deploymentFile,
  FACILITATOR_URL: z
    .url("FACILITATOR_URL must be the facilitator base URL, for example http://127.0.0.1:4020")
    .default("http://127.0.0.1:4020"),
  DEMO_API_PUBLIC_URL: z
    .url("DEMO_API_PUBLIC_URL must be the URL agents use to reach this API")
    .default("http://127.0.0.1:4021"),
  DEMO_PRICE: z
    .string()
    .regex(/^\d+(\.\d+)?$/, "DEMO_PRICE must be a decimal amount such as 0.005")
    .default("0.005"),
  LOG_LEVEL: logLevel,
});

export interface ApiConfig {
  port: number;
  network: NetworkName;
  deployment: Deployment;
  facilitatorUrl: string;
  /** Origin and optional base path, no trailing slash. */
  publicUrl: string;
  /** Price per call as a decimal string. */
  price: string;
  priceBaseUnits: bigint;
  payTo: string;
  logLevel: string;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, "");
}

export function loadApiConfig(env: NodeJS.ProcessEnv = process.env): ApiConfig {
  const e = parseEnv(apiEnvSchema, env, "demo API");
  const deployment = loadDeployment(e.DEPLOYMENT_FILE);
  let priceBaseUnits: bigint;
  try {
    priceBaseUnits = parseUnits(e.DEMO_PRICE, deployment.mintDecimals);
  } catch (err) {
    throw new ConfigError(`DEMO_PRICE is not usable. ${(err as Error).message}.`);
  }
  if (priceBaseUnits <= 0n) throw new ConfigError("DEMO_PRICE must be above zero.");
  return {
    port: e.PORT,
    network: e.TURNSTILE_NETWORK,
    deployment,
    facilitatorUrl: trimSlash(e.FACILITATOR_URL),
    publicUrl: trimSlash(e.DEMO_API_PUBLIC_URL),
    price: e.DEMO_PRICE,
    priceBaseUnits,
    payTo: deployment.demoRecipient,
    logLevel: e.LOG_LEVEL,
  };
}

const agentEnvSchema = z.object({
  PORT: port(4024),
  TURNSTILE_NETWORK: network,
  DATABASE_URL: z
    .string({ error: "DATABASE_URL is not set. Point it at the Turnstile Postgres database." })
    .regex(/^postgres(ql)?:\/\//, "DATABASE_URL must start with postgres:// or postgresql://"),
  SOLANA_RPC_URL: z.url("SOLANA_RPC_URL must be an http or https URL").optional(),
  DEPLOYMENT_FILE: deploymentFile,
  FACILITATOR_URL: z
    .url("FACILITATOR_URL must be the facilitator base URL")
    .default("http://127.0.0.1:4020"),
  DEMO_API_URL: z
    .url("DEMO_API_URL must be the base URL of the demo API, for example http://127.0.0.1:4021")
    .default("http://127.0.0.1:4021"),
  DEMO_OWNER_KEYPAIR: z.string({
    error: "DEMO_OWNER_KEYPAIR is not set. Point it at keys/localnet/demo-owner.json.",
  }),
  DEMO_SESSION_KEYPAIR: z.string({
    error: "DEMO_SESSION_KEYPAIR is not set. Point it at keys/localnet/demo-session.json.",
  }),
  WEB_ORIGIN: z
    .url("WEB_ORIGIN must be the full origin of the web app, for example http://localhost:3000")
    .default("http://localhost:3000"),
  LOG_LEVEL: logLevel,
});

export interface AgentConfig {
  port: number;
  network: NetworkName;
  databaseUrl: string;
  rpcUrl: string;
  deployment: Deployment;
  facilitatorUrl: string;
  demoApiUrl: string;
  ownerKeypairPath: string;
  sessionKeypairPath: string;
  webOrigins: string[];
  logLevel: string;
}

export function loadAgentConfig(env: NodeJS.ProcessEnv = process.env): AgentConfig {
  const e = parseEnv(agentEnvSchema, env, "demo agent");
  return {
    port: e.PORT,
    network: e.TURNSTILE_NETWORK,
    databaseUrl: e.DATABASE_URL,
    rpcUrl: e.SOLANA_RPC_URL ?? NETWORKS[e.TURNSTILE_NETWORK].rpcUrl,
    deployment: loadDeployment(e.DEPLOYMENT_FILE),
    facilitatorUrl: trimSlash(e.FACILITATOR_URL),
    demoApiUrl: trimSlash(e.DEMO_API_URL),
    ownerKeypairPath: e.DEMO_OWNER_KEYPAIR,
    sessionKeypairPath: e.DEMO_SESSION_KEYPAIR,
    webOrigins: [new URL(e.WEB_ORIGIN).origin],
    logLevel: e.LOG_LEVEL,
  };
}
