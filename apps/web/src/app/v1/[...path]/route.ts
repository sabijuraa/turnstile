/**
 * The metered demo API, served at <site>/v1 when TURNSTILE_LIVE is on. POST /v1/summarize and
 * POST /v1/keywords answer an unpaid request with 402 and a paid one with the result, settled on
 * chain through the facilitator. GET /v1/catalog lists the paid routes and their price.
 */
import { live, liveEnabled, originOf, rebase } from "@/lib/live/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

async function handle(request: Request): Promise<Response> {
  if (!liveEnabled()) {
    return Response.json(
      { error: { code: "not_enabled", message: "This site does not host the demo API." } },
      { status: 404 },
    );
  }
  const origin = originOf(request);
  const url = new URL(new URL(request.url).pathname, origin);
  url.search = new URL(request.url).search;
  return live(origin).demoApi.fetch(await rebase(request, url));
}

export const GET = handle;
export const POST = handle;
