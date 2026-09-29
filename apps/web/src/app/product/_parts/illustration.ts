import { parseUnits } from "@turnstile/shared";
import type { GateCheck, GateOutcome, GateRequest } from "@/components/Gate";
import type { PolicyAllowEntry } from "@/components/PolicyPanel";

/**
 * Sample values for the illustrations on the product page. None of this is customer data.
 * Every place that renders it carries a visible "Illustration" caption.
 */
export const sampleAsset = "USDC";

export const sampleRequest: GateRequest = {
  method: "POST",
  path: "/v1/summarize",
  price: "0.004",
  asset: sampleAsset,
};

export const sampleChecks: readonly GateCheck[] = [
  { label: "Per-call cap", detail: "0.004 ≤ 0.01", state: "pass" },
  { label: "Daily cap", detail: "3.212 of 5", state: "pass" },
  { label: "Allow-listed", detail: "route and payee", state: "pass" },
];

export const sampleOutcome: GateOutcome = {
  kind: "settled",
  amount: "0.004",
  asset: sampleAsset,
  reference: "4Fq9…x2Lm",
};

export const samplePolicy = {
  title: "research-agent",
  perCallCap: "0.01",
  dailyCap: "5",
  sessionKey: "8xR2…Qm1c, active",
  allowList: [
    { resource: "api.example.com/v1/summarize", recipient: "9vWb…3kTe" },
    { resource: "data.example.com/v2/quotes", recipient: "Fh2L…p8Ga" },
  ] satisfies PolicyAllowEntry[],
  spent: parseUnits("3.212"),
  cap: parseUnits("5"),
};

export const sampleReceipt = {
  amount: "0.004",
  asset: sampleAsset,
  settledAt: "2026-09-29T14:32:08Z",
  fields: [
    { label: "Agent wallet", value: "3sKp…Wd7N", mono: true },
    { label: "Owner", value: "Gm4c…T1vR", mono: true },
    { label: "Session key", value: "8xR2…Qm1c", mono: true },
    { label: "Recipient", value: "9vWb…3kTe", mono: true },
    { label: "Mint", value: "USDC", mono: true },
    { label: "Resource id", value: "e3b7…5a1f", mono: true },
    { label: "Nonce", value: "b41e…09ac", mono: true },
    { label: "Slot", value: "412 881 305", mono: true },
    { label: "Fee payer", value: "Facilitator, 7Qd1…Lk4s", mono: true },
  ],
} as const;
