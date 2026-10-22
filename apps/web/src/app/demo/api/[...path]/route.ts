/**
 * Same origin proxy to the demo agent runner, so the browser needs no CORS and never meets mixed
 * content. Only the runner's public routes pass. Server-Sent Events stream through untouched.
 */
import { live, liveEnabled, originOf } from "@/lib/live/runtime";
import { runnerBaseUrl } from "../../_lib/runner";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
// A streamed run lasts as long as the run, which is under a minute on devnet.
export const maxDuration = 120;

/**
 * Calls the demo agent. With TURNSTILE_LIVE the agent runs inside this app and is answered in
 * process, otherwise it is the runner at TURNSTILE_DEMO_AGENT_URL.
 */
async function upstream(request: Request, path: string, init: RequestInit): Promise<Response> {
  if (liveEnabled()) {
    return live(originOf(request)).runnerApp.fetch(new Request(`http://demo-agent/${path}`, init));
  }
  const base = runnerBaseUrl();
  if (!base) return notConfigured();
  return fetch(`${base}/${path}`, init);
}

const RUN_ID = "[0-9a-f-]{36}";
const GET_ROUTES = [
  /^policy$/,
  /^runs\/latest$/,
  new RegExp(`^runs/${RUN_ID}$`),
  new RegExp(`^runs/${RUN_ID}/events$`),
];
const EVENTS = new RegExp(`^runs/${RUN_ID}/events$`);
const JSON_TIMEOUT_MS = 15_000;

function problem(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    { status, headers: { "cache-control": "no-store" } },
  );
}

async function pathOf(params: Promise<{ path: string[] }>): Promise<string> {
  const { path } = await params;
  return path.join("/");
}

function passJson(upstream: Response): Response {
  return new Response(upstream.body, {
    status: upstream.status,
    headers: {
      "content-type": upstream.headers.get("content-type") ?? "application/json",
      "cache-control": "no-store",
    },
  });
}

function unreachable(base: string, route: string, err: unknown): Response {
  console.error(`The demo agent at ${base} did not answer ${route}.`, err);
  return problem(
    502,
    "demo_agent_unreachable",
    "The demo agent is not answering right now. Try again in a minute.",
  );
}

function notConfigured(): Response {
  return problem(
    503,
    "demo_agent_not_configured",
    "The demo agent is not connected to this site. Set TURNSTILE_DEMO_AGENT_URL and restart the web app.",
  );
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const path = await pathOf(params);
  if (!GET_ROUTES.some((route) => route.test(path))) {
    return problem(404, "not_found", `The demo API has no GET route at /${path}.`);
  }
  const base = liveEnabled() ? "the in-app demo agent" : runnerBaseUrl();
  if (!base) return notConfigured();

  if (!EVENTS.test(path)) {
    try {
      const res = await upstream(request, path, {
        cache: "no-store",
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
      });
      return passJson(res);
    } catch (err) {
      return unreachable(base, `GET /${path}`, err);
    }
  }

  // EventSource resends Last-Event-ID on reconnect. A first connection can ask to skip the
  // events it already holds with ?after=<seq>.
  const after = new URL(request.url).searchParams.get("after");
  const resume =
    request.headers.get("last-event-id") ?? (after && /^\d+$/.test(after) ? after : null);
  let res: Response;
  try {
    res = await upstream(request, path, {
      cache: "no-store",
      headers: {
        accept: "text/event-stream",
        ...(resume ? { "last-event-id": resume } : {}),
      },
      signal: request.signal,
    });
  } catch (err) {
    return unreachable(base, `GET /${path}`, err);
  }
  return sse(res);
}

function sse(res: Response): Response {
  if (!res.ok || !res.body) return passJson(res);
  return new Response(res.body, {
    status: 200,
    headers: {
      "content-type": "text/event-stream; charset=utf-8",
      "cache-control": "no-cache, no-transform",
      connection: "keep-alive",
      "x-accel-buffering": "no",
    },
  });
}

export async function POST(
  request: Request,
  { params }: { params: Promise<{ path: string[] }> },
): Promise<Response> {
  const path = await pathOf(params);
  if (path !== "runs" && !(path === "runs/stream" && liveEnabled())) {
    return problem(404, "not_found", `The demo API has no POST route at /${path}.`);
  }
  const base = liveEnabled() ? "the in-app demo agent" : runnerBaseUrl();
  if (!base) return notConfigured();
  try {
    const started = await upstream(request, "runs", {
      method: "POST",
      cache: "no-store",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(JSON_TIMEOUT_MS),
    });
    if (path === "runs" || started.status !== 202) return passJson(started);
    // Start the run and stream it from the same instance that is running it, so a serverless
    // host never sends the feed to an instance that knows nothing about the run.
    const { runId } = (await started.json()) as { runId: string };
    return sse(
      await upstream(request, `runs/${runId}/events`, {
        cache: "no-store",
        headers: { accept: "text/event-stream" },
        signal: request.signal,
      }),
    );
  } catch (err) {
    return unreachable(base, `POST /${path}`, err);
  }
}
