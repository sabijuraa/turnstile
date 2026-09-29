import { type ChildProcess, spawn } from "node:child_process";
import { createWriteStream, existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { type E2eEnv, REPO_ROOT, RESULTS_DIR, type ServiceUrls } from "./env.js";
import { SERVICE_NAMES } from "./ready.js";

interface ServiceSpec {
  key: keyof ServiceUrls;
  entry: string;
  env: Record<string, string>;
}

function portOf(url: string): string {
  const u = new URL(url);
  if (!u.port) throw new Error(`${url} has no port. Give every service URL an explicit port.`);
  return u.port;
}

/** The runtime contract from infra, the same variables docker compose passes. */
function specs(env: E2eEnv): ServiceSpec[] {
  const s = env.services;
  const key = (name: string) => join(env.keysDir, name);
  return [
    {
      key: "facilitator",
      entry: "packages/facilitator/dist/main.js",
      env: {
        PORT: portOf(s.facilitator),
        FACILITATOR_KEYPAIR: key("facilitator.json"),
        FACILITATOR_PUBLIC_URL: s.facilitator,
      },
    },
    {
      key: "demoApi",
      entry: "packages/demo-api/dist/main.js",
      env: { PORT: portOf(s.demoApi), DEMO_API_PUBLIC_URL: s.demoApi },
    },
    {
      key: "demoAgent",
      entry: "packages/demo-api/dist/agent-main.js",
      env: {
        PORT: portOf(s.demoAgent),
        DEMO_API_URL: s.demoApi,
        DEMO_OWNER_KEYPAIR: key("demo-owner.json"),
        DEMO_SESSION_KEYPAIR: key("demo-session.json"),
        WEB_ORIGIN: env.webOrigin,
      },
    },
    { key: "indexer", entry: "packages/indexer/dist/main.js", env: { PORT: portOf(s.indexer) } },
    {
      key: "backend",
      entry: "packages/backend/dist/main.js",
      env: { PORT: portOf(s.backend), WEB_ORIGIN: env.webOrigin },
    },
  ];
}

export interface StartedServices {
  stop(): Promise<void>;
  logsDir: string;
}

/**
 * Starts every Node service from its build output, for E2E_STACK=infra where compose runs only
 * the validator, Postgres and the bootstrap. Logs go to results/logs.
 */
export function startServices(env: E2eEnv): StartedServices {
  const logsDir = join(RESULTS_DIR, "logs");
  mkdirSync(logsDir, { recursive: true });
  const list = specs(env);
  const missing = list.filter((s) => !existsSync(join(REPO_ROOT, s.entry)));
  if (missing.length > 0) {
    throw new Error(
      `These service builds are missing: ${missing.map((m) => m.entry).join(", ")}. Run 'pnpm --filter @turnstile/e2e... build' first.`,
    );
  }
  const children: ChildProcess[] = [];
  for (const spec of list) {
    const log = createWriteStream(join(logsDir, `${SERVICE_NAMES[spec.key]}.log`));
    const child = spawn(process.execPath, [join(REPO_ROOT, spec.entry)], {
      cwd: REPO_ROOT,
      env: {
        PATH: process.env.PATH ?? "",
        NODE_ENV: "production",
        LOG_LEVEL: process.env.LOG_LEVEL ?? "info",
        TURNSTILE_NETWORK: "localnet",
        DATABASE_URL: env.databaseUrl,
        SOLANA_RPC_URL: env.rpcUrl,
        SOLANA_WS_URL: env.wsUrl,
        DEPLOYMENT_FILE: env.deploymentFile,
        FACILITATOR_URL: env.services.facilitator,
        ...spec.env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    child.stdout?.pipe(log);
    child.stderr?.pipe(log);
    children.push(child);
  }
  return {
    logsDir,
    async stop() {
      await Promise.all(
        children.map(
          (child) =>
            new Promise<void>((resolve) => {
              if (child.exitCode !== null || child.signalCode !== null) return resolve();
              const timer = setTimeout(() => child.kill("SIGKILL"), 10_000);
              child.once("exit", () => {
                clearTimeout(timer);
                resolve();
              });
              child.kill("SIGTERM");
            }),
        ),
      );
    },
  };
}
