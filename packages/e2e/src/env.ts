import { existsSync, readFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Repository root, found from this file so the suite runs from any working directory. */
export const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
export const E2E_ROOT = join(REPO_ROOT, "packages/e2e");
export const RESULTS_DIR = join(E2E_ROOT, "results");

export type StackMode = "full" | "infra";

export interface ServiceUrls {
  facilitator: string;
  demoApi: string;
  backend: string;
  indexer: string;
  demoAgent: string;
}

export interface E2eEnv {
  stack: StackMode;
  rpcUrl: string;
  wsUrl: string;
  databaseUrl: string;
  deploymentFile: string;
  keysDir: string;
  /** Origin the backend accepts writes from and puts in the sign-in message. */
  webOrigin: string;
  services: ServiceUrls;
}

/** The public part of deployments/<network>.json that the suite reads. */
export interface Deployment {
  network: string;
  caip2: string;
  programs: { agentWallet: string; settlement: string };
  mint: string;
  mintDecimals: number;
  facilitator: string;
  demoOwner: string;
  demoSession: string;
  demoRecipient: string;
}

function trim(url: string): string {
  return url.replace(/\/+$/, "");
}

function pathFromEnv(value: string | undefined, fallback: string): string {
  if (!value) return join(REPO_ROOT, fallback);
  return isAbsolute(value) ? value : resolve(process.cwd(), value);
}

/** Endpoints of the running stack. Defaults are the compose ports from docs/SYSTEM_DESIGN.md. */
export function loadEnv(env: NodeJS.ProcessEnv = process.env): E2eEnv {
  const stack = env.E2E_STACK ?? "full";
  if (stack !== "full" && stack !== "infra") {
    throw new Error(`E2E_STACK must be full or infra, not "${stack}".`);
  }
  const rpcUrl = trim(env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899");
  const rpc = new URL(rpcUrl);
  const defaultWs = `ws://${rpc.hostname}:${Number(rpc.port || 8899) + 1}`;
  return {
    stack,
    rpcUrl,
    wsUrl: env.SOLANA_WS_URL ?? defaultWs,
    databaseUrl: env.DATABASE_URL ?? "postgres://turnstile:turnstile@127.0.0.1:5433/turnstile",
    deploymentFile: pathFromEnv(env.DEPLOYMENT_FILE, "deployments/localnet.json"),
    keysDir: pathFromEnv(env.KEYS_DIR, "keys/localnet"),
    webOrigin: trim(env.WEB_ORIGIN ?? "http://localhost:3000"),
    services: {
      facilitator: trim(env.FACILITATOR_URL ?? "http://127.0.0.1:4020"),
      demoApi: trim(env.DEMO_API_URL ?? "http://127.0.0.1:4021"),
      backend: trim(env.BACKEND_URL ?? "http://127.0.0.1:4022"),
      indexer: trim(env.INDEXER_URL ?? "http://127.0.0.1:4023"),
      demoAgent: trim(env.DEMO_AGENT_URL ?? "http://127.0.0.1:4024"),
    },
  };
}

export function loadDeployment(path: string): Deployment {
  if (!existsSync(path)) {
    throw new Error(
      `The deployment file ${path} does not exist. Run the localnet bootstrap first, or set DEPLOYMENT_FILE.`,
    );
  }
  const raw = JSON.parse(readFileSync(path, "utf8")) as Partial<Deployment>;
  const missing = [
    "network",
    "caip2",
    "programs",
    "mint",
    "mintDecimals",
    "facilitator",
    "demoOwner",
    "demoSession",
    "demoRecipient",
  ].filter((k) => raw[k as keyof Deployment] === undefined);
  if (missing.length > 0) {
    throw new Error(
      `The deployment file ${path} lacks ${missing.join(", ")}. Run the localnet bootstrap again.`,
    );
  }
  return raw as Deployment;
}
