import { createPool } from "@turnstile/shared/db";
import { afterAll, describe, expect, it } from "vitest";
import { createApp } from "../src/app.js";
import { loadConfig } from "../src/config.js";
import { createLogger } from "../src/logger.js";
import { createMetrics } from "../src/metrics.js";
import { closePool, fakeRpc, harness, testConfig } from "./helpers.js";

describe("health, readiness and metrics", () => {
  afterAll(closePool);

  it("reports healthy and ready when Postgres and Solana answer", async () => {
    const h = await harness();
    expect(await (await h.app.request("/healthz")).json()).toEqual({
      status: "ok",
      service: "backend",
    });
    const ready = await h.app.request("/readyz");
    expect(ready.status).toBe(200);
    expect(await ready.json()).toMatchObject({
      status: "ready",
      checks: { database: { ok: true }, solana: { ok: true } },
    });
  });

  it("answers 503 and names the database when Postgres is down", async () => {
    const pool = createPool("postgres://nobody:nothing@127.0.0.1:1/none", 1);
    const { app } = createApp({
      pool,
      rpc: fakeRpc(),
      config: testConfig(),
      logger: createLogger("silent"),
      metrics: createMetrics(false),
    });
    const res = await app.request("/readyz");
    expect(res.status).toBe(503);
    const body = (await res.json()) as {
      status: string;
      failed: string[];
      checks: { database: { ok: boolean; error: string }; solana: { ok: boolean } };
    };
    expect(body.status).toBe("unavailable");
    expect(body.failed).toEqual(["database"]);
    expect(body.checks.database.ok).toBe(false);
    expect(body.checks.database.error).toMatch(/ECONNREFUSED/);
    expect(body.checks.solana.ok).toBe(true);
    await pool.end();
  });

  it("answers 503 and names Solana when the RPC fails", async () => {
    const h = await harness({ rpc: fakeRpc({ slotError: new Error("fetch failed") }) });
    const res = await h.app.request("/readyz");
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      failed: ["solana"],
      checks: { database: { ok: true }, solana: { ok: false, error: "fetch failed" } },
    });
  });

  it("counts requests by route and status", async () => {
    const h = await harness();
    await h.app.request("/healthz");
    await h.app.request("/v1/me");
    await h.app.request("/nowhere");
    const text = await (await h.app.request("/metrics")).text();
    expect(text).toContain(
      'turnstile_backend_http_requests_total{method="GET",route="/healthz",status="200"} 1',
    );
    expect(text).toContain(
      'turnstile_backend_http_requests_total{method="GET",route="/v1/me",status="401"} 1',
    );
    expect(text).toContain(
      'turnstile_backend_http_requests_total{method="GET",route="unmatched",status="404"} 1',
    );
    expect(text).toContain("turnstile_backend_http_request_duration_seconds_bucket");
    expect(text).toContain("turnstile_backend_sign_ins_total");
  });

  it("returns a JSON 404 that names the path", async () => {
    const h = await harness();
    const res = await h.app.request("/v1/nothing");
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({
      error: {
        code: "not_found",
        message:
          "GET /v1/nothing is not an endpoint of the console backend. Check the path against the API reference.",
      },
    });
  });

  it("fails config validation with a message per bad variable", () => {
    expect(() =>
      loadConfig({ TURNSTILE_NETWORK: "mainnet", COOKIE_SECURE: "yes", WEB_ORIGIN: "nope" }),
    ).toThrowError(
      /DATABASE_URL is not set[\s\S]*TURNSTILE_NETWORK must be localnet or devnet[\s\S]*COOKIE_SECURE must be true or false/,
    );
    const ok = loadConfig({
      DATABASE_URL: "postgres://u:p@127.0.0.1:5433/turnstile",
      TURNSTILE_NETWORK: "devnet",
      WEB_ORIGIN: "https://turnstile.example/",
      COOKIE_SECURE: "true",
    });
    expect(ok).toMatchObject({
      port: 4022,
      network: "devnet",
      rpcUrl: "https://api.devnet.solana.com",
      webOrigin: "https://turnstile.example",
      domain: "turnstile.example",
      cookieSecure: true,
    });
  });
});
