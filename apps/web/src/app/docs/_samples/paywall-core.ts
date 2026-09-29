import { createPaywall } from "@turnstile/sdk-resource";

const paywall = createPaywall({
  facilitatorUrl: "http://127.0.0.1:4020",
  payTo: "3yJ7yMk4P9QE96aEfa85VSpUVdvEL9eycva3RfHE3x8m",
  routes: { "GET /v1/quote": { price: "0.001", description: "One market quote" } },
});

/** A fetch style handler for any runtime that speaks WHATWG Request and Response. */
export async function handler(request: Request): Promise<Response> {
  const outcome = await paywall.handle(request);
  switch (outcome.kind) {
    case "free":
      return new Response("free route", { status: 200 });
    case "payment-required":
    case "rejected":
      // A 402 with requirements, a 402 with a refusal reason, or a 503 to retry.
      return outcome.response;
    case "paid":
      return Response.json(
        { quote: "42.10", receipt: outcome.settlement.receipt },
        { headers: { "PAYMENT-RESPONSE": outcome.paymentResponseHeader } },
      );
  }
}
