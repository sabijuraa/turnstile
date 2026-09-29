import { Hono } from "hono";
import type { AppEnv, Services } from "../context.js";

const CHECK_TIMEOUT_MS = 3000;

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

export function healthRoutes(s: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/healthz", (c) => c.json({ status: "ok", service: "facilitator" }));

  app.get("/readyz", async (c) => {
    const [database, solana] = await Promise.all([
      timed(() => s.store.ping()),
      timed(() => s.chain.ping()),
    ]);
    const ready = database.ok && solana.ok;
    const failed = [!database.ok && "database", !solana.ok && "solana"].filter(Boolean);
    if (!ready) c.get("log").warn({ database, solana }, "not ready");
    return c.json(
      {
        status: ready ? "ready" : "unavailable",
        ...(ready ? {} : { failed }),
        checks: { database, solana },
        feePayer: s.chain.feePayer.toBase58(),
        network: s.config.caip2,
      },
      ready ? 200 : 503,
    );
  });

  app.get("/metrics", async (c) => {
    const body = await s.metrics.registry.metrics();
    return c.body(body, 200, { "content-type": s.metrics.registry.contentType });
  });

  return app;
}
