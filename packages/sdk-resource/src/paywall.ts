import { PublicKey } from "@solana/web3.js";
import {
  bytesToHex,
  canonicalResource,
  decodeHeader,
  encodeHeader,
  HEADER_PAYMENT_REQUIRED,
  HEADER_PAYMENT_SIGNATURE,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  parseUnits,
  resourceId,
  SCHEME,
  STABLECOIN_DECIMALS,
  type SettlementResponse,
  validatePaymentPayloadShape,
  X402_VERSION,
} from "@turnstile/shared";
import { FacilitatorClient, FacilitatorUnavailableError } from "./facilitator-client.js";

/** Price and description of one paid route. */
export interface PaywallRoute {
  /** Decimal price in whole tokens, for example "0.005". */
  price: string;
  description: string;
  /** Content type of the paid response. Default application/json. */
  mimeType?: string;
  /** How long a client has to pay once it gets the 402. Default set by the facilitator. */
  maxTimeoutSeconds?: number;
}

export interface PaywallOptions {
  /** Base URL of the Turnstile facilitator, for example http://127.0.0.1:4020. */
  facilitatorUrl: string;
  /** Owner of the token account that receives payments. */
  payTo: string;
  /** Paid routes keyed by "METHOD /path", for example "POST /v1/summarize". */
  routes: Record<string, PaywallRoute>;
  /**
   * External origin of this server, for example https://api.example.com. Used to build the
   * canonical resource. Set it behind a proxy, where the request URL shows the inner host.
   */
  publicUrl?: string;
  fetch?: typeof fetch;
  /** Timeout for requirement and verify calls to the facilitator. Default 10 seconds. */
  timeoutMs?: number;
  /** Timeout for the settle call, which waits for confirmation. Default 60 seconds. */
  settleTimeoutMs?: number;
}

/** Body of a 402 sent after a refused payment. PaymentRequired plus why it was refused. */
export interface PaymentRejected extends PaymentRequired {
  reason: string;
  message: string;
}

export type PaywallOutcome =
  | { kind: "free" }
  | { kind: "payment-required"; response: Response }
  | { kind: "rejected"; response: Response; reason: string }
  | {
      kind: "paid";
      settlement: SettlementResponse;
      paymentResponseHeader: string;
      requirements: PaymentRequirements;
    };

export interface Paywall {
  /** Decides what to do with a request. Never reads the request body and never throws. */
  handle(request: Request): Promise<PaywallOutcome>;
  /** The paid route for a method and path, or null when the route is free. */
  routeFor(method: string, pathname: string): PaywallRoute | null;
  readonly facilitator: FacilitatorClient;
}

const ROUTE_KEY = /^(GET|POST|PUT|PATCH|DELETE) (\/\S*)$/;

function normalizePath(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

function parseRoutes(routes: Record<string, PaywallRoute>): Map<string, PaywallRoute> {
  const out = new Map<string, PaywallRoute>();
  for (const [key, route] of Object.entries(routes)) {
    const m = ROUTE_KEY.exec(key.trim());
    if (!m?.[1] || !m[2]) {
      throw new Error(
        `Route key "${key}" is not valid. Use "METHOD /path", for example "POST /v1/summarize".`,
      );
    }
    let amount: bigint;
    try {
      amount = parseUnits(route.price, STABLECOIN_DECIMALS);
    } catch (err) {
      throw new Error(`Route "${key}" has an invalid price. ${(err as Error).message}.`);
    }
    if (amount <= 0n) throw new Error(`Route "${key}" must have a price above zero.`);
    if (!route.description) throw new Error(`Route "${key}" needs a description.`);
    out.set(`${m[1]} ${normalizePath(m[2])}`, route);
  }
  return out;
}

function json(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

function paymentRequiredResponse(body: PaymentRequired | PaymentRejected): Response {
  return json(402, body, { [HEADER_PAYMENT_REQUIRED]: encodeHeader(body) });
}

function unavailable(message: string): Response {
  return json(
    503,
    { error: { code: "payment_service_unavailable", message } },
    { "retry-after": "2" },
  );
}

/**
 * Creates the framework independent paywall. It asks the facilitator for requirements,
 * verifies and settles payments through it, and never holds any agent key.
 */
export function createPaywall(options: PaywallOptions): Paywall {
  try {
    new PublicKey(options.payTo);
  } catch {
    throw new Error(`payTo "${options.payTo}" is not a base58 Solana address.`);
  }
  const publicOrigin = options.publicUrl ? new URL(options.publicUrl).origin : null;
  const routes = parseRoutes(options.routes);
  const facilitator = new FacilitatorClient({
    url: options.facilitatorUrl,
    fetch: options.fetch,
    timeoutMs: options.timeoutMs,
    settleTimeoutMs: options.settleTimeoutMs,
  });
  /** The last requirements seen per resource. Holds the terms a payment must match. */
  const terms = new Map<string, PaymentRequirements>();

  const routeFor = (method: string, pathname: string): PaywallRoute | null =>
    routes.get(`${method.toUpperCase()} ${normalizePath(pathname)}`) ?? null;

  const resourceFor = (url: URL): string =>
    canonicalResource(publicOrigin ? new URL(url.pathname, publicOrigin) : url);

  async function freshRequirements(
    resource: string,
    route: PaywallRoute,
  ): Promise<PaymentRequirements> {
    const req = await facilitator.requirements({
      resource,
      price: route.price,
      payTo: options.payTo,
      description: route.description,
      mimeType: route.mimeType ?? "application/json",
      ...(route.maxTimeoutSeconds ? { maxTimeoutSeconds: route.maxTimeoutSeconds } : {}),
    });
    terms.set(resource, req);
    return req;
  }

  async function reject(
    resource: string,
    route: PaywallRoute,
    reason: string,
    message: string,
  ): Promise<PaywallOutcome> {
    const fresh = await freshRequirements(resource, route);
    const body: PaymentRejected = {
      x402Version: X402_VERSION,
      error: message,
      resource,
      accepts: [fresh],
      reason,
      message,
    };
    return { kind: "rejected", reason, response: paymentRequiredResponse(body) };
  }

  /** Checks the accepted terms against this server's own route and returns what to verify. */
  function expectedRequirements(
    template: PaymentRequirements,
    accepted: PaymentRequirements,
  ): PaymentRequirements | null {
    const extra = accepted.extra ?? ({} as Partial<PaymentRequirements["extra"]>);
    const same =
      accepted.scheme === SCHEME &&
      accepted.network === template.network &&
      accepted.asset === template.asset &&
      accepted.amount === template.amount &&
      accepted.payTo === template.payTo &&
      accepted.resource === template.resource &&
      extra.resourceId === template.extra.resourceId &&
      extra.settlementProgram === template.extra.settlementProgram &&
      extra.agentWalletProgram === template.extra.agentWalletProgram;
    if (!same) return null;
    if (typeof extra.nonce !== "string" || !/^[0-9a-f]{64}$/.test(extra.nonce)) return null;
    if (typeof extra.expiresAt !== "string" || !/^\d{1,19}$/.test(extra.expiresAt)) return null;
    return {
      ...template,
      extra: { ...template.extra, nonce: extra.nonce, expiresAt: extra.expiresAt },
    };
  }

  async function handlePaid(
    header: string,
    resource: string,
    route: PaywallRoute,
  ): Promise<PaywallOutcome> {
    let payload: PaymentPayload;
    try {
      const decoded = decodeHeader<unknown>(header);
      const problem = validatePaymentPayloadShape(decoded);
      if (problem) {
        return reject(resource, route, "invalid_payload", `${problem} Sign the payment again.`);
      }
      payload = decoded as PaymentPayload;
    } catch {
      return reject(
        resource,
        route,
        "invalid_payload",
        `The ${HEADER_PAYMENT_SIGNATURE} header is not base64 encoded JSON. Sign the payment again.`,
      );
    }

    const template = terms.get(resource) ?? (await freshRequirements(resource, route));
    const requirements = expectedRequirements(template, payload.accepted);
    if (!requirements) {
      return reject(
        resource,
        route,
        "requirements_mismatch",
        "The payment was signed for different terms than this route charges. Sign the requirements in this response.",
      );
    }

    const verdict = await facilitator.verify(payload, requirements);
    // A settled nonce fails verification, but settle answers it with the original receipt.
    if (!verdict.isValid && verdict.invalidReason !== "NonceAlreadyUsed") {
      const reason = verdict.invalidReason ?? "invalid_payment";
      return reject(
        resource,
        route,
        reason,
        verdict.invalidMessage ?? `The facilitator refused the payment with ${reason}.`,
      );
    }

    const settlement = await facilitator.settle(payload, requirements);
    if (settlement.success) {
      return {
        kind: "paid",
        settlement,
        requirements,
        paymentResponseHeader: encodeHeader(settlement),
      };
    }
    const reason = settlement.errorReason ?? "settlement_failed";
    if (reason === "settlement_failed") {
      return {
        kind: "rejected",
        reason,
        response: unavailable(
          settlement.errorMessage ??
            "The payment could not be confirmed on chain yet. Retry the same request with the same payment header in a few seconds.",
        ),
      };
    }
    return reject(
      resource,
      route,
      reason,
      settlement.errorMessage ?? `The settlement was refused with ${reason}.`,
    );
  }

  async function handle(request: Request): Promise<PaywallOutcome> {
    let url: URL;
    try {
      url = new URL(request.url);
    } catch {
      return { kind: "free" };
    }
    const route = routeFor(request.method, url.pathname);
    if (!route) return { kind: "free" };
    const resource = resourceFor(url);
    try {
      const header = request.headers.get(HEADER_PAYMENT_SIGNATURE);
      if (header) return await handlePaid(header, resource, route);
      const req = await freshRequirements(resource, route);
      const body: PaymentRequired = {
        x402Version: X402_VERSION,
        error: `Payment required. This route costs ${req.extra.displayAmount}. Sign one of the accepted requirements and send it in the ${HEADER_PAYMENT_SIGNATURE} header.`,
        resource,
        accepts: [req],
      };
      return { kind: "payment-required", response: paymentRequiredResponse(body) };
    } catch (err) {
      const message =
        err instanceof FacilitatorUnavailableError
          ? `${err.message} The resource was not served. Retry the same request in a few seconds, a payment is never charged twice.`
          : `The paywall hit an unexpected error (${err instanceof Error ? err.message : String(err)}). The resource was not served. Retry in a few seconds.`;
      return {
        kind: "rejected",
        reason: "facilitator_unavailable",
        response: unavailable(message),
      };
    }
  }

  return { handle, routeFor, facilitator };
}

/** Hex resource id of a canonical resource, handy for building allow-lists. */
export function resourceIdHex(resource: string): string {
  return bytesToHex(resourceId(resource));
}
