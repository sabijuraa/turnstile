import type { ReceiptView } from "@/components/Receipt";
import type { ReceiptDto } from "@/lib/console/types";
import { shortAddress } from "@/lib/format";

/** A backend receipt in the shape the shared receipt components read. */
export function toReceiptView(r: ReceiptDto, asset: string): ReceiptView {
  return {
    id: r.receiptAddress,
    amount: r.displayAmount,
    asset,
    resource: r.resource ?? `Resource ${shortAddress(r.resourceId, 6, 6)}`,
    payer: r.agentLabel ?? shortAddress(r.agentWallet),
    settledAt: r.blockTime,
    status: r.status,
    explorerUrl: r.explorerUrl,
  };
}
