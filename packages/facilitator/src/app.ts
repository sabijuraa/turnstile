import { randomUUID } from "node:crypto";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import { routePath } from "hono/route";
import type { SettlementChain } from "./chain/types.js";
import type { Config } from "./config.js";
import type { AppEnv, Services } from "./context.js";
import { ApiError, ChainUnavailableError, chainUnavailable, errorBody } from "./errors.js";
import { createLogger, type Logger } from "./logger.js";
import { createMetrics, type Metrics } from "./metrics.js";
import { healthRoutes } from "./routes/health.js";
import { x402Routes } from "./routes/x402.js";
import { Facilitator } from "./service.js";
import type { FacilitatorStore } from "./store/store.js";

export interface AppDeps {
  config: Config;
  chain: SettlementChain;
  store: FacilitatorStore;
  clock?: () => Date;
  logger?: Logger;
  metrics?: Metrics;
}

export interface FacilitatorApp {
  app: Hono<AppEnv>;
  services: Services;
}

/** Builds the facilitator. Runs under @hono/node-server or inside any fetch based host. */
export function createApp(deps: AppDeps): FacilitatorApp {
  const logger = deps.logger ?? createLogger(deps.config.logLevel);
  const metrics = deps.metrics ?? createMetrics();
  const s: Services = {
    config: deps.config,
    chain: deps.chain,
    store: deps.store,
    logger,
    metrics,
    facilitator: new Facilitator({
      config: deps.config,
      chain: deps.chain,
      store: deps.store,
      metrics,
      logger,
      clock: deps.clock ?? (() => new Date()),
    }),
  };
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
    if (route !== "/metrics" && route !== "/healthz" && route !== "/readyz") {
      log.info(
        { method: c.req.method, path: c.req.path, route, status: c.res.status, ms: seconds * 1000 },
        "request",
      );
    }
  });

  app.use(
    "*",
    bodyLimit({
      maxSize: s.config.bodyLimitBytes,
      onError: (c) =>
        c.json(
          errorBody(
            "payload_too_large",
            `The request body is larger than ${s.config.bodyLimitBytes} bytes. Send only the payment payload and requirements.`,
          ),
          413,
        ),
    }),
  );

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json(errorBody(err.code, err.message), err.status);
    }
    const log = c.get("log") ?? s.logger;
    if (err instanceof ChainUnavailableError) {
      log.warn({ err: err.message }, "solana rpc unavailable");
      const e = chainUnavailable(err.message);
      return c.json(errorBody(e.code, e.message), e.status);
    }
    log.error({ err }, "unhandled error");
    return c.json(
      errorBody(
        "internal_error",
        `The facilitator hit an unexpected error. Retry, and if it keeps failing share request id ${c.get("requestId") ?? "unknown"} with the operator.`,
      ),
      500,
    );
  });

  app.notFound((c) =>
    c.json(
      errorBody(
        "not_found",
        `${c.req.method} ${c.req.path} is not a facilitator endpoint. Use GET /supported, POST /requirements, POST /verify or POST /settle.`,
      ),
      404,
    ),
  );

  app.route("/", healthRoutes(s));
  app.route("/", x402Routes(s));

  return { app, services: s };
}
