# @turnstile/sdk-resource

Turns an HTTP route into a paid route. An unpaid request gets a 402 with x402 payment requirements. A request that carries a signed payment is verified and settled through the Turnstile facilitator, and only then does your handler run.

The SDK never sees an agent key. It forwards the agent's signed authorization to the facilitator, and the Solana programs decide whether the payment is inside the owner's policy.

## Install

Inside this monorepo, add `"@turnstile/sdk-resource": "workspace:*"` to your package. Hono is an optional peer dependency, needed only for `honoPaywall`.

## Hono

```ts
import { Hono } from "hono";
import { honoPaywall, type PaywallEnv } from "@turnstile/sdk-resource";

const app = new Hono<PaywallEnv>();

app.use(
  "*",
  honoPaywall({
    facilitatorUrl: "http://127.0.0.1:4020",
    payTo: "3Wx7...recipient", // owner of the token account that receives payments
    publicUrl: "https://api.example.com", // the origin agents call, needed behind a proxy
    routes: {
      "POST /v1/summarize": { price: "0.005", description: "Summarize a text" },
    },
  }),
);

app.post("/v1/summarize", async (c) => {
  const payment = c.get("turnstilePayment"); // SettlementResponse on paid routes
  return c.json({ summary: "...", receipt: payment?.receipt });
});
```

## Express or node:http

```ts
import express from "express";
import { expressPaywall, getSettlement } from "@turnstile/sdk-resource";

const app = express();
app.use(expressPaywall({ facilitatorUrl, payTo, routes }));
app.use(express.json()); // the paywall never reads the body, so parsers can come after it

app.post("/v1/summarize", (req, res) => {
  res.json({ summary: "...", receipt: getSettlement(req)?.receipt });
});
```

The same middleware works with a plain `http.createServer`, since it only uses `IncomingMessage` and `ServerResponse`. On Express it also sets `res.locals.turnstilePayment`.

## Framework agnostic core

```ts
import { createPaywall } from "@turnstile/sdk-resource";

const paywall = createPaywall({ facilitatorUrl, payTo, routes, publicUrl });
const outcome = await paywall.handle(request); // a WHATWG Request

switch (outcome.kind) {
  case "free": // not a paid route, serve it
  case "payment-required": // return outcome.response, a 402
  case "rejected": // return outcome.response, a 402 with a reason or a 503
  case "paid": // serve it, and set PAYMENT-RESPONSE to outcome.paymentResponseHeader
}
```

`handle` never throws and never reads the request body.

## API

| Export | Kind |
| --- | --- |
| `createPaywall(options: PaywallOptions): Paywall` | function |
| `honoPaywall(options: PaywallOptions \| Paywall): MiddlewareHandler<PaywallEnv>` | function |
| `expressPaywall(options: PaywallOptions \| Paywall): NodeMiddleware` | function |
| `getSettlement(req: IncomingMessage): SettlementResponse \| undefined` | function |
| `resourceIdHex(resource: string): string` | function, for building allow-lists |
| `FacilitatorClient` | class with `supported`, `requirements`, `verify`, `settle` |
| `FacilitatorUnavailableError` | error class |
| `PaywallOptions`, `PaywallRoute`, `Paywall`, `PaywallOutcome`, `PaymentRejected`, `PaywallEnv`, `PaywallVariables`, `NodeMiddleware`, `NodeRequest`, `NodeResponse`, `NodeNext`, `FacilitatorClientOptions`, `RequirementsRequest` | types |

`PaywallOptions`

- `facilitatorUrl` base URL of the facilitator.
- `payTo` owner of the recipient token account, base58.
- `routes` keyed by `"METHOD /path"`. Each has `price` (decimal string in whole tokens), `description`, optional `mimeType` and `maxTimeoutSeconds`.
- `publicUrl` optional external origin. The canonical resource is this origin plus the request path, without query string. Agents' allow-lists are keyed by the resource id of that string, so it must match what agents call.
- `fetch`, `timeoutMs` (default 10 s), `settleTimeoutMs` (default 60 s).

## What each request gets

| Situation | Response |
| --- | --- |
| Route not in `routes` | passes through untouched |
| No `PAYMENT-SIGNATURE` header | 402, `PAYMENT-REQUIRED` header and the same JSON body |
| Header is not base64 JSON, or the payload shape is wrong | 402 with `reason: "invalid_payload"` and fresh requirements |
| Payment signed for a different price, payee, resource or asset than the route | 402 with `reason: "requirements_mismatch"`, the facilitator is not called |
| Facilitator refuses the payment | 402 with the facilitator reason, for example `PerCallCapExceeded`, `DailyCapExceeded`, `ResourceNotAllowed`, `SessionKeyRevoked`, `authorization_expired`, `invalid_signature` |
| Payment settles | handler runs, response carries `PAYMENT-RESPONSE` (base64 JSON `{ success, transaction, network, payer, receipt }`) |
| The same payment header is sent again | settle answers with the original receipt (`alreadySettled: true`), no second debit, handler runs |
| Settlement outcome unknown | 503 with `Retry-After: 2`. Retrying the same header is safe |
| Facilitator unreachable | 503 `payment_service_unavailable`. The handler never runs |

A 402 after a refusal has this body.

```json
{
  "x402Version": 2,
  "error": "The price is above the agent wallet's per-call cap. Ask the owner to raise the cap, or use a cheaper resource.",
  "resource": "https://api.example.com/v1/summarize",
  "accepts": [{ "scheme": "turnstile-policy", "amount": "5000", "...": "..." }],
  "reason": "PerCallCapExceeded",
  "message": "The price is above the agent wallet's per-call cap. Ask the owner to raise the cap, or use a cheaper resource."
}
```

## Replays

Settlement is idempotent by nonce, so a replayed header resolves to the original settlement and the resource is served again without a second charge. If a route must be served only once per payment, check `settlement.alreadySettled` in the handler.

## Tests

```sh
pnpm --filter @turnstile/sdk-resource test
```

The unit tests run both adapters against a scripted fake facilitator.

`test/integration.test.ts` starts its own `solana-test-validator` with both programs from `target/deploy`, on ports 38899 and 38900 by default so it does not clash with a running stack. It then runs a real facilitator and a Hono resource server. The agent wallet is created with the shared instruction builders and the payments are signed by hand with the shared helpers. It covers the paid flow with the receipt read back from chain and exact vault and recipient balances. It also covers a replayed header (same transaction, no second debit), five concurrent copies of one payment (one debit), a price over the per-call cap, a resource off the allow-list, an expired authorization, an unreachable facilitator and the NFR3 latency.

```sh
cargo build-sbf   # or anchor build, so target/deploy holds both .so files
TURNSTILE_INTEGRATION=1 pnpm --filter @turnstile/sdk-resource test
```

Set `INTEGRATION_RPC_PORT` to move the validator, `INTEGRATION_LATENCY_RUNS` to change the sample size and `TEST_DATABASE_URL` for Postgres. Measured medians are in the facilitator README.
