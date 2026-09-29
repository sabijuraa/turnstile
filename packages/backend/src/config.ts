import { existsSync, readFileSync } from "node:fs";
import { NETWORKS, type NetworkName } from "@turnstile/shared";
import { z } from "zod";

const deploymentSchema = z.looseObject({
  network: z.string().optional(),
  mint: z.string().optional(),
});

export type Deployment = z.infer<typeof deploymentSchema>;

const envSchema = z.object({
  PORT: z.coerce
    .number()
    .int()
    .min(1, "PORT must be between 1 and 65535")
    .max(65535, "PORT must be between 1 and 65535")
    .default(4022),
  DATABASE_URL: z
    .string({ error: "DATABASE_URL is not set. Point it at the Turnstile Postgres database." })
    .regex(/^postgres(ql)?:\/\//, "DATABASE_URL must start with postgres:// or postgresql://"),
  TURNSTILE_NETWORK: z
    .enum(["localnet", "devnet"], { error: "TURNSTILE_NETWORK must be localnet or devnet" })
    .default("localnet"),
  SOLANA_RPC_URL: z.url("SOLANA_RPC_URL must be an http or https URL").optional(),
  DEPLOYMENT_FILE: z.string().min(1).optional(),
  WEB_ORIGIN: z
    .url("WEB_ORIGIN must be the full origin of the web app, for example http://localhost:3000")
    .default("http://localhost:3000"),
  COOKIE_SECURE: z
    .enum(["true", "false"], { error: "COOKIE_SECURE must be true or false" })
    .default("false"),
  LOG_LEVEL: z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]).default("info"),
});

export interface Config {
  port: number;
  databaseUrl: string;
  network: NetworkName;
  rpcUrl: string;
  deployment: Deployment | null;
  webOrigin: string;
  /** Host of the web origin. Shown in the sign-in message so the owner knows which site asks. */
  domain: string;
  cookieSecure: boolean;
  logLevel: string;
  /** How long a sign-in challenge stays valid. */
  challengeTtlSeconds: number;
  /** How long a console session lasts. */
  sessionTtlSeconds: number;
}

export class ConfigError extends Error {
  override name = "ConfigError";
}

function loadDeployment(path: string): Deployment {
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
  return parsed.data;
}

/** Reads and validates the environment. Throws a ConfigError that names every bad variable. */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const lines = parsed.error.issues.map((i) => `${i.path.join(".") || "env"} ${i.message}`);
    throw new ConfigError(`Invalid backend configuration.\n${lines.join("\n")}`);
  }
  const e = parsed.data;
  const origin = new URL(e.WEB_ORIGIN);
  return {
    port: e.PORT,
    databaseUrl: e.DATABASE_URL,
    network: e.TURNSTILE_NETWORK,
    rpcUrl: e.SOLANA_RPC_URL ?? NETWORKS[e.TURNSTILE_NETWORK].rpcUrl,
    deployment: e.DEPLOYMENT_FILE ? loadDeployment(e.DEPLOYMENT_FILE) : null,
    webOrigin: origin.origin,
    domain: origin.host,
    cookieSecure: e.COOKIE_SECURE === "true",
    logLevel: e.LOG_LEVEL,
    challengeTtlSeconds: 300,
    sessionTtlSeconds: 12 * 60 * 60,
  };
}
