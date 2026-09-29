import { Keypair } from "@solana/web3.js";
import type { FacilitatorClient, Paywall, PaywallOutcome } from "@turnstile/sdk-resource";
import { encodeHeader, type PaymentRequirements, type SettlementResponse } from "@turnstile/shared";
import { describe, expect, it } from "vitest";
import { createApp, paywallRoutes } from "../src/app.js";
import type { Catalog } from "../src/catalog.js";
import type { ApiConfig } from "../src/config.js";
import type { ErrorBody } from "../src/errors.js";
import { createLogger } from "../src/logger.js";
import { createApiMetrics } from "../src/metrics.js";
import { PASSAGES } from "../src/passages.js";
import type { Keyphrase } from "../src/text/keywords.js";
import type { Summary } from "../src/text/summarize.js";

const mint = Keypair.generate().publicKey.toBase58();
const payTo = Keypair.generate().publicKey.toBase58();

const config: ApiConfig = {
  port: 0,
  network: "localnet",
  deployment: {
    network: "localnet",
    caip2: "solana:testgenesis",
    programs: { agentWallet: payTo, settlement: payTo },
    mint,
    mintDecimals: 6,
    demoOwner: payTo,
    demoSession: payTo,
    demoRecipient: payTo,
  },
  facilitatorUrl: "http://127.0.0.1:4020",
  publicUrl: "http://127.0.0.1:4021",
  price: "0.005",
  priceBaseUnits: 5000n,
  payTo,
  logLevel: "silent",
};

/** Stands in for the facilitator backed paywall. A request with any signature header is paid. */
function stubPaywall(opts: { facilitatorUp?: boolean } = {}) {
  const seen: string[] = [];
  const routes = paywallRoutes(config);
  const paywall: Paywall = {
    routeFor: (method, path) => routes[`${method} ${path}`] ?? null,
    facilitator: {
      supported: async () => {
        if (opts.facilitatorUp === false) throw new Error("connect ECONNREFUSED 127.0.0.1:4020");
        return { kinds: [] };
      },
    } as unknown as FacilitatorClient,
    async handle(req): Promise<PaywallOutcome> {
      const path = new URL(req.url).pathname;
      if (!routes[`${req.method} ${path}`]) return { kind: "free" };
      seen.push(path);
      if (!req.headers.get("payment-signature")) {
        return { kind: "payment-required", response: new Response("{}", { status: 402 }) };
      }
      const settlement: SettlementResponse = {
        success: true,
        transaction: "sig",
        network: "solana:testgenesis",
        payer: "wallet",
        receipt: "receipt",
      };
      return {
        kind: "paid",
        settlement,
        requirements: {} as PaymentRequirements,
        paymentResponseHeader: encodeHeader(settlement),
      };
    },
  };
  return { paywall, seen };
}

function build(opts: { facilitatorUp?: boolean } = {}) {
  const stub = stubPaywall(opts);
  const api = createApp({
    config,
    paywall: stub.paywall,
    logger: createLogger("silent", "demo-api"),
    metrics: createApiMetrics(false),
  });
  return { ...api, seen: stub.seen };
}

const post = (body: unknown, paid = true) => ({
  method: "POST",
  headers: { "content-type": "application/json", ...(paid ? { "payment-signature": "x" } : {}) },
  body: JSON.stringify(body),
});

describe("demo API", () => {
  it("lists paid routes with canonical resources and prices in the free catalog", async () => {
    const { app } = build();
    const res = await app.request("/v1/catalog");
    expect(res.status).toBe(200);
    const catalog = (await res.json()) as Catalog;
    expect(catalog).toMatchObject({
      scheme: "turnstile-policy",
      network: "solana:testgenesis",
      asset: mint,
      payTo,
      routes: [
        {
          method: "POST",
          path: "/v1/summarize",
          resource: "http://127.0.0.1:4021/v1/summarize",
          price: "0.005",
          priceBaseUnits: "5000",
        },
        {
          method: "POST",
          path: "/v1/keywords",
          resource: "http://127.0.0.1:4021/v1/keywords",
          price: "0.005",
        },
      ],
    });
    expect(catalog.routes[0]?.resourceId).toMatch(/^[0-9a-f]{64}$/);
  });

  it("asks for payment before doing the work", async () => {
    const { app } = build();
    const res = await app.request("/v1/summarize", post({ text: "One sentence here." }, false));
    expect(res.status).toBe(402);
  });

  it("summarizes a paid request and attaches PAYMENT-RESPONSE", async () => {
    const { app, metrics } = build();
    const text = PASSAGES[4]?.text ?? "";
    const res = await app.request("/v1/summarize", post({ text, sentences: 2 }));
    expect(res.status).toBe(200);
    expect(res.headers.get("payment-response")).toBeTruthy();
    const body = (await res.json()) as Summary;
    expect(body.sentences).toHaveLength(2);
    expect(body.summary.startsWith("Four score")).toBe(true);
    expect(body.compressionRatio).toBeLessThan(0.5);
    expect(
      await metrics.registry.getSingleMetricAsString("turnstile_demo_api_paid_calls_total"),
    ).toContain('route="/v1/summarize"} 1');
  });

  it("extracts keywords for a paid request", async () => {
    const { app } = build();
    const res = await app.request("/v1/keywords", post({ text: PASSAGES[3]?.text, limit: 5 }));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { keywords: Keyphrase[] };
    expect(body.keywords).toHaveLength(5);
    expect(body.keywords[0]).toEqual(
      expect.objectContaining({ phrase: expect.any(String), score: expect.any(Number) }),
    );
  });

  it("rejects bad input before the paywall so it never costs money", async () => {
    const { app, seen } = build();
    const empty = await app.request("/v1/summarize", post({ text: "   " }));
    expect(empty.status).toBe(400);
    expect(await empty.json()).toEqual({
      error: { code: "invalid_request", message: "text must not be empty." },
    });
    const many = await app.request("/v1/summarize", post({ text: "Fine text.", sentences: 11 }));
    expect(many.status).toBe(400);
    const notJson = await app.request("/v1/keywords", { method: "POST", body: "text=hello" });
    expect(notJson.status).toBe(400);
    expect(((await notJson.json()) as ErrorBody).error.code).toBe("invalid_json");
    expect(seen).toEqual([]);
  });

  it("reports readiness from the facilitator", async () => {
    expect((await build().app.request("/readyz")).status).toBe(200);
    const down = await build({ facilitatorUp: false }).app.request("/readyz");
    expect(down.status).toBe(503);
    expect(await down.json()).toMatchObject({ status: "unavailable", failed: ["facilitator"] });
    expect((await build().app.request("/nope")).status).toBe(404);
  });
});
