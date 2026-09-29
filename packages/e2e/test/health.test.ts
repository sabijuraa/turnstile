import { describe, expect, it } from "vitest";
import { loadEnv, type ServiceUrls } from "../src/env.js";
import { SERVICE_NAMES } from "../src/ready.js";

const env = loadEnv();

/** Metric families each service must expose. A family shows as a `# TYPE` line even at zero. */
const EXPECTED_METRICS: Record<keyof ServiceUrls, string[]> = {
  facilitator: [
    "turnstile_facilitator_http_requests_total",
    "turnstile_facilitator_http_request_duration_seconds",
    "turnstile_facilitator_requirements_issued_total",
    "turnstile_facilitator_verify_results_total",
    "turnstile_facilitator_settlements_total",
    "turnstile_facilitator_settle_duration_seconds",
    "turnstile_facilitator_dead_letters_total",
  ],
  demoApi: [
    "turnstile_demo_api_http_requests_total",
    "turnstile_demo_api_http_request_duration_seconds",
    "turnstile_demo_api_paid_calls_total",
    "turnstile_demo_api_work_duration_seconds",
  ],
  backend: [
    "turnstile_backend_http_requests_total",
    "turnstile_backend_http_request_duration_seconds",
    "turnstile_backend_sign_ins_total",
    "turnstile_backend_api_key_auth_total",
    "turnstile_backend_csv_exports_total",
  ],
  indexer: [
    "turnstile_indexer_receipts_indexed_total",
    "turnstile_indexer_ticks_total",
    "turnstile_indexer_tick_errors_total",
    "turnstile_indexer_tick_duration_seconds",
    "turnstile_indexer_lag_slots",
    "turnstile_indexer_checkpoint_slot",
  ],
  demoAgent: [
    "turnstile_demo_agent_http_requests_total",
    "turnstile_demo_agent_runs_total",
    "turnstile_demo_agent_calls_total",
    "turnstile_demo_agent_run_duration_seconds",
    "turnstile_demo_agent_paid_call_duration_seconds",
  ],
};

describe("health, readiness and metrics (NFR6)", () => {
  for (const key of Object.keys(EXPECTED_METRICS) as Array<keyof ServiceUrls>) {
    const name = SERVICE_NAMES[key];
    const base = env.services[key];

    it(`${name} answers /healthz and /readyz with 200`, async () => {
      const health = await fetch(`${base}/healthz`);
      expect(health.status).toBe(200);
      expect(await health.json()).toEqual({ status: "ok", service: name });

      const ready = await fetch(`${base}/readyz`);
      const body = (await ready.json()) as { status: string };
      expect(ready.status, JSON.stringify(body)).toBe(200);
      expect(body.status).toBe("ready");
    });

    it(`${name} exposes its metric families on /metrics`, async () => {
      const res = await fetch(`${base}/metrics`);
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toMatch(/^text\/plain/);
      const text = await res.text();
      const families = new Set(
        text
          .split("\n")
          .filter((l) => l.startsWith("# TYPE "))
          .map((l) => l.split(" ")[2]),
      );
      const missing = EXPECTED_METRICS[key].filter((m) => !families.has(m));
      expect(missing, `${name} /metrics lacks ${missing.join(", ")}`).toEqual([]);
    });
  }
});
