import { Counter, collectDefaultMetrics, Histogram, Registry } from "prom-client";

export interface Metrics {
  registry: Registry;
  requests: Counter<"method" | "route" | "status">;
  latency: Histogram<"method" | "route" | "status">;
  signIns: Counter<"result">;
  apiKeyAuth: Counter<"result">;
  apiKeysCreated: Counter;
  apiKeysRevoked: Counter;
  csvExports: Counter;
  csvRows: Counter;
}

/** Each app gets its own registry so several apps can live in one process, as in tests. */
export function createMetrics(defaultMetrics = true): Metrics {
  const registry = new Registry();
  if (defaultMetrics) collectDefaultMetrics({ register: registry, prefix: "turnstile_backend_" });
  return {
    registry,
    requests: new Counter({
      name: "turnstile_backend_http_requests_total",
      help: "HTTP requests handled, by method, route and status.",
      labelNames: ["method", "route", "status"],
      registers: [registry],
    }),
    latency: new Histogram({
      name: "turnstile_backend_http_request_duration_seconds",
      help: "HTTP request latency in seconds, by method, route and status.",
      labelNames: ["method", "route", "status"],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5],
      registers: [registry],
    }),
    signIns: new Counter({
      name: "turnstile_backend_sign_ins_total",
      help: "Console sign-in attempts, by result.",
      labelNames: ["result"],
      registers: [registry],
    }),
    apiKeyAuth: new Counter({
      name: "turnstile_backend_api_key_auth_total",
      help: "Requests authenticated with a console API key, by result.",
      labelNames: ["result"],
      registers: [registry],
    }),
    apiKeysCreated: new Counter({
      name: "turnstile_backend_api_keys_created_total",
      help: "Console API keys created.",
      registers: [registry],
    }),
    apiKeysRevoked: new Counter({
      name: "turnstile_backend_api_keys_revoked_total",
      help: "Console API keys revoked.",
      registers: [registry],
    }),
    csvExports: new Counter({
      name: "turnstile_backend_csv_exports_total",
      help: "Receipt statements exported as CSV.",
      registers: [registry],
    }),
    csvRows: new Counter({
      name: "turnstile_backend_csv_rows_total",
      help: "Receipt rows written to CSV statements.",
      registers: [registry],
    }),
  };
}
