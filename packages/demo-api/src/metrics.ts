import { Counter, collectDefaultMetrics, Histogram, Registry } from "prom-client";

export interface HttpMetrics {
  registry: Registry;
  requests: Counter<"method" | "route" | "status">;
  latency: Histogram<"method" | "route" | "status">;
}

export interface ApiMetrics extends HttpMetrics {
  paidCalls: Counter<"route">;
  workSeconds: Histogram<"route">;
}

export interface RunnerMetrics extends HttpMetrics {
  runs: Counter<"result">;
  calls: Counter<"result">;
  runSeconds: Histogram;
  settleSeconds: Histogram;
}

const LATENCY_BUCKETS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5];

function httpMetrics(prefix: string, defaultMetrics: boolean): HttpMetrics {
  const registry = new Registry();
  if (defaultMetrics) collectDefaultMetrics({ register: registry, prefix: `${prefix}_` });
  return {
    registry,
    requests: new Counter({
      name: `${prefix}_http_requests_total`,
      help: "HTTP requests handled, by method, route and status.",
      labelNames: ["method", "route", "status"],
      registers: [registry],
    }),
    latency: new Histogram({
      name: `${prefix}_http_request_duration_seconds`,
      help: "HTTP request latency in seconds, by method, route and status.",
      labelNames: ["method", "route", "status"],
      buckets: LATENCY_BUCKETS,
      registers: [registry],
    }),
  };
}

/** Each app gets its own registry so several apps can live in one process, as in tests. */
export function createApiMetrics(defaultMetrics = true): ApiMetrics {
  const base = httpMetrics("turnstile_demo_api", defaultMetrics);
  return {
    ...base,
    paidCalls: new Counter({
      name: "turnstile_demo_api_paid_calls_total",
      help: "Calls served after a settled payment, by route.",
      labelNames: ["route"],
      registers: [base.registry],
    }),
    workSeconds: new Histogram({
      name: "turnstile_demo_api_work_duration_seconds",
      help: "Time spent summarizing or extracting keywords, by route.",
      labelNames: ["route"],
      buckets: [0.0005, 0.001, 0.0025, 0.005, 0.01, 0.025, 0.05, 0.1],
      registers: [base.registry],
    }),
  };
}

export function createRunnerMetrics(defaultMetrics = true): RunnerMetrics {
  const base = httpMetrics("turnstile_demo_agent", defaultMetrics);
  return {
    ...base,
    runs: new Counter({
      name: "turnstile_demo_agent_runs_total",
      help: "Demo runs, by result.",
      labelNames: ["result"],
      registers: [base.registry],
    }),
    calls: new Counter({
      name: "turnstile_demo_agent_calls_total",
      help: "Paid calls the demo agent made, by result: settled, refused or failed.",
      labelNames: ["result"],
      registers: [base.registry],
    }),
    runSeconds: new Histogram({
      name: "turnstile_demo_agent_run_duration_seconds",
      help: "Wall time of a whole demo run.",
      buckets: [1, 2, 5, 10, 20, 30, 60, 120],
      registers: [base.registry],
    }),
    settleSeconds: new Histogram({
      name: "turnstile_demo_agent_paid_call_duration_seconds",
      help: "Time from the first request to the settled response, per paid call.",
      buckets: [0.1, 0.25, 0.5, 1, 1.5, 2, 3, 5, 10],
      registers: [base.registry],
    }),
  };
}
