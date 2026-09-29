import { HEADER_PAYMENT_RESPONSE, type SettlementResponse } from "@turnstile/shared";
import type { MiddlewareHandler } from "hono";
import { createPaywall, type Paywall, type PaywallOptions } from "./paywall.js";

/** Context variables the Hono middleware sets. */
export interface PaywallVariables {
  /** The settlement that paid for this request. Set on paid routes only. */
  turnstilePayment?: SettlementResponse;
}

export interface PaywallEnv {
  Variables: PaywallVariables;
}

/**
 * Hono middleware. Free routes pass straight through. A paid route runs the handler only
 * after the payment settled, and the response carries PAYMENT-RESPONSE.
 */
export function honoPaywall(options: PaywallOptions | Paywall): MiddlewareHandler<PaywallEnv> {
  const paywall = "handle" in options ? options : createPaywall(options);
  return async (c, next) => {
    const outcome = await paywall.handle(c.req.raw);
    if (outcome.kind === "free") {
      await next();
      return;
    }
    if (outcome.kind !== "paid") return outcome.response;
    c.set("turnstilePayment", outcome.settlement);
    await next();
    try {
      c.res.headers.set(HEADER_PAYMENT_RESPONSE, outcome.paymentResponseHeader);
    } catch {
      // Some handlers return a response with immutable headers. Copy it to add ours.
      const copy = new Response(c.res.body, c.res);
      copy.headers.set(HEADER_PAYMENT_RESPONSE, outcome.paymentResponseHeader);
      c.res = copy;
    }
  };
}
