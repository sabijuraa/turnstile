/**
 * Wire shapes of the demo agent runner (packages/demo-api/src/runner/events.ts), read from its
 * HTTP API. The web app does not depend on the runner package, so every payload that crosses the
 * wire is checked here before the page trusts it.
 */

/** A token amount in base units plus its exact decimal form, for example "5000" and "0.005". */
export interface Amount {
  baseUnits: string;
  display: string;
}

export interface AllowListView {
  resource: string;
  resourceId: string;
  recipient: string;
}

export interface DemoPolicyView {
  perCallCap: Amount;
  dailyCap: Amount;
  funding: Amount;
  pricePerCall: Amount;
  allowList: AllowListView[];
  sessionKey: string;
  owner: string;
  mint: string;
  /** CAIP-2 id of the network, for example solana:localnet. */
  network: string;
}

export interface RunStartedData {
  runId: string;
  agentWallet: string;
  walletId: string;
  vault: string;
  policy: DemoPolicyView;
  setupTransaction: string;
}

export interface CallSettledData {
  index: number;
  amount: Amount;
  receipt: string;
  transaction: string;
  rollingSpend: Amount;
  dailyCap: Amount;
  vaultBalance: Amount;
  passage: { title: string; author: string; year: number };
  summaryExcerpt: string;
  compressionRatio: number;
  latencyMs: number;
}

export interface CallRefusedData {
  index: number;
  amount: Amount;
  /** Program error name, for example DailyCapExceeded. */
  reason: string;
  message: string;
  facilitatorReason: string;
  /** The settlement transaction sent straight to the chain, which the program refused. */
  failedTransaction: string;
  programLogs: string[];
  rollingSpend: Amount;
  dailyCap: Amount;
}

export interface RunFinishedData {
  settledCalls: number;
  refusedCalls: number;
  totalSpent: Amount;
  withdrawn: Amount;
  withdrawTransaction: string | null;
  receipts: string[];
  durationMs: number;
}

export interface RunFailedData {
  reason: string;
  message: string;
  withdrawn?: Amount;
  withdrawTransaction?: string | null;
}

export interface RunEventMap {
  "run.started": RunStartedData;
  "call.settled": CallSettledData;
  "call.refused": CallRefusedData;
  "run.finished": RunFinishedData;
  "run.failed": RunFailedData;
}

export type RunEventType = keyof RunEventMap;

export type RunEvent = {
  [T in RunEventType]: { runId: string; seq: number; type: T; data: RunEventMap[T]; at: string };
}[RunEventType];

export type CallEvent = Extract<RunEvent, { type: "call.settled" | "call.refused" }>;

export type RunStatus = "running" | "finished" | "failed";

export interface RunRecord {
  id: string;
  status: RunStatus;
  agentWallet: string | null;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}

export interface RunSnapshot {
  run: RunRecord;
  events: RunEvent[];
}

export const RUN_EVENT_TYPES: readonly RunEventType[] = [
  "run.started",
  "call.settled",
  "call.refused",
  "run.finished",
  "run.failed",
];

export function isCallEvent(event: RunEvent): event is CallEvent {
  return event.type === "call.settled" || event.type === "call.refused";
}

export function isTerminal(event: RunEvent): boolean {
  return event.type === "run.finished" || event.type === "run.failed";
}

type Json = Record<string, unknown>;

function isObject(value: unknown): value is Json {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function isAmount(value: unknown): value is Amount {
  return (
    isObject(value) &&
    isString(value.baseUnits) &&
    /^\d+$/.test(value.baseUnits) &&
    isString(value.display)
  );
}

function hasStrings(value: Json, keys: readonly string[]): boolean {
  return keys.every((key) => isString(value[key]));
}

function hasAmounts(value: Json, keys: readonly string[]): boolean {
  return keys.every((key) => isAmount(value[key]));
}

export function isPolicy(value: unknown): value is DemoPolicyView {
  return (
    isObject(value) &&
    hasAmounts(value, ["perCallCap", "dailyCap", "funding", "pricePerCall"]) &&
    hasStrings(value, ["sessionKey", "owner", "mint", "network"]) &&
    Array.isArray(value.allowList) &&
    value.allowList.every(
      (entry) => isObject(entry) && hasStrings(entry, ["resource", "resourceId", "recipient"]),
    )
  );
}

const dataChecks: { [T in RunEventType]: (data: Json) => boolean } = {
  "run.started": (d) =>
    hasStrings(d, ["runId", "agentWallet", "walletId", "vault", "setupTransaction"]) &&
    isPolicy(d.policy),
  "call.settled": (d) =>
    isNumber(d.index) &&
    hasAmounts(d, ["amount", "rollingSpend", "dailyCap", "vaultBalance"]) &&
    hasStrings(d, ["receipt", "transaction", "summaryExcerpt"]) &&
    isObject(d.passage) &&
    hasStrings(d.passage, ["title", "author"]) &&
    isNumber(d.passage.year) &&
    isNumber(d.compressionRatio) &&
    isNumber(d.latencyMs),
  "call.refused": (d) =>
    isNumber(d.index) &&
    hasAmounts(d, ["amount", "rollingSpend", "dailyCap"]) &&
    hasStrings(d, ["reason", "message", "facilitatorReason", "failedTransaction"]) &&
    Array.isArray(d.programLogs) &&
    d.programLogs.every(isString),
  "run.finished": (d) =>
    isNumber(d.settledCalls) &&
    isNumber(d.refusedCalls) &&
    hasAmounts(d, ["totalSpent", "withdrawn"]) &&
    (d.withdrawTransaction === null || isString(d.withdrawTransaction)) &&
    Array.isArray(d.receipts) &&
    isNumber(d.durationMs),
  "run.failed": (d) =>
    hasStrings(d, ["reason", "message"]) &&
    (d.withdrawn === undefined || isAmount(d.withdrawn)) &&
    (d.withdrawTransaction === undefined ||
      d.withdrawTransaction === null ||
      isString(d.withdrawTransaction)),
};

/** Returns the event when the value has the runner's event shape, otherwise null. */
export function parseRunEvent(value: unknown): RunEvent | null {
  if (!isObject(value)) return null;
  const { runId, seq, type, data, at } = value;
  if (!isString(runId) || !isNumber(seq) || !isString(at) || !isObject(data)) return null;
  if (!RUN_EVENT_TYPES.includes(type as RunEventType)) return null;
  if (!dataChecks[type as RunEventType](data)) return null;
  return value as unknown as RunEvent;
}

function parseRun(value: unknown): RunRecord | null {
  if (!isObject(value)) return null;
  const { id, status, agentWallet, startedAt, finishedAt, error } = value;
  if (!isString(id) || !isString(startedAt)) return null;
  if (status !== "running" && status !== "finished" && status !== "failed") return null;
  return {
    id,
    status,
    agentWallet: isString(agentWallet) ? agentWallet : null,
    startedAt,
    finishedAt: isString(finishedAt) ? finishedAt : null,
    error: isString(error) ? error : null,
  };
}

/** Parses the body of GET /runs/latest and GET /runs/:id. Events that fail the check are dropped. */
export function parseSnapshot(value: unknown): RunSnapshot | null {
  if (!isObject(value)) return null;
  const run = parseRun(value.run);
  if (!run || !Array.isArray(value.events)) return null;
  const events = value.events
    .map(parseRunEvent)
    .filter((event): event is RunEvent => event !== null && event.runId === run.id)
    .sort((a, b) => a.seq - b.seq);
  return { run, events };
}

export interface ApiError {
  code: string;
  message: string;
  /** Set on run_in_progress, the run that holds the lock. */
  runId?: string;
}

/** Reads the runner's `{ error: { code, message } }` body. */
export function parseApiError(value: unknown): ApiError | null {
  if (!isObject(value) || !isObject(value.error)) return null;
  const { code, message } = value.error;
  if (!isString(code) || !isString(message)) return null;
  return { code, message, ...(isString(value.runId) ? { runId: value.runId } : {}) };
}
