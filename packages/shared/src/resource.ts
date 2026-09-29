import { sha256 } from "@noble/hashes/sha2.js";
import { RESOURCE_ID_PREFIX } from "./constants.js";

/**
 * Canonical resource string for a URL. The origin plus path, no query and no fragment,
 * with a trailing slash removed unless the path is the root. Scheme and host are already
 * lowercased by the URL parser. The path keeps its case.
 */
export function canonicalResource(url: string | URL): string {
  const parsed = typeof url === "string" ? new URL(url) : url;
  let path = parsed.pathname;
  if (path.length > 1 && path.endsWith("/")) path = path.slice(0, -1);
  return `${parsed.protocol}//${parsed.host}${path}`;
}

/** 32 byte on-chain identifier of a resource. */
export function resourceId(resource: string): Uint8Array {
  return sha256(new TextEncoder().encode(`${RESOURCE_ID_PREFIX}${resource}`));
}
