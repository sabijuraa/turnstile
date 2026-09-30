/**
 * Who is signed in, for the console shell and the sign-in page. A missing or expired session is a
 * normal state here, so it answers 200 with `me: null` instead of passing on the backend 401.
 */

import type { NextRequest } from "next/server";
import { backendUrl } from "@/lib/console/server";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const headers = new Headers();
  const cookie = request.headers.get("cookie");
  if (cookie) headers.set("cookie", cookie);
  let upstream: Response;
  try {
    upstream = await fetch(`${backendUrl()}/v1/me`, { headers, cache: "no-store" });
  } catch (error) {
    console.error("Console backend unreachable", error);
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
  const noStore = { "cache-control": "no-store" };
  if (upstream.status === 401) return Response.json({ me: null }, { headers: noStore });
  const body: unknown = await upstream.json().catch(() => null);
  if (!upstream.ok) return Response.json(body, { status: upstream.status, headers: noStore });
  return Response.json({ me: body }, { headers: noStore });
}
