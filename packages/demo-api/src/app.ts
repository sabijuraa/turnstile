import { honoPaywall, type Paywall } from "@turnstile/sdk-resource";
import { NETWORKS } from "@turnstile/shared";
import { Hono } from "hono";
import { z } from "zod";
import { buildCatalog, type Catalog, PAID_ROUTES } from "./catalog.js";
import type { ApiConfig } from "./config.js";
import { ApiError, describeZodError } from "./errors.js";
import { type HttpEnv, installHttpBasics, timedCheck } from "./http.js";
import { createLogger, type Logger } from "./logger.js";
import { type ApiMetrics, createApiMetrics } from "./metrics.js";
import { keywords } from "./text/keywords.js";
import { summarize } from "./text/summarize.js";

/** Largest text accepted, in characters. About 15,000 words. */
export const MAX_TEXT_CHARS = 100_000;

const summarizeSchema = z.object({
  text: z
    .string({ error: "must be a string of English text" })
    .trim()
    .min(1, "must not be empty")
    .max(MAX_TEXT_CHARS, `must be at most ${MAX_TEXT_CHARS} characters`),
  sentences: z
    .number({ error: "must be a whole number from 1 to 10" })
    .int("must be a whole number from 1 to 10")
    .min(1, "must be at least 1")
    .max(10, "must be at most 10")
    .optional(),
});

const keywordsSchema = z.object({
  text: summarizeSchema.shape.text,
  limit: z
    .number({ error: "must be a whole number from 1 to 50" })
    .int("must be a whole number from 1 to 50")
    .min(1, "must be at least 1")
    .max(50, "must be at most 50")
    .optional(),
});

export interface ApiDeps {
  config: ApiConfig;
  /** The paywall in front of the paid routes. main.ts builds it from config. */
  paywall: Paywall;
  logger?: Logger;
  metrics?: ApiMetrics;
}

export interface DemoApi {
  app: Hono<HttpEnv>;
  catalog: Catalog;
  metrics: ApiMetrics;
}

async function readJson<T extends z.ZodType>(
  c: { req: { json: () => Promise<unknown> } },
  schema: T,
): Promise<z.infer<T>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiError(
      400,
      "invalid_json",
      "The request body is not JSON. Send Content-Type application/json with a JSON object.",
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_request", `${describeZodError(parsed.error)}.`);
  }
  return parsed.data;
}

/** The metered demo API. Validation runs before the paywall so a bad request never costs money. */
export function createApp(deps: ApiDeps): DemoApi {
  const { config } = deps;
  const logger = deps.logger ?? createLogger(config.logLevel, "demo-api");
  const metrics = deps.metrics ?? createApiMetrics();
  const catalog = buildCatalog({
    publicUrl: config.publicUrl,
    network: config.deployment.caip2 ?? NETWORKS[config.network].caip2,
    asset: config.deployment.mint,
    assetDecimals: config.deployment.mintDecimals,
    payTo: config.payTo,
    facilitatorUrl: config.facilitatorUrl,
    price: config.price,
    priceBaseUnits: config.priceBaseUnits,
  });
  const app = new Hono<HttpEnv>();
  installHttpBasics(app, logger, metrics, "demo API", "GET /v1/catalog lists the routes.");

  app.get("/healthz", (c) => c.json({ status: "ok", service: "demo-api" }));
  app.get("/readyz", async (c) => {
    const facilitator = await timedCheck(() => deps.paywall.facilitator.supported());
    if (!facilitator.ok) c.get("log").warn({ facilitator }, "not ready");
    return c.json(
      {
        status: facilitator.ok ? "ready" : "unavailable",
        ...(facilitator.ok ? {} : { failed: ["facilitator"] }),
        checks: { facilitator },
      },
      facilitator.ok ? 200 : 503,
    );
  });
  app.get("/metrics", async (c) => {
    const body = await metrics.registry.metrics();
    return c.body(body, 200, { "content-type": metrics.registry.contentType });
  });
  app.get("/v1/catalog", (c) => c.json(catalog));

  // Validate first. Hono caches the parsed body, so the handler reads it again for free.
  app.post("/v1/summarize", async (c, next) => {
    await readJson(c, summarizeSchema);
    await next();
  });
  app.post("/v1/keywords", async (c, next) => {
    await readJson(c, keywordsSchema);
    await next();
  });
  app.use("/v1/*", honoPaywall(deps.paywall));

  app.post("/v1/summarize", async (c) => {
    const body = await readJson(c, summarizeSchema);
    const end = metrics.workSeconds.startTimer({ route: "/v1/summarize" });
    const result = summarize(body.text, { sentences: body.sentences ?? 3 });
    end();
    metrics.paidCalls.inc({ route: "/v1/summarize" });
    return c.json(result);
  });
  app.post("/v1/keywords", async (c) => {
    const body = await readJson(c, keywordsSchema);
    const end = metrics.workSeconds.startTimer({ route: "/v1/keywords" });
    const result = keywords(body.text, { limit: body.limit ?? 10 });
    end();
    metrics.paidCalls.inc({ route: "/v1/keywords" });
    return c.json({ keywords: result });
  });

  return { app, catalog, metrics };
}

/** Paywall options for the demo routes, one entry per paid route at the configured price. */
export function paywallRoutes(
  config: ApiConfig,
): Record<string, { price: string; description: string }> {
  const routes: Record<string, { price: string; description: string }> = {};
  for (const r of PAID_ROUTES)
    routes[`POST ${r.path}`] = { price: config.price, description: r.description };
  return routes;
}
