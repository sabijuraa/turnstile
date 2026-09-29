import type { IncomingMessage, ServerResponse } from "node:http";
import type { TLSSocket } from "node:tls";
import { HEADER_PAYMENT_RESPONSE, type SettlementResponse } from "@turnstile/shared";
import { createPaywall, type Paywall, type PaywallOptions } from "./paywall.js";

/** The request shape Express and plain node:http share. */
export type NodeRequest = IncomingMessage & { originalUrl?: string };
/** The response shape Express and plain node:http share. */
export type NodeResponse = ServerResponse & { locals?: Record<string, unknown> };
export type NodeNext = (err?: unknown) => void;
export type NodeMiddleware = (req: NodeRequest, res: NodeResponse, next: NodeNext) => void;

const settlements = new WeakMap<IncomingMessage, SettlementResponse>();

/** The settlement that paid for this request, when the paywall let it through as paid. */
export function getSettlement(req: IncomingMessage): SettlementResponse | undefined {
  return settlements.get(req);
}

function toRequest(req: NodeRequest): Request {
  const encrypted = (req.socket as TLSSocket | undefined)?.encrypted === true;
  const host = req.headers.host ?? "localhost";
  const url = `${encrypted ? "https" : "http"}://${host}${req.originalUrl ?? req.url ?? "/"}`;
  const headers = new Headers();
  for (const [name, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    if (Array.isArray(value)) for (const v of value) headers.append(name, v);
    else headers.set(name, value);
  }
  // The body stays in the stream for the route handler. The paywall only reads headers.
  return new Request(url, { method: req.method ?? "GET", headers });
}

async function send(res: NodeResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, name) => {
    res.setHeader(name, value);
  });
  res.end(Buffer.from(await response.arrayBuffer()));
}

/**
 * Middleware for Express and node:http servers. Free routes pass straight through. A paid
 * route runs the handler only after the payment settled, with PAYMENT-RESPONSE set.
 */
export function expressPaywall(options: PaywallOptions | Paywall): NodeMiddleware {
  const paywall = "handle" in options ? options : createPaywall(options);
  return (req, res, next) => {
    paywall
      .handle(toRequest(req))
      .then(async (outcome) => {
        switch (outcome.kind) {
          case "free":
            next();
            return;
          case "paid":
            settlements.set(req, outcome.settlement);
            if (res.locals) res.locals.turnstilePayment = outcome.settlement;
            res.setHeader(HEADER_PAYMENT_RESPONSE, outcome.paymentResponseHeader);
            next();
            return;
          default:
            await send(res, outcome.response);
        }
      })
      .catch(next);
  };
}
