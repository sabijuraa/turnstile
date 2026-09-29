import { serve } from "@hono/node-server";
import { createApp } from "./app.js";
import { bootstrap } from "./bootstrap.js";

async function main(): Promise<void> {
  const rt = await bootstrap();
  const { config, logger } = rt;
  if (
    config.deployment.facilitator &&
    config.deployment.facilitator !== rt.chain.feePayer.toBase58()
  ) {
    logger.warn(
      { expected: config.deployment.facilitator, feePayerAddress: rt.chain.feePayer.toBase58() },
      "FACILITATOR_KEYPAIR is not the facilitator named in the deployment file",
    );
  }
  const { app } = createApp({ config, chain: rt.chain, store: rt.store, logger });
  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    logger.info(
      {
        port: info.port,
        network: config.caip2,
        rpcUrl: config.rpcUrl,
        mint: config.mint.toBase58(),
        feePayerAddress: rt.chain.feePayer.toBase58(),
        publicUrl: config.publicUrl,
      },
      "facilitator listening",
    );
  });
  const shutdown = (signal: string) => {
    logger.info({ signal }, "shutting down");
    server.close(() => {
      rt.pool.end().finally(() => process.exit(0));
    });
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

main().catch((err: unknown) => {
  console.error("Facilitator failed to start.", err);
  process.exit(1);
});
