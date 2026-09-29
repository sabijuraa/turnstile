import { loadDeployment, loadEnv } from "./env.js";
import { waitForStack } from "./ready.js";
import { type StartedServices, startServices } from "./services.js";

/**
 * Runs once before the suite. With E2E_STACK=full it only waits for the running stack. With
 * E2E_STACK=infra it starts the Node services first, since that mode brings up only the
 * validator, Postgres and the bootstrap.
 */
export default async function setup(): Promise<() => Promise<void>> {
  const env = loadEnv();
  const timeoutMs = Number(process.env.E2E_READY_TIMEOUT_MS ?? 120_000);
  loadDeployment(env.deploymentFile);
  let started: StartedServices | null = null;
  if (env.stack === "infra" && process.env.E2E_START_SERVICES !== "0") {
    started = startServices(env);
  }
  try {
    await waitForStack(env, timeoutMs);
  } catch (err) {
    await started?.stop();
    const hint = started ? `\nService logs are in ${started.logsDir}.` : "";
    throw new Error(`${(err as Error).message}${hint}`);
  }
  return async () => {
    await started?.stop();
  };
}
