/** A token amount in base units plus its human form, for example 5000 and "0.005". */
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
  /** What the facilitator said when it refused the payment. */
  facilitatorReason: string;
  /** Signature of the settlement transaction sent straight to the chain, which failed. */
  failedTransaction: string;
  /** Program log lines that name the error. */
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

export interface RunEvent<T extends RunEventType = RunEventType> {
  runId: string;
  seq: number;
  type: T;
  data: RunEventMap[T];
  at: string;
}

export const TERMINAL_EVENTS: ReadonlySet<RunEventType> = new Set(["run.finished", "run.failed"]);

export type RunStatus = "running" | "finished" | "failed";

export interface RunRecord {
  id: string;
  status: RunStatus;
  agentWallet: string | null;
  walletId: string | null;
  owner: string;
  network: string;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
}
