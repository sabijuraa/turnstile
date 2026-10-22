/**
 * The Turnstile facilitator, served from this app when TURNSTILE_LIVE is on. Resource servers
 * anywhere can point their paywall at <site>/api/live/facilitator to verify and settle payments
 * against the deployed programs. It never holds an agent's key and only pays transaction fees.
 */
import { live, liveEnabled, originOf, rebase } from "@/lib/live/runtime";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

async function handle(request: Request, params: Promise<{ path: string[] }>): Promise<Response> {
  if (!liveEnabled()) {
    return Response.json(
      { error: { code: "not_enabled", message: "This site does not host a facilitator." } },
      { status: 404 },
    );
  }
  const { path } = await params;
  const origin = originOf(request);
  const url = new URL(`/${path.join("/")}`, origin);
  url.search = new URL(request.url).search;
  return live(origin).facilitator.fetch(await rebase(request, url));
}

export function GET(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return handle(request, ctx.params);
}

export function POST(request: Request, ctx: { params: Promise<{ path: string[] }> }) {
  return handle(request, ctx.params);
}
