import { randomUUID } from "node:crypto";
import type { Hono } from "hono";
import { routePath } from "hono/route";
import { ApiError, errorBody } from "./errors.js";
import type { Logger } from "./logger.js";
import type { HttpMetrics } from "./metrics.js";

export interface HttpEnv {
  Variables: {
    requestId: string;
    log: Logger;
  };
}

const QUIET_ROUTES = new Set(["/metrics", "/healthz", "/readyz"]);

/** Request ids, structured request logs, metrics, JSON errors and a JSON 404. */
export function installHttpBasics(
  app: Hono<HttpEnv>,
  logger: Logger,
  metrics: HttpMetrics,
  serviceName: string,
  /** One sentence that points a lost caller at the right routes. */
  routesHint: string,
): void {
  app.use("*", async (c, next) => {
    const incoming = c.req.header("x-request-id");
    const requestId = incoming && /^[\w.-]{1,128}$/.test(incoming) ? incoming : randomUUID();
    const log = logger.child({ requestId });
    c.set("requestId", requestId);
    c.set("log", log);
    const started = performance.now();
    await next();
    const seconds = (performance.now() - started) / 1000;
    const matched = routePath(c, -1);
    const route = matched.endsWith("*") ? "unmatched" : matched;
    const labels = { method: c.req.method, route, status: String(c.res.status) };
    metrics.requests.inc(labels);
    metrics.latency.observe(labels, seconds);
    c.res.headers.set("x-request-id", requestId);
    if (!QUIET_ROUTES.has(route)) {
      log.info(
        { method: c.req.method, path: c.req.path, route, status: c.res.status, ms: seconds * 1000 },
        "request",
      );
    }
  });

  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json(errorBody(err.code, err.message), err.status);
    const log = c.get("log") ?? logger;
    log.error({ err }, "unhandled error");
    return c.json(
      errorBody(
        "internal_error",
        `The ${serviceName} hit an unexpected error. Try again, and if it keeps failing share request id ${c.get("requestId") ?? "unknown"} with the operator.`,
      ),
      500,
    );
  });

  app.notFound((c) =>
    c.json(
      errorBody(
        "not_found",
        `${c.req.method} ${c.req.path} is not an endpoint of the ${serviceName}. ${routesHint}`,
      ),
      404,
    ),
  );
}

const CHECK_TIMEOUT_MS = 3000;

export interface Check {
  ok: boolean;
  ms: number;
  error?: string;
}

/** Runs a readiness probe with a timeout and reports how long it took. */
export async function timedCheck(fn: () => Promise<unknown>): Promise<Check> {
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
