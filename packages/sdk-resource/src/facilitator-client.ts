import type {
  PaymentPayload,
  PaymentRequirements,
  SettlementResponse,
  SupportedResponse,
  VerifyResponse,
} from "@turnstile/shared";

/** Body of POST /requirements on the facilitator. */
export interface RequirementsRequest {
  resource: string;
  /** Base units as a decimal integer string. Send this or price. */
  amount?: string;
  /** Decimal price in whole tokens, for example "0.005". Send this or amount. */
  price?: string;
  payTo: string;
  description: string;
  mimeType?: string;
  maxTimeoutSeconds?: number;
}

/**
 * The facilitator could not be reached or did not answer as expected. Nothing was decided
 * about the payment, so the resource must not be served.
 */
export class FacilitatorUnavailableError extends Error {
  override name = "FacilitatorUnavailableError";
  constructor(
    message: string,
    readonly status?: number,
    readonly code?: string,
  ) {
    super(message);
  }
}

export interface FacilitatorClientOptions {
  /** Base URL, for example http://127.0.0.1:4020. */
  url: string;
  fetch?: typeof fetch;
  /** Timeout for /supported, /requirements and /verify. Default 10 seconds. */
  timeoutMs?: number;
  /** Timeout for /settle, which waits for confirmation. Default 60 seconds. */
  settleTimeoutMs?: number;
}

/** A thin typed client for the Turnstile facilitator HTTP API. */
export class FacilitatorClient {
  private readonly base: string;
  private readonly fetchFn: typeof fetch;
  private readonly timeoutMs: number;
  private readonly settleTimeoutMs: number;

  constructor(opts: FacilitatorClientOptions) {
    this.base = opts.url.replace(/\/+$/, "");
    this.fetchFn = opts.fetch ?? globalThis.fetch.bind(globalThis);
    this.timeoutMs = opts.timeoutMs ?? 10_000;
    this.settleTimeoutMs = opts.settleTimeoutMs ?? 60_000;
  }

  supported(): Promise<SupportedResponse> {
    return this.call("GET", "/supported", undefined, this.timeoutMs);
  }

  requirements(body: RequirementsRequest): Promise<PaymentRequirements> {
    return this.call("POST", "/requirements", body, this.timeoutMs);
  }

  verify(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<VerifyResponse> {
    return this.call("POST", "/verify", { paymentPayload, paymentRequirements }, this.timeoutMs);
  }

  settle(
    paymentPayload: PaymentPayload,
    paymentRequirements: PaymentRequirements,
  ): Promise<SettlementResponse> {
    return this.call(
      "POST",
      "/settle",
      { paymentPayload, paymentRequirements },
      this.settleTimeoutMs,
    );
  }

  private async call<T>(
    method: "GET" | "POST",
    path: string,
    body: unknown,
    timeoutMs: number,
  ): Promise<T> {
    let res: Response;
    try {
      res = await this.fetchFn(`${this.base}${path}`, {
        method,
        headers: body === undefined ? {} : { "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (err) {
      const reason =
        err instanceof Error && err.name === "TimeoutError"
          ? `no answer within ${timeoutMs} ms`
          : err instanceof Error
            ? err.message
            : String(err);
      throw new FacilitatorUnavailableError(
        `The facilitator at ${this.base} could not be reached (${reason}).`,
      );
    }
    let parsed: unknown;
    try {
      parsed = await res.json();
    } catch {
      throw new FacilitatorUnavailableError(
        `The facilitator at ${this.base} answered ${method} ${path} with ${res.status} and a body that is not JSON.`,
        res.status,
      );
    }
    if (!res.ok) {
      const error = (parsed as { error?: { code?: unknown; message?: unknown } }).error;
      const code = typeof error?.code === "string" ? error.code : undefined;
      const message = typeof error?.message === "string" ? error.message : `status ${res.status}`;
      throw new FacilitatorUnavailableError(
        `The facilitator refused ${method} ${path} (${code ?? res.status}). ${message}`,
        res.status,
        code,
      );
    }
    return parsed as T;
  }
}
