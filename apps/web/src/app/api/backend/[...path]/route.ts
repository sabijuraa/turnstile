/**
 * Same-origin proxy to the console backend. The browser talks to /api/backend/* so the session
 * cookie is first party. The backend address is read at request time from TURNSTILE_BACKEND_URL,
 * so one build runs against any backend.
 */

import type { NextRequest } from "next/server";
import { backendUrl } from "@/lib/console/server";

export const dynamic = "force-dynamic";

const FORWARD_REQUEST = ["cookie", "content-type", "origin", "x-request-id", "authorization"];
const FORWARD_RESPONSE = ["content-type", "content-disposition", "x-request-id", "cache-control"];

async function proxy(request: NextRequest, context: { params: Promise<{ path: string[] }> }) {
  const { path } = await context.params;
  const target = new URL(`${backendUrl()}/${path.map(encodeURIComponent).join("/")}`);
  target.search = request.nextUrl.search;

  const headers = new Headers();
  for (const name of FORWARD_REQUEST) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const hasBody = request.method !== "GET" && request.method !== "HEAD";

  let upstream: Response;
  try {
    upstream = await fetch(target, {
      method: request.method,
      headers,
      body: hasBody ? await request.arrayBuffer() : undefined,
      redirect: "manual",
      cache: "no-store",
    });
  } catch (error) {
    console.error("Console backend unreachable", target.origin, error);
    return Response.json(
      {
        error: {
          code: "backend_unavailable",
          message:
            "The console backend is not answering. Check that it is running, then try again.",
        },
      },
      { status: 502 },
    );
  }

  const out = new Headers();
  for (const name of FORWARD_RESPONSE) {
    const value = upstream.headers.get(name);
    if (value) out.set(name, value);
  }
  for (const cookie of upstream.headers.getSetCookie()) out.append("set-cookie", cookie);
  if (!out.has("cache-control")) out.set("cache-control", "no-store");
  return new Response(upstream.body, { status: upstream.status, headers: out });
}

export { proxy as DELETE, proxy as GET, proxy as POST, proxy as PUT };
