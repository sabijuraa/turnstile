import { PublicKey } from "@solana/web3.js";
import {
  AGENT_WALLET_PROGRAM_ID,
  bucketIndex,
  bytesToHex,
  formatUnits,
  rollingSpend,
  SPEND_BUCKET_SECONDS,
  vaultAddress,
} from "@turnstile/shared";
import {
  type AgentWalletAccount,
  agentWalletIdl,
  decodeAgentWallet,
} from "@turnstile/shared/programs";
import bs58 from "bs58";
import type { Pool } from "pg";
import { ApiError } from "../errors.js";
import type { SolanaRpc } from "./directory.js";
import { decodeTokenAccount } from "./token.js";

const discriminator = agentWalletIdl.accounts.find((a) => a.name === "AgentWallet")?.discriminator;
if (!discriminator) throw new Error("The agent_wallet IDL has no AgentWallet account");
const AGENT_WALLET_DISCRIMINATOR = bs58.encode(Uint8Array.from(discriminator));

export interface OwnedWallet {
  address: PublicKey;
  account: AgentWalletAccount;
}

/** Every AgentWallet account whose owner field is this owner, oldest first. */
export async function listOwnerWalletAccounts(
  rpc: SolanaRpc,
  owner: PublicKey,
): Promise<OwnedWallet[]> {
  const accounts = await rpc.getProgramAccounts(AGENT_WALLET_PROGRAM_ID, {
    commitment: "confirmed",
    filters: [
      { memcmp: { offset: 0, bytes: AGENT_WALLET_DISCRIMINATOR } },
      { memcmp: { offset: 8, bytes: owner.toBase58() } },
    ],
  });
  return accounts
    .map((a) => ({ address: a.pubkey, account: decodeAgentWallet(a.account.data) }))
    .sort((a, b) => (a.account.id < b.account.id ? -1 : a.account.id > b.account.id ? 1 : 0));
}

/** Loads an agent wallet and proves the signed-in owner owns it. */
export async function loadOwnedWallet(
  rpc: SolanaRpc,
  address: string,
  owner: string,
): Promise<OwnedWallet> {
  const key = new PublicKey(address);
  const info = await rpc.getAccountInfo(key, "confirmed");
  if (!info?.owner.equals(AGENT_WALLET_PROGRAM_ID)) {
    throw new ApiError(
      404,
      "agent_not_found",
      `No agent wallet exists at ${address} on this network. Check the address or refresh the agent list.`,
    );
  }
  const account = decodeAgentWallet(info.data);
  if (account.owner.toBase58() !== owner) {
    throw new ApiError(
      403,
      "not_agent_owner",
      "This agent wallet does not belong to the signed-in owner. Sign in with the wallet that created it.",
    );
  }
  return { address: key, account };
}

/** Vault balances in one RPC call. A missing vault reads as zero. */
export async function vaultBalances(rpc: SolanaRpc, wallets: PublicKey[]): Promise<bigint[]> {
  if (wallets.length === 0) return [];
  const vaults = wallets.map((w) => vaultAddress(w)[0]);
  const infos = await rpc.getMultipleAccountsInfo(vaults, "confirmed");
  return infos.map((info) =>
    info ? (decodeTokenAccount(info.data, info.owner)?.amount ?? 0n) : 0n,
  );
}

export interface Money {
  amount: string;
  displayAmount: string;
}

export function money(value: bigint, decimals: number): Money {
  return { amount: value.toString(), displayAmount: formatUnits(value, decimals) };
}

export type AgentStatus =
  | "active"
  | "near_cap"
  | "at_cap"
  | "unfunded"
  | "no_allow_list"
  | "no_active_key";

export interface SessionKeyView {
  key: string;
  expiresAt: string | null;
  active: boolean;
  status: "active" | "revoked" | "expired";
}

export interface AgentSummaryView {
  address: string;
  id: string;
  label: string | null;
  mint: string;
  vault: string;
  vaultBalance: Money;
  perCallCap: Money;
  dailyCap: Money;
  /** Spend that counts toward the daily cap right now, over the rolling 24 hour window. */
  rollingSpend: Money;
  /** Spend since 00:00 UTC today. */
  todaySpend: Money;
  /** Rolling spend over the daily cap, 0 when the cap is 0. */
  capUsage: number;
  status: AgentStatus;
  /** Every condition that needs attention, most urgent first. `status` is the first one. */
  attention: AgentStatus[];
  sessionKeys: { active: number; total: number };
  allowListCount: number;
  totalSpent: Money;
  settlementCount: string;
  createdAt: string;
}

export interface AllowListView {
  resourceId: string;
  resource: string | null;
  recipient: string;
}

export interface AgentDetailView extends AgentSummaryView {
  owner: string;
  sessionKeyList: SessionKeyView[];
  allowList: AllowListView[];
}

function sessionKeyView(
  k: AgentWalletAccount["policy"]["sessionKeys"][number],
  nowUnix: bigint,
): SessionKeyView {
  const expired = k.expiresAt !== 0n && nowUnix > k.expiresAt;
  return {
    key: k.key.toBase58(),
    expiresAt: k.expiresAt === 0n ? null : new Date(Number(k.expiresAt) * 1000).toISOString(),
    active: k.active,
    status: !k.active ? "revoked" : expired ? "expired" : "active",
  };
}

export function summarizeAgent(
  w: OwnedWallet,
  balance: bigint,
  label: string | null,
  now: Date,
  decimals: number,
): AgentSummaryView {
  const a = w.account;
  const nowUnix = BigInt(Math.floor(now.getTime() / 1000));
  const rolling = rollingSpend(a.policy.spendBuckets, nowUnix);
  const dayStart = BigInt(Math.floor(now.getTime() / 86_400_000) * 86_400);
  const firstToday = bucketIndex(dayStart);
  const nowIndex = nowUnix / BigInt(SPEND_BUCKET_SECONDS);
  let today = 0n;
  for (const b of a.policy.spendBuckets) {
    if (b.amount > 0n && b.index >= firstToday && b.index <= nowIndex) today += b.amount;
  }
  const keys = a.policy.sessionKeys.map((k) => sessionKeyView(k, nowUnix));
  const activeKeys = keys.filter((k) => k.status === "active").length;
  const daily = a.policy.dailyCap;
  const attention: AgentStatus[] = [];
  if (activeKeys === 0) attention.push("no_active_key");
  if (a.policy.allowList.length === 0) attention.push("no_allow_list");
  if (balance === 0n) attention.push("unfunded");
  if (daily > 0n && rolling >= daily) attention.push("at_cap");
  else if (daily > 0n && rolling * 10n >= daily * 8n) attention.push("near_cap");
  return {
    address: w.address.toBase58(),
    id: a.id.toString(),
    label,
    mint: a.mint.toBase58(),
    vault: a.vault.toBase58(),
    vaultBalance: money(balance, decimals),
    perCallCap: money(a.policy.perCallCap, decimals),
    dailyCap: money(daily, decimals),
    rollingSpend: money(rolling, decimals),
    todaySpend: money(today, decimals),
    capUsage: daily > 0n ? Number((rolling * 10_000n) / daily) / 10_000 : 0,
    status: attention[0] ?? "active",
    attention,
    sessionKeys: { active: activeKeys, total: keys.length },
    allowListCount: a.policy.allowList.length,
    totalSpent: money(a.totalSpent, decimals),
    settlementCount: a.settlementCount.toString(),
    createdAt: new Date(Number(a.createdAt) * 1000).toISOString(),
  };
}

export async function labelsFor(pool: Pool, owner: string): Promise<Map<string, string>> {
  const { rows } = await pool.query<{ agent_wallet: string; label: string }>(
    "SELECT agent_wallet, label FROM agent_labels WHERE owner = $1",
    [owner],
  );
  return new Map(rows.map((r) => [r.agent_wallet, r.label]));
}

export async function detailAgent(
  pool: Pool,
  w: OwnedWallet,
  balance: bigint,
  label: string | null,
  now: Date,
  decimals: number,
): Promise<AgentDetailView> {
  const nowUnix = BigInt(Math.floor(now.getTime() / 1000));
  const ids = w.account.policy.allowList.map((e) => bytesToHex(e.resourceId));
  const { rows } = await pool.query<{ resource_id: string; resource: string }>(
    "SELECT resource_id, resource FROM resources WHERE resource_id = ANY($1::text[])",
    [ids],
  );
  const names = new Map(rows.map((r) => [r.resource_id, r.resource]));
  return {
    ...summarizeAgent(w, balance, label, now, decimals),
    owner: w.account.owner.toBase58(),
    sessionKeyList: w.account.policy.sessionKeys.map((k) => sessionKeyView(k, nowUnix)),
    allowList: w.account.policy.allowList.map((e) => {
      const id = bytesToHex(e.resourceId);
      return { resourceId: id, resource: names.get(id) ?? null, recipient: e.recipient.toBase58() };
    }),
  };
}
