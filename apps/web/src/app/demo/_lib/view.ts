/**
 * Turns the runner's events into what the demo page shows. Pure functions only, so the page and
 * the tests read the same logic. Amount math stays in bigint on base units.
 */
import type { GateCheck, GateOutcome, GateRequest } from "@/components/Gate";
import type { ReceiptView } from "@/components/Receipt";
import { shortAddress } from "@/lib/format";
import type {
  Amount,
  CallEvent,
  CallRefusedData,
  DemoPolicyView,
  RunEvent,
  RunFailedData,
  RunFinishedData,
  RunStartedData,
} from "./events";
import { explorerLink } from "./explorer";

/** The demo pays in the test stablecoin minted by the localnet bootstrap. */
export const DEMO_ASSET = "tUSDC";
export const DEMO_METHOD = "POST";
export const DEMO_PATH = "/v1/summarize";

export interface ExplorerTemplates {
  explorerTx: string;
  explorerAddress: string;
}

export interface RunView {
  runId: string | null;
  started: RunStartedData | null;
  calls: CallEvent[];
  lastCall: CallEvent | null;
  refusal: (CallRefusedData & { at: string }) | null;
  finished: RunFinishedData | null;
  failed: RunFailedData | null;
  /** Rolling spend after the last call, in base units. */
  spent: bigint;
}

export function units(amount: Amount): bigint {
  return BigInt(amount.baseUnits);
}

/** Folds a run's events, in order, into one view. */
export function viewOf(events: readonly RunEvent[]): RunView {
  const view: RunView = {
    runId: events[0]?.runId ?? null,
    started: null,
    calls: [],
    lastCall: null,
    refusal: null,
    finished: null,
    failed: null,
    spent: 0n,
  };
  for (const event of events) {
    switch (event.type) {
      case "run.started":
        view.started = event.data;
        break;
      case "call.settled":
        view.calls.push(event);
        view.lastCall = event;
        view.spent = units(event.data.rollingSpend);
        break;
      case "call.refused":
        view.calls.push(event);
        view.lastCall = event;
        view.refusal = { ...event.data, at: event.at };
        view.spent = units(event.data.rollingSpend);
        break;
      case "run.finished":
        view.finished = event.data;
        break;
      case "run.failed":
        view.failed = event.data;
        break;
    }
  }
  return view;
}

/** Receipts newest first. A refused call is listed as failed and links to its failed transaction. */
export function receiptsOf(view: RunView, explorer: ExplorerTemplates): ReceiptView[] {
  const rows: ReceiptView[] = view.calls.map((call) =>
    call.type === "call.settled"
      ? {
          id: call.data.receipt,
          amount: call.data.amount.display,
          asset: DEMO_ASSET,
          resource: DEMO_PATH,
          // The row's secondary line. In the demo every call has the same payer, so it names the call.
          payer: `Call ${call.data.index}`,
          settledAt: call.at,
          status: "settled",
          explorerUrl: explorerLink(explorer.explorerAddress, call.data.receipt),
        }
      : {
          id: call.data.failedTransaction,
          amount: call.data.amount.display,
          asset: DEMO_ASSET,
          resource: DEMO_PATH,
          payer: `Call ${call.data.index}`,
          settledAt: call.at,
          status: "failed",
          failureReason: `Refused on chain, ${call.data.reason}`,
          explorerUrl: explorerLink(explorer.explorerTx, call.data.failedTransaction),
        },
  );
  return rows.reverse();
}

/** The receipt id a call adds to the list. */
export function receiptIdOf(call: CallEvent): string {
  return call.type === "call.settled" ? call.data.receipt : call.data.failedTransaction;
}

/**
 * How many calls the policy lets settle before the daily cap refuses one, from exact base units.
 * Null when the price is zero or above the per-call cap, where the cap is not what stops the run.
 */
export function expectedSettled(policy: DemoPolicyView): number | null {
  const price = units(policy.pricePerCall);
  if (price <= 0n || price > units(policy.perCallCap)) return null;
  return Number(units(policy.dailyCap) / price);
}

const refusalReasons: Record<string, string> = {
  DailyCapExceeded: "Daily cap reached",
  PerCallCapExceeded: "Above the per-call cap",
  ResourceNotAllowed: "Not on the allow-list",
  InsufficientFunds: "Vault balance too low",
  SessionKeyRevoked: "Session key revoked",
  SessionKeyExpired: "Session key expired",
};

export function refusalReason(code: string): string {
  return refusalReasons[code] ?? "Refused by the program";
}

export interface GateView {
  key: string;
  request: GateRequest;
  checks: GateCheck[];
  outcome: GateOutcome;
}

/**
 * Gate props for one call. The checks run in the order the agent wallet program runs them.
 * Per-call cap, then the allow-list pair, then the rolling daily cap.
 */
export function gateOf(call: CallEvent, perCallCap: Amount): GateView {
  const amount = call.data.amount.display;
  const request: GateRequest = {
    method: DEMO_METHOD,
    path: DEMO_PATH,
    price: amount,
    asset: DEMO_ASSET,
  };
  const within = `${amount} ≤ ${perCallCap.display}`;
  if (call.type === "call.settled") {
    return {
      key: `${call.runId}-${call.seq}`,
      request,
      checks: [
        { label: "Per-call cap", detail: within, state: "pass" },
        { label: "Allow-listed", detail: "route and payee", state: "pass" },
        {
          label: "Daily cap",
          detail: `${call.data.rollingSpend.display} of ${call.data.dailyCap.display}`,
          state: "pass",
        },
      ],
      outcome: {
        kind: "settled",
        amount,
        asset: DEMO_ASSET,
        reference: shortAddress(call.data.receipt),
      },
    };
  }
  const code = call.data.reason;
  const over = `${call.data.rollingSpend.display} + ${amount} > ${call.data.dailyCap.display}`;
  const checks: GateCheck[] =
    code === "PerCallCapExceeded"
      ? [
          {
            label: "Per-call cap",
            detail: `${amount} > ${perCallCap.display}`,
            state: "fail",
          },
          { label: "Allow-listed", detail: "route and payee", state: "skip" },
          { label: "Daily cap", detail: over, state: "skip" },
        ]
      : code === "ResourceNotAllowed"
        ? [
            { label: "Per-call cap", detail: within, state: "pass" },
            { label: "Allow-listed", detail: "not on the list", state: "fail" },
            { label: "Daily cap", detail: over, state: "skip" },
          ]
        : code === "DailyCapExceeded"
          ? [
              { label: "Per-call cap", detail: within, state: "pass" },
              { label: "Allow-listed", detail: "route and payee", state: "pass" },
              { label: "Daily cap", detail: over, state: "fail" },
            ]
          : [
              { label: "Per-call cap", detail: within, state: "skip" },
              { label: "Allow-listed", detail: "route and payee", state: "skip" },
              { label: "Daily cap", detail: over, state: "skip" },
            ];
  return {
    key: `${call.runId}-${call.seq}`,
    request,
    checks,
    outcome: { kind: "refused", reason: refusalReason(code), code },
  };
}

/** The program log line that names the error, for example the AnchorError line. */
export function errorLogLine(logs: readonly string[]): string | null {
  const line = logs.find((l) => l.includes("Error Code:")) ?? logs[0];
  return line ? line.replace(/^Program log:\s*/, "") : null;
}

/** "29 percent" from a ratio of 0.294. */
export function percentOf(ratio: number): string {
  return `${Math.round(Math.min(Math.max(ratio, 0), 1) * 100)} percent`;
}
