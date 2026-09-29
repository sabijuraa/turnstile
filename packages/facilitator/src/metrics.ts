import { Counter, collectDefaultMetrics, Histogram, Registry } from "prom-client";

export interface Metrics {
  registry: Registry;
  requests: Counter<"method" | "route" | "status">;
  latency: Histogram<"method" | "route" | "status">;
  verifyResults: Counter<"result">;
  settlements: Counter<"outcome">;
  settleLatency: Histogram<"outcome">;
  deadLetters: Counter<"stage">;
  requirementsIssued: Counter;
}

/** Each app gets its own registry so several apps can live in one process, as in tests. */
export function createMetrics(defaultMetrics = true): Metrics {
  const registry = new Registry();
  if (defaultMetrics) {
    collectDefaultMetrics({ register: registry, prefix: "turnstile_facilitator_" });
  }
  return {
    registry,
    requests: new Counter({
      name: "turnstile_facilitator_http_requests_total",
      help: "HTTP requests handled, by method, route and status.",
      labelNames: ["method", "route", "status"],
      registers: [registry],
    }),
    latency: new Histogram({
      name: "turnstile_facilitator_http_request_duration_seconds",
      help: "HTTP request latency in seconds, by method, route and status.",
      labelNames: ["method", "route", "status"],
      buckets: [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10],
      registers: [registry],
    }),
    verifyResults: new Counter({
      name: "turnstile_facilitator_verify_results_total",
      help: "Payment verifications, by result. The result is valid or the invalid reason.",
      labelNames: ["result"],
      registers: [registry],
    }),
    settlements: new Counter({
      name: "turnstile_facilitator_settlements_total",
      help: "Settle calls, by outcome. settled, already_settled, rejected or dead_lettered.",
      labelNames: ["outcome"],
      registers: [registry],
    }),
    settleLatency: new Histogram({
      name: "turnstile_facilitator_settle_duration_seconds",
      help: "Time from receiving a settle call to answering it, by outcome.",
      labelNames: ["outcome"],
      buckets: [0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 5, 10, 30],
      registers: [registry],
    }),
    deadLetters: new Counter({
      name: "turnstile_facilitator_dead_letters_total",
      help: "Settlements written to the dead-letter table, by stage. settle or replay.",
      labelNames: ["stage"],
      registers: [registry],
    }),
    requirementsIssued: new Counter({
      name: "turnstile_facilitator_requirements_issued_total",
      help: "Payment requirements issued.",
      registers: [registry],
    }),
  };
}
