import type { ReceiptView } from "@/components/Receipt";
import type { ReceiptDto } from "@/lib/console/types";
import { shortAddress } from "@/lib/format";

/** The path of a resource URL, which is what a person scans for in a list. */
function routeOf(resource: string): string {
  try {
    return new URL(resource).pathname;
  } catch {
    return resource;
  }
}

/** A backend receipt in the shape the shared receipt components read. */
export function toReceiptView(r: ReceiptDto, asset: string): ReceiptView {
  return {
    id: r.receiptAddress,
    amount: r.displayAmount,
    asset,
    resource: r.resource ? routeOf(r.resource) : `Resource ${shortAddress(r.resourceId, 6, 6)}`,
    payer: r.agentLabel ?? shortAddress(r.agentWallet),
    settledAt: r.blockTime,
    status: r.status,
    explorerUrl: r.explorerUrl,
  };
}
