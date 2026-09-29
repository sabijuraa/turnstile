import { Hono } from "hono";
import type { Indexer } from "./indexer.js";
import type { Logger } from "./logger.js";
import type { IndexerMetrics } from "./metrics.js";
import type { Queryable } from "./store.js";

const CHECK_TIMEOUT_MS = 3000;

export interface AppDeps {
  indexer: Indexer;
  pool: Pick<Queryable, "query">;
  metrics: IndexerMetrics;
  logger: Logger;
  /** Readiness fails when the last successful tick is older than this. */
  readyStaleMs: number;
  clock?: () => number;
}

interface Check {
  ok: boolean;
  ms: number;
  error?: string;
}

async function timed(fn: () => Promise<unknown>): Promise<Check> {
  const started = performance.now();
  let timer: NodeJS.Timeout | undefined;
  try {
    await Promise.race([
      fn(),
      new Promise((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`no answer within ${CHECK_TIMEOUT_MS} ms`)),
          CHECK_TIMEOUT_MS,
        );
      }),
    ]);
    return { ok: true, ms: Math.round(performance.now() - started) };
  } catch (err) {
    return {
      ok: false,
      ms: Math.round(performance.now() - started),
      error: err instanceof Error && err.message ? err.message : String(err),
    };
  } finally {
    clearTimeout(timer);
  }
}

/** Health, readiness and metrics for the indexer. Runs under @hono/node-server or any fetch host. */
export function createApp(deps: AppDeps): Hono {
  const clock = deps.clock ?? Date.now;
  const app = new Hono();

  app.get("/healthz", (c) => c.json({ status: "ok", service: "indexer" }));

  app.get("/readyz", async (c) => {
    const database = await timed(() => deps.pool.query("SELECT 1"));
    const s = deps.indexer.status();
    const now = clock();
    const ageMs = s.lastSuccessAt === null ? null : now - s.lastSuccessAt;
    let indexerError: string | undefined;
    if (ageMs === null) {
      indexerError =
        s.lastResult?.error?.message ??
        "No tick has succeeded yet. Check the logs for RPC or database errors.";
    } else if (ageMs > deps.readyStaleMs) {
      indexerError =
        `The last successful tick was ${Math.round(ageMs / 1000)} s ago, over the ${Math.round(deps.readyStaleMs / 1000)} s limit. ${s.lastResult?.error?.message ?? ""}`.trim();
    }
    const last = s.lastResult;
    const indexer = {
      ok: indexerError === undefined,
      stream: s.stream,
      lastSuccessAt: s.lastSuccessAt === null ? null : new Date(s.lastSuccessAt).toISOString(),
      consecutiveFailures: s.consecutiveFailures,
      checkpoint: last?.checkpoint ?? null,
      lagSlots: last?.lagSlots ?? null,
      ...(indexerError ? { error: indexerError } : {}),
    };
    const ready = database.ok && indexer.ok;
    const failed = [!database.ok && "database", !indexer.ok && "indexer"].filter(Boolean);
    if (!ready) deps.logger.warn({ database, indexer }, "not ready");
    return c.json(
      {
        status: ready ? "ready" : "unavailable",
        ...(ready ? {} : { failed }),
        checks: { database, indexer },
      },
      ready ? 200 : 503,
    );
  });

  app.get("/metrics", async (c) => {
    const body = await deps.metrics.registry.metrics();
    return c.body(body, 200, { "content-type": deps.metrics.registry.contentType });
  });

  app.notFound((c) =>
    c.json(
      {
        error: {
          code: "not_found",
          message: `${c.req.method} ${c.req.path} is not an indexer endpoint. Use /healthz, /readyz or /metrics.`,
        },
      },
      404,
    ),
  );

  return app;
}
