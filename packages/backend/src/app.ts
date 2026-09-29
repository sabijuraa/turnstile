import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { cors } from "hono/cors";
import { routePath } from "hono/route";
import type { Pool } from "pg";
import { type AgentDirectory, createAgentDirectory, type SolanaRpc } from "./chain/directory.js";
import type { Config } from "./config.js";
import type { AppEnv, Services } from "./context.js";
import { ApiError, errorBody } from "./errors.js";
import { createLogger, type Logger } from "./logger.js";
import { createMetrics, type Metrics } from "./metrics.js";
import { agentRoutes } from "./routes/agents.js";
import { apiKeyRoutes } from "./routes/apiKeys.js";
import { authRoutes, meRoutes } from "./routes/auth.js";
import { healthRoutes } from "./routes/health.js";
import { receiptCsvRoute, receiptRoutes } from "./routes/receipts.js";
import { spendRoutes, summaryRoutes } from "./routes/spend.js";
import { txRoutes } from "./routes/tx.js";

export interface AppDeps {
  pool: Pool;
  rpc: SolanaRpc;
  config: Config;
  clock?: () => Date;
  logger?: Logger;
  metrics?: Metrics;
  directory?: AgentDirectory;
}

export interface BackendApp {
  app: Hono<AppEnv>;
  services: Services;
}

/** Builds the console backend. Runs under @hono/node-server or inside any fetch based host. */
export function createApp(deps: AppDeps): BackendApp {
  const services: Services = {
    pool: deps.pool,
    rpc: deps.rpc,
    config: deps.config,
    clock: deps.clock ?? (() => new Date()),
    logger: deps.logger ?? createLogger(deps.config.logLevel),
    metrics: deps.metrics ?? createMetrics(),
    directory: deps.directory ?? createAgentDirectory(deps.pool, deps.rpc),
  };
  const s = services;
  const app = new Hono<AppEnv>();

  app.use("*", async (c, next) => {
    const incoming = c.req.header("x-request-id");
    const requestId =
      incoming && /^[\w.-]{1,128}$/.test(incoming) ? incoming : randomUUID().toString();
    const log = s.logger.child({ requestId });
    c.set("requestId", requestId);
    c.set("log", log);
    const started = performance.now();
    await next();
    const seconds = (performance.now() - started) / 1000;
    const matched = routePath(c, -1);
    const route = matched.endsWith("*") ? "unmatched" : matched;
    const labels = { method: c.req.method, route, status: String(c.res.status) };
    s.metrics.requests.inc(labels);
    s.metrics.latency.observe(labels, seconds);
    c.res.headers.set("x-request-id", requestId);
    if (route !== "/metrics" && route !== "/healthz") {
      log.info(
        { method: c.req.method, path: c.req.path, route, status: c.res.status, ms: seconds * 1000 },
        "request",
      );
    }
  });

  app.use(
    "/v1/*",
    cors({
      origin: s.config.webOrigin,
      credentials: true,
      allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
      allowHeaders: ["Content-Type", "Authorization", "X-Request-Id"],
      exposeHeaders: ["X-Request-Id", "Content-Disposition"],
      maxAge: 600,
    }),
  );

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json(errorBody(err.code, err.message), err.status);
    }
    const log = c.get("log") ?? s.logger;
    log.error({ err }, "unhandled error");
    return c.json(
      errorBody(
        "internal_error",
        `The backend hit an unexpected error. Try again, and if it keeps failing share request id ${c.get("requestId") ?? "unknown"} with the operator.`,
      ),
      500,
    );
  });

  app.notFound((c) =>
    c.json(
      errorBody(
        "not_found",
        `${c.req.method} ${c.req.path} is not an endpoint of the console backend. Check the path against the API reference.`,
      ),
      404,
    ),
  );

  app.route("/", healthRoutes(s));
  app.route("/v1/auth", authRoutes(s));
  app.route("/v1/me", meRoutes(s));
  app.route("/v1/api-keys", apiKeyRoutes(s));
  app.route("/v1/receipts.csv", receiptCsvRoute(s));
  app.route("/v1/receipts", receiptRoutes(s));
  app.route("/v1/spend", spendRoutes(s));
  app.route("/v1/summary", summaryRoutes(s));
  app.route("/v1/agents", agentRoutes(s));
  app.route("/v1/tx", txRoutes(s));

  return { app, services };
}
