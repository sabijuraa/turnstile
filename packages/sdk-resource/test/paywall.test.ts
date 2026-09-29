import type { AddressInfo } from "node:net";
import { Keypair } from "@solana/web3.js";
import {
  decodeHeader,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  type SettlementResponse,
} from "@turnstile/shared";
import express from "express";
import { Hono } from "hono";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { expressPaywall, getSettlement } from "../src/express.js";
import { honoPaywall, type PaywallEnv } from "../src/hono.js";
import { createPaywall, type PaymentRejected, type PaywallOptions } from "../src/paywall.js";
import { FACILITATOR_URL, FakeFacilitator, payHeader } from "./fake-facilitator.js";

const PAY_TO = Keypair.generate().publicKey.toBase58();
const PUBLIC_URL = "https://api.example.com";
const RESOURCE = `${PUBLIC_URL}/v1/summarize`;

let fake: FakeFacilitator;

function options(): PaywallOptions {
  return {
    facilitatorUrl: FACILITATOR_URL,
    payTo: PAY_TO,
    publicUrl: PUBLIC_URL,
    routes: { "POST /v1/summarize": { price: "0.005", description: "Summarize a text" } },
    fetch: fake.fetch,
  };
}

type Send = (path: string, init?: RequestInit) => Promise<Response>;

interface Adapter {
  name: string;
  setup(): Promise<{ send: Send; handlerRuns: () => number; close: () => Promise<void> }>;
}

const honoAdapter: Adapter = {
  name: "hono",
  async setup() {
    let runs = 0;
    const app = new Hono<PaywallEnv>();
    app.use("*", honoPaywall(options()));
    app.post("/v1/summarize", async (c) => {
      runs++;
      const body = (await c.req.json()) as { text: string };
      return c.json({ summary: body.text.slice(0, 5), paidBy: c.get("turnstilePayment")?.payer });
    });
    app.get("/free", (c) => c.json({ free: true }));
    return {
      send: async (path, init) => app.request(`http://inner:8080${path}`, init),
      handlerRuns: () => runs,
      close: async () => {},
    };
  },
};

const expressAdapter: Adapter = {
  name: "express",
  async setup() {
    let runs = 0;
    const app = express();
    app.use(expressPaywall(options()));
    app.use(express.json());
    app.post("/v1/summarize", (req, res) => {
      runs++;
      const body = req.body as { text: string };
      res.json({ summary: body.text.slice(0, 5), paidBy: getSettlement(req)?.payer });
    });
    app.get("/free", (_req, res) => {
      res.json({ free: true });
    });
    const server = app.listen(0, "127.0.0.1");
    await new Promise<void>((resolve) => server.once("listening", () => resolve()));
    const { port } = server.address() as AddressInfo;
    return {
      send: (path, init) => fetch(`http://127.0.0.1:${port}${path}`, init),
      handlerRuns: () => runs,
      close: () => new Promise<void>((resolve) => server.close(() => resolve())),
    };
  },
};

function post(header?: string): RequestInit {
  return {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(header ? { "payment-signature": header } : {}),
    },
    body: JSON.stringify({ text: "hello world" }),
  };
}

async function required(res: Response): Promise<PaymentRequired & Partial<PaymentRejected>> {
  expect(res.status).toBe(402);
  const body = (await res.json()) as PaymentRequired & Partial<PaymentRejected>;
  const header = res.headers.get("payment-required");
  expect(header).toBeTruthy();
  expect(decodeHeader(header ?? "")).toEqual(body);
  return body;
}

describe.each([honoAdapter, expressAdapter])("$name adapter", (adapter) => {
  let send: Send;
  let handlerRuns: () => number;
  let close: () => Promise<void>;

  beforeAll(async () => {
    fake = new FakeFacilitator();
    ({ send, handlerRuns, close } = await adapter.setup());
  });

  afterAll(async () => {
    await close();
  });

  beforeEach(() => {
    fake.calls = [];
    fake.verdict = { isValid: true };
    fake.settlement = null;
    fake.down = false;
  });

  it("lets free routes through without calling the facilitator", async () => {
    const res = await send("/free");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ free: true });
    expect(fake.calls).toHaveLength(0);
  });

  it("answers an unpaid request with 402 and fresh requirements", async () => {
    const before = handlerRuns();
    const body = await required(await send("/v1/summarize?x=1", post()));
    expect(body.x402Version).toBe(2);
    expect(body.resource).toBe(RESOURCE);
    expect(body.error).toContain("0.005 tUSDC");
    expect(body.accepts).toHaveLength(1);
    expect(body.accepts[0]).toMatchObject({ amount: "5000", payTo: PAY_TO, resource: RESOURCE });
    expect(fake.calls[0]).toEqual({
      path: "/requirements",
      body: {
        resource: RESOURCE,
        price: "0.005",
        payTo: PAY_TO,
        description: "Summarize a text",
        mimeType: "application/json",
      },
    });
    expect(handlerRuns()).toBe(before);
  });

  it("verifies, settles, then serves the resource with PAYMENT-RESPONSE", async () => {
    const req = (await required(await send("/v1/summarize", post())))
      .accepts[0] as PaymentRequirements;
    fake.calls = [];
    const before = handlerRuns();
    const res = await send("/v1/summarize", post(payHeader(req)));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ summary: "hello", paidBy: "wallet" });
    expect(handlerRuns()).toBe(before + 1);
    const settlement = decodeHeader<SettlementResponse>(res.headers.get("payment-response") ?? "");
    expect(settlement).toMatchObject({ success: true, transaction: "5sig", receipt: "receipt" });
    expect(fake.paths()).toEqual(["/verify", "/settle"]);
    const sent = fake.calls[0]?.body as {
      paymentPayload: PaymentPayload;
      paymentRequirements: PaymentRequirements;
    };
    expect(sent.paymentRequirements).toEqual(req);
    expect(sent.paymentPayload.accepted).toEqual(req);
  });

  it("refuses a header that is not base64 JSON with a fresh 402", async () => {
    const body = await required(await send("/v1/summarize", post("%%%not-base64")));
    expect(body.reason).toBe("invalid_payload");
    expect(body.message).toContain("Sign the payment again");
    expect(body.accepts[0]?.extra.nonce).toMatch(/^[0-9a-f]{64}$/);
  });

  it("refuses a payment signed for a cheaper price without asking the facilitator", async () => {
    const req = (await required(await send("/v1/summarize", post())))
      .accepts[0] as PaymentRequirements;
    fake.calls = [];
    const cheap = { ...req, amount: "1" };
    const body = await required(await send("/v1/summarize", post(payHeader(cheap))));
    expect(body.reason).toBe("requirements_mismatch");
    expect(fake.paths()).toEqual(["/requirements"]);
  });

  it("passes on the facilitator's reason and message when verification fails", async () => {
    const req = (await required(await send("/v1/summarize", post())))
      .accepts[0] as PaymentRequirements;
    fake.verdict = {
      isValid: false,
      invalidReason: "PerCallCapExceeded",
      invalidMessage: "The price is above the agent wallet's per-call cap.",
    };
    const before = handlerRuns();
    const body = await required(await send("/v1/summarize", post(payHeader(req))));
    expect(body.reason).toBe("PerCallCapExceeded");
    expect(body.message).toBe("The price is above the agent wallet's per-call cap.");
    expect(body.accepts[0]?.extra.nonce).not.toBe(req.extra.nonce);
    expect(handlerRuns()).toBe(before);
    expect(fake.paths()).not.toContain("/settle");
  });

  it("settles a replayed payment idempotently and serves it", async () => {
    const req = (await required(await send("/v1/summarize", post())))
      .accepts[0] as PaymentRequirements;
    fake.verdict = { isValid: false, invalidReason: "NonceAlreadyUsed", invalidMessage: "used" };
    fake.settlement = {
      success: true,
      transaction: "5sig",
      network: "solana:localnet",
      payer: "wallet",
      receipt: "receipt",
      alreadySettled: true,
    };
    const res = await send("/v1/summarize", post(payHeader(req)));
    expect(res.status).toBe(200);
    const settlement = decodeHeader<SettlementResponse>(res.headers.get("payment-response") ?? "");
    expect(settlement.alreadySettled).toBe(true);
  });

  it("returns 402 with the program reason when settlement is refused", async () => {
    const req = (await required(await send("/v1/summarize", post())))
      .accepts[0] as PaymentRequirements;
    fake.settlement = {
      success: false,
      transaction: "",
      network: "solana:localnet",
      payer: "wallet",
      errorReason: "DailyCapExceeded",
      errorMessage: "This payment would take the agent wallet above its daily cap.",
    };
    const body = await required(await send("/v1/summarize", post(payHeader(req))));
    expect(body.reason).toBe("DailyCapExceeded");
  });

  it("returns 503 when the settlement outcome is unknown", async () => {
    const req = (await required(await send("/v1/summarize", post())))
      .accepts[0] as PaymentRequirements;
    fake.settlement = {
      success: false,
      transaction: "",
      network: "solana:localnet",
      payer: "wallet",
      errorReason: "settlement_failed",
      errorMessage: "The settlement could not be confirmed on chain. It is queued for replay.",
    };
    const before = handlerRuns();
    const res = await send("/v1/summarize", post(payHeader(req)));
    expect(res.status).toBe(503);
    expect(res.headers.get("retry-after")).toBe("2");
    expect(handlerRuns()).toBe(before);
  });

  it("returns 503 and never serves the resource when the facilitator is down", async () => {
    const req = (await required(await send("/v1/summarize", post())))
      .accepts[0] as PaymentRequirements;
    fake.down = true;
    const before = handlerRuns();
    for (const init of [post(), post(payHeader(req))]) {
      const res = await send("/v1/summarize", init);
      expect(res.status).toBe(503);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe("payment_service_unavailable");
      expect(body.error.message).toContain("could not be reached");
    }
    expect(handlerRuns()).toBe(before);
  });
});

describe("createPaywall", () => {
  beforeEach(() => {
    fake = new FakeFacilitator();
  });

  it("refuses bad configuration at startup", () => {
    const base = options();
    expect(() => createPaywall({ ...base, payTo: "nope" })).toThrow(/payTo/);
    expect(() =>
      createPaywall({ ...base, routes: { "/v1/x": { price: "1", description: "x" } } }),
    ).toThrow(/METHOD \/path/);
    expect(() =>
      createPaywall({ ...base, routes: { "GET /x": { price: "abc", description: "x" } } }),
    ).toThrow(/invalid price/);
    expect(() =>
      createPaywall({ ...base, routes: { "GET /x": { price: "0", description: "x" } } }),
    ).toThrow(/above zero/);
  });

  it("uses the request origin when no public URL is set, ignoring query and trailing slash", async () => {
    const paywall = createPaywall({ ...options(), publicUrl: undefined });
    const outcome = await paywall.handle(
      new Request("http://localhost:4021/v1/summarize/?a=b", { method: "POST" }),
    );
    expect(outcome.kind).toBe("payment-required");
    expect(fake.calls[0]?.body).toMatchObject({ resource: "http://localhost:4021/v1/summarize" });
    expect(paywall.routeFor("GET", "/v1/summarize")).toBeNull();
  });

  it("checks a paid request against fresh terms when it has none cached", async () => {
    const other = new FakeFacilitator();
    const req = other.requirements({
      resource: RESOURCE,
      price: "0.005",
      payTo: PAY_TO,
      description: "Summarize a text",
      mimeType: "application/json",
    });
    const paywall = createPaywall(options());
    const outcome = await paywall.handle(
      new Request(RESOURCE, { method: "POST", headers: { "payment-signature": payHeader(req) } }),
    );
    expect(outcome.kind).toBe("paid");
    expect(fake.paths()).toEqual(["/requirements", "/verify", "/settle"]);
  });
});
