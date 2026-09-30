/**
 * Server side access to the demo agent runner. The browser never calls the runner directly. It
 * goes through the same origin proxy in app/demo/api, which uses these helpers.
 */
import {
  type DemoPolicyView,
  isPolicy,
  parseApiError,
  parseSnapshot,
  type RunSnapshot,
} from "./events";

/** Base URL of the runner, without a trailing slash, or null when it is not configured. */
export function runnerBaseUrl(): string | null {
  const raw = process.env.TURNSTILE_DEMO_AGENT_URL?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.toString().replace(/\/+$/, "");
  } catch {
    // An unparsable URL is the same as a missing one for callers. The page says it is offline.
    return null;
  }
}

export type RunnerUnavailable = "not_configured" | "unreachable" | "bad_response";

export type RunnerResult<T> = { ok: true; value: T } | { ok: false; problem: RunnerUnavailable };

const READ_TIMEOUT_MS = 4000;

async function readJson(
  path: string,
): Promise<{ status: number; body: unknown } | RunnerUnavailable> {
  const base = runnerBaseUrl();
  if (!base) return "not_configured";
  let res: Response;
  try {
    res = await fetch(`${base}${path}`, {
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(READ_TIMEOUT_MS),
    });
  } catch (err) {
    console.error(`The demo agent at ${base} did not answer GET ${path}.`, err);
    return "unreachable";
  }
  try {
    return { status: res.status, body: await res.json() };
  } catch (err) {
    console.error(`The demo agent answered GET ${path} with a body that is not JSON.`, err);
    return "bad_response";
  }
}

/** The last run with its events. `null` means the runner answered and there has never been a run. */
export async function loadLatestRun(): Promise<RunnerResult<RunSnapshot | null>> {
  const got = await readJson("/runs/latest");
  if (typeof got === "string") return { ok: false, problem: got };
  if (got.status === 404 && parseApiError(got.body)?.code === "no_runs") {
    return { ok: true, value: null };
  }
  if (got.status !== 200) return { ok: false, problem: "bad_response" };
  const snapshot = parseSnapshot(got.body);
  return snapshot ? { ok: true, value: snapshot } : { ok: false, problem: "bad_response" };
}

/** The policy every demo run sets on its fresh agent wallet. */
export async function loadPolicy(): Promise<RunnerResult<DemoPolicyView>> {
  const got = await readJson("/policy");
  if (typeof got === "string") return { ok: false, problem: got };
  if (got.status !== 200 || !isPolicy(got.body)) return { ok: false, problem: "bad_response" };
  return { ok: true, value: got.body };
}
