import { deploymentInfo } from "@/lib/console/server";

export const dynamic = "force-dynamic";

/** Public keys and names of the deployment the console runs against. */
export function GET() {
  return Response.json(deploymentInfo(), { headers: { "cache-control": "no-store" } });
}
