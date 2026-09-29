import { bytesToHex, canonicalResource, resourceId, SCHEME } from "@turnstile/shared";

export interface CatalogRoute {
  method: "POST";
  path: string;
  /** Canonical resource string, the value hashed into the on-chain resource id. */
  resource: string;
  resourceId: string;
  /** Decimal token amount per call. */
  price: string;
  priceBaseUnits: string;
  description: string;
}

export interface Catalog {
  name: string;
  scheme: typeof SCHEME;
  network: string;
  asset: string;
  assetDecimals: number;
  payTo: string;
  facilitator: string;
  routes: CatalogRoute[];
}

export const PAID_ROUTES = [
  {
    path: "/v1/summarize",
    description:
      "Extractive summary of English text. Returns the most central sentences in their original order.",
  },
  {
    path: "/v1/keywords",
    description: "Ranked keyphrases of English text.",
  },
] as const;

export interface CatalogInput {
  publicUrl: string;
  network: string;
  asset: string;
  assetDecimals: number;
  payTo: string;
  facilitatorUrl: string;
  price: string;
  priceBaseUnits: bigint;
}

export function buildCatalog(input: CatalogInput): Catalog {
  return {
    name: "Turnstile demo API",
    scheme: SCHEME,
    network: input.network,
    asset: input.asset,
    assetDecimals: input.assetDecimals,
    payTo: input.payTo,
    facilitator: input.facilitatorUrl,
    routes: PAID_ROUTES.map((r) => {
      // Same rule as the paywall. The origin of the public URL plus the route path.
      const resource = canonicalResource(new URL(r.path, new URL(input.publicUrl).origin));
      return {
        method: "POST" as const,
        path: r.path,
        resource,
        resourceId: bytesToHex(resourceId(resource)),
        price: input.price,
        priceBaseUnits: input.priceBaseUnits.toString(),
        description: r.description,
      };
    }),
  };
}
