import pg from "pg";
import type { E2eEnv, ServiceUrls } from "./env.js";

export const SERVICE_NAMES: Record<keyof ServiceUrls, string> = {
  facilitator: "facilitator",
  demoApi: "demo-api",
  backend: "backend",
  indexer: "indexer",
  demoAgent: "demo-agent",
};

interface ProbeResult {
  ok: boolean;
  detail: string;
}

async function probeHttp(url: string): Promise<ProbeResult> {
  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5_000) });
    const body = (await res.text()).slice(0, 300);
    return { ok: res.status === 200, detail: `HTTP ${res.status} ${body}` };
  } catch (err) {
    const cause = (err as { cause?: { code?: string } }).cause?.code;
    return { ok: false, detail: cause ?? (err as Error).message };
  }
}

async function probeRpc(rpcUrl: string): Promise<ProbeResult> {
  try {
    const res = await fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getHealth" }),
      signal: AbortSignal.timeout(5_000),
    });
    const body = (await res.json()) as { result?: string; error?: { message: string } };
    return body.result === "ok"
      ? { ok: true, detail: "ok" }
      : { ok: false, detail: body.error?.message ?? JSON.stringify(body) };
  } catch (err) {
    const cause = (err as { cause?: { code?: string } }).cause?.code;
    return { ok: false, detail: cause ?? (err as Error).message };
  }
}

async function probeDatabase(url: string): Promise<ProbeResult> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 5_000 });
  try {
    await client.connect();
    await client.query("SELECT 1 FROM receipts LIMIT 1");
    return { ok: true, detail: "ok" };
  } catch (err) {
    return { ok: false, detail: (err as Error).message };
  } finally {
    await client.end().catch(() => undefined);
  }
}

/**
 * Polls the validator, Postgres and every service /readyz until all answer or the timeout
 * passes. Throws one error that names every dependency still not ready and why.
 */
export async function waitForStack(
  env: E2eEnv,
  timeoutMs: number,
  only?: ReadonlyArray<keyof ServiceUrls>,
): Promise<void> {
  const names = only ?? (Object.keys(env.services) as Array<keyof ServiceUrls>);
  const probes: Record<string, () => Promise<ProbeResult>> = {
    [`validator (${env.rpcUrl})`]: () => probeRpc(env.rpcUrl),
    [`postgres (${env.databaseUrl.replace(/:[^:@/]+@/, ":***@")})`]: () =>
      probeDatabase(env.databaseUrl),
  };
  for (const name of names) {
    const url = `${env.services[name]}/readyz`;
    probes[`${SERVICE_NAMES[name]} (${url})`] = () => probeHttp(url);
  }
  const deadline = Date.now() + timeoutMs;
  let pending = Object.keys(probes);
  const last = new Map<string, string>();
  while (pending.length > 0) {
    const results = await Promise.all(pending.map((n) => probes[n]?.() ?? null));
    const still: string[] = [];
    pending.forEach((name, i) => {
      const r = results[i];
      if (!r?.ok) {
        still.push(name);
        last.set(name, r?.detail ?? "no probe");
      }
    });
    pending = still;
    if (pending.length === 0) return;
    if (Date.now() > deadline) break;
    await new Promise((r) => setTimeout(r, 1_000));
  }
  const lines = pending.map((n) => `  - ${n}: ${last.get(n)}`);
  throw new Error(
    [
      `The stack is not ready after ${Math.round(timeoutMs / 1000)} s. These did not answer ready:`,
      ...lines,
      "Start the stack with 'pnpm stack:up' (or 'E2E_STACK=infra infra/scripts/e2e.sh'), or point the suite at it with SOLANA_RPC_URL, DATABASE_URL and the *_URL variables. See packages/e2e/README.md.",
    ].join("\n"),
  );
}
