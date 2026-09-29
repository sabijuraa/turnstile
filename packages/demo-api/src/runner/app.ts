import { Hono } from "hono";
import { cors } from "hono/cors";
import { streamSSE } from "hono/streaming";
import { errorBody } from "../errors.js";
import { type Check, type HttpEnv, installHttpBasics, timedCheck } from "../http.js";
import type { Logger } from "../logger.js";
import type { RunnerMetrics } from "../metrics.js";
import { DemoRunError } from "./demo-chain.js";
import { type RunEvent, TERMINAL_EVENTS } from "./events.js";
import type { DemoRunner } from "./run.js";
import { RunBusyError, type RunStore } from "./store.js";

export interface RunnerAppDeps {
  runner: DemoRunner;
  store: RunStore;
  logger: Logger;
  metrics: RunnerMetrics;
  webOrigins: string[];
  /** Named readiness probes, for example database, solana and demo API. */
  readiness: Record<string, () => Promise<unknown>>;
  /** Interval of SSE keepalive comments. */
  keepaliveMs?: number;
}

const RUN_ID = /^[0-9a-f-]{36}$/;

/** HTTP face of the demo agent. Starts runs and streams what happens in them. */
export function createRunnerApp(deps: RunnerAppDeps): Hono<HttpEnv> {
  const { runner, store, logger, metrics } = deps;
  const keepaliveMs = deps.keepaliveMs ?? 15_000;
  const app = new Hono<HttpEnv>();
  installHttpBasics(
    app,
    logger,
    metrics,
    "demo agent",
    "The demo agent serves POST /runs, GET /runs/latest, GET /runs/:id/events and GET /policy.",
  );
  app.use(
    "*",
    cors({
      origin: deps.webOrigins,
      allowMethods: ["GET", "POST", "OPTIONS"],
      allowHeaders: ["Content-Type", "Last-Event-ID", "X-Request-Id"],
      exposeHeaders: ["X-Request-Id"],
      maxAge: 600,
    }),
  );

  app.get("/healthz", (c) => c.json({ status: "ok", service: "demo-agent" }));

  app.get("/readyz", async (c) => {
    const entries = Object.entries(deps.readiness);
    const results = await Promise.all(entries.map(([, probe]) => timedCheck(probe)));
    const checks: Record<string, Check> = {};
    entries.forEach(([name], i) => {
      const r = results[i];
      if (r) checks[name] = r;
    });
    const names = entries.map(([name]) => name);
    const failed = names.filter((n) => !checks[n]?.ok);
    const ready = failed.length === 0;
    if (!ready) c.get("log").warn({ checks }, "not ready");
    return c.json(
      { status: ready ? "ready" : "unavailable", ...(ready ? {} : { failed }), checks },
      ready ? 200 : 503,
    );
  });

  app.get("/metrics", async (c) => {
    const body = await metrics.registry.metrics();
    return c.body(body, 200, { "content-type": metrics.registry.contentType });
  });

  app.get("/policy", async (c) => {
    try {
      return c.json(await runner.policy());
    } catch (err) {
      c.get("log").warn({ err }, "could not read the demo API catalog");
      return c.json(
        errorBody(
          "demo_api_unreachable",
          "The demo agent could not read the demo API catalog, which names the paid resources. Check that the demo API is running.",
        ),
        503,
      );
    }
  });

  app.post("/runs", async (c) => {
    try {
      const run = await runner.start();
      return c.json({ runId: run.id }, 202);
    } catch (err) {
      if (err instanceof RunBusyError) {
        return c.json(
          {
            ...errorBody(
              "run_in_progress",
              "A demo run is already in progress. Watch it on GET /runs/latest, then start another when it finishes.",
            ),
            runId: err.runningId,
          },
          409,
        );
      }
      if (err instanceof DemoRunError) return c.json(errorBody(err.reason, err.message), 503);
      throw err;
    }
  });

  app.get("/runs/latest", async (c) => {
    const run = await store.latest();
    if (!run) {
      return c.json(
        errorBody("no_runs", "No demo run has happened yet. Start one with POST /runs."),
        404,
      );
    }
    return c.json({ run, events: await store.events(run.id) });
  });

  app.get("/runs/:id", async (c) => {
    const id = c.req.param("id");
    const run = RUN_ID.test(id) ? await store.get(id) : null;
    if (!run) return c.json(errorBody("run_not_found", `There is no demo run with id ${id}.`), 404);
    return c.json({ run, events: await store.events(run.id) });
  });

  app.get("/runs/:id/events", async (c) => {
    const id = c.req.param("id");
    const run = RUN_ID.test(id) ? await store.get(id) : null;
    if (!run) return c.json(errorBody("run_not_found", `There is no demo run with id ${id}.`), 404);
    const resumeFrom = Number.parseInt(c.req.header("last-event-id") ?? "0", 10);
    let last = Number.isFinite(resumeFrom) && resumeFrom > 0 ? resumeFrom : 0;

    return streamSSE(c, async (stream) => {
      const queue: RunEvent[] = [];
      let wake: (() => void) | null = null;
      let closed = false;
      const unsubscribe = store.subscribe(id, (event) => {
        queue.push(event);
        wake?.();
      });
      stream.onAbort(() => {
        closed = true;
        wake?.();
      });
      const send = async (event: RunEvent): Promise<boolean> => {
        if (event.seq <= last) return false;
        last = event.seq;
        await stream.writeSSE({
          id: String(event.seq),
          event: event.type,
          data: JSON.stringify(event),
        });
        return TERMINAL_EVENTS.has(event.type);
      };
      try {
        let done = false;
        // Subscribe first, then replay history, so no event falls between the two.
        for (const event of await store.events(id, last)) {
          if (await send(event)) done = true;
        }
        while (!done && !closed) {
          const next = queue.shift();
          if (next) {
            if (await send(next)) done = true;
            continue;
          }
          const woke = await new Promise<boolean>((resolve) => {
            const timer = setTimeout(() => resolve(false), keepaliveMs);
            wake = () => {
              clearTimeout(timer);
              resolve(true);
            };
          });
          wake = null;
          if (woke || closed) continue;
          await stream.write(": keepalive\n\n");
          // A run finished by another process never reaches this process's feed. Check the store.
          const current = await store.get(id);
          if (current && current.status !== "running") {
            for (const event of await store.events(id, last)) {
              if (await send(event)) done = true;
            }
            done = true;
          }
        }
      } finally {
        unsubscribe();
      }
    });
  });

  return app;
}
