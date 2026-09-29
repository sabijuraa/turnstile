/**
 * Response shapes of the console backend (packages/backend). Kept in step with the backend
 * README and its route handlers. Amounts arrive as base unit strings plus an exact decimal.
 */

export interface Money {
  amount: string;
  displayAmount: string;
}

export interface Me {
  owner: string;
  authMethod: "session" | "api_key";
  network: string;
  createdAt: string | null;
  lastSeenAt: string | null;
}

export interface Challenge {
  pubkey: string;
  nonce: string;
  message: string;
  issuedAt: string;
  expiresAt: string;
}

export interface ReceiptDto {
  receiptAddress: string;
  signature: string;
  slot: string;
  blockTime: string;
  agentWallet: string;
  agentLabel: string | null;
  owner: string;
  sessionKey: string;
  recipient: string;
  recipientToken: string;
  mint: string;
  amount: string;
  displayAmount: string;
  resourceId: string;
  resource: string | null;
  nonce: string;
  feePayer: string;
  network: string;
  status: "settled";
  explorerUrl: string;
}

export interface ReceiptPage {
  receipts: ReceiptDto[];
  nextCursor: string | null;
}

export type Range = "24h" | "7d" | "30d";

export interface SpendPoint {
  start: string;
  amount: string;
  displayAmount: string;
  count: number;
}

export interface SpendSeries {
  range: Range;
  bucket: "hour" | "day";
  from: string;
  to: string;
  series: SpendPoint[];
  totals: { amount: string; displayAmount: string; count: number };
}

export interface FailureDto {
  id: string;
  agentWallet: string;
  nonce: string;
  error: string;
  attempts: number;
  amount: string | null;
  displayAmount: string | null;
  resource: string | null;
  createdAt: string;
  updatedAt: string;
  status: "pending";
}

export interface Summary {
  range: Range;
  notices?: string[];
  from: string;
  to: string;
  totalSpend: Money;
  settlementCount: number;
  activeAgents: number;
  recentReceipts: ReceiptDto[];
  failures: { pendingCount: number; items: FailureDto[] };
}

export type AgentStatus =
  | "active"
  | "near_cap"
  | "at_cap"
  | "unfunded"
  | "no_allow_list"
  | "no_active_key";

export interface AgentSummary {
  address: string;
  id: string;
  label: string | null;
  mint: string;
  vault: string;
  vaultBalance: Money;
  perCallCap: Money;
  dailyCap: Money;
  rollingSpend: Money;
  todaySpend: Money;
  capUsage: number;
  status: AgentStatus;
  attention: AgentStatus[];
  sessionKeys: { active: number; total: number };
  allowListCount: number;
  totalSpent: Money;
  settlementCount: string;
  createdAt: string;
}

export interface SessionKeyDto {
  key: string;
  expiresAt: string | null;
  active: boolean;
  status: "active" | "revoked" | "expired";
}

export interface AllowEntryDto {
  resourceId: string;
  resource: string | null;
  recipient: string;
}

export interface AgentDetail extends AgentSummary {
  owner: string;
  sessionKeyList: SessionKeyDto[];
  allowList: AllowEntryDto[];
}

export interface ApiKeyDto {
  id: string;
  name: string;
  prefix: string;
  createdAt: string;
  lastUsedAt: string | null;
  revokedAt: string | null;
  status: "active" | "revoked";
}

export interface CreatedApiKey {
  apiKey: ApiKeyDto;
  key: string;
  notice: string;
}

export interface BuiltTransaction {
  transaction: string;
  description: string;
  instructions: string[];
}

export interface BuiltTransactions {
  action: string;
  network: string;
  agentWallet: string;
  id?: string;
  feePayer: string;
  recentBlockhash: string;
  lastValidBlockHeight: number;
  transactions: BuiltTransaction[];
}

export interface TxConfirmation {
  signature: string;
  status: "confirmed" | "finalized" | "pending" | "failed";
  slot: number | null;
  error: { code: number | null; name: string; message: string } | null;
  explorerUrl: string;
  message?: string;
}

/** Public facts about the deployment the web app runs against. Public keys only. */
export interface DeploymentInfo {
  network: string;
  programs: { agentWallet: string; settlement: string };
  mint: string | null;
  mintSymbol: string;
  mintDecimals: number;
  facilitator: string | null;
  facilitatorUrl: string | null;
}
