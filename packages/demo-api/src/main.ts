import { serve } from "@hono/node-server";
import { createPaywall } from "@turnstile/sdk-resource";
import { createApp, paywallRoutes } from "./app.js";
import { ConfigError, loadApiConfig } from "./config.js";
import { createLogger } from "./logger.js";

function main(): void {
  let config: ReturnType<typeof loadApiConfig>;
  try {
    config = loadApiConfig();
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
  const logger = createLogger(config.logLevel, "demo-api");
  const paywall = createPaywall({
    facilitatorUrl: config.facilitatorUrl,
    payTo: config.payTo,
    publicUrl: config.publicUrl,
    routes: paywallRoutes(config),
  });
  const { app, catalog } = createApp({ config, paywall, logger });
  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    logger.info(
      {
        port: info.port,
        publicUrl: config.publicUrl,
        facilitator: config.facilitatorUrl,
        payTo: config.payTo,
        price: config.price,
        routes: catalog.routes.map((r) => r.resource),
      },
      "demo API listening",
    );
  });
  const shutdown = (signal: string) => {
    logger.info({ signal }, "shutting down");
    server.close(() => process.exit(0));
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main();
