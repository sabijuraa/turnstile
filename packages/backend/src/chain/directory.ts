import type { Connection } from "@solana/web3.js";
import { PublicKey } from "@solana/web3.js";
import { AGENT_WALLET_PROGRAM_ID } from "@turnstile/shared";
import type { Pool } from "pg";
import { listOwnerWalletAccounts } from "./agents.js";

/** The parts of a Solana connection the backend uses. Injected so tests and routes share one seam. */
export type SolanaRpc = Pick<
  Connection,
  | "getSlot"
  | "getAccountInfo"
  | "getProgramAccounts"
  | "getMultipleAccountsInfo"
  | "getLatestBlockhash"
  | "getSignatureStatuses"
  | "getTransaction"
>;

/** Answers which agent wallets belong to which owner. */
export interface AgentDirectory {
  /** Agent wallet addresses known to the indexer store for this owner, through receipts or labels. */
  walletsOf(owner: string): Promise<string[]>;
  /** Agent wallet addresses the chain says belong to this owner. */
  chainWalletsOf(owner: string): Promise<string[]>;
  /** True when the agent wallet belongs to this owner. */
  isOwnedBy(agentWallet: string, owner: string): Promise<boolean>;
}

/** Offset of the owner field in an AgentWallet account, after the 8 byte Anchor discriminator. */
export const AGENT_WALLET_OWNER_OFFSET = 8;

/**
 * Reads ownership from the indexer store first and falls back to the AgentWallet account on
 * chain, so a wallet with no receipts yet can still be proven.
 */
export function createAgentDirectory(pool: Pool, rpc: SolanaRpc): AgentDirectory {
  return {
    async walletsOf(owner) {
      const { rows } = await pool.query<{ agent_wallet: string }>(
        `SELECT DISTINCT agent_wallet FROM receipts WHERE owner = $1
         UNION
         SELECT agent_wallet FROM agent_labels WHERE owner = $1`,
        [owner],
      );
      return rows.map((r) => r.agent_wallet);
    },
    async chainWalletsOf(owner) {
      const wallets = await listOwnerWalletAccounts(rpc, new PublicKey(owner));
      return wallets.map((w) => w.address.toBase58());
    },
    async isOwnedBy(agentWallet, owner) {
      const { rowCount } = await pool.query(
        "SELECT 1 FROM receipts WHERE agent_wallet = $1 AND owner = $2 LIMIT 1",
        [agentWallet, owner],
      );
      if (rowCount && rowCount > 0) return true;
      const account = await rpc.getAccountInfo(new PublicKey(agentWallet), "confirmed");
      if (!account?.owner.equals(AGENT_WALLET_PROGRAM_ID)) return false;
      if (account.data.length < AGENT_WALLET_OWNER_OFFSET + 32) return false;
      const onChainOwner = new PublicKey(
        account.data.subarray(AGENT_WALLET_OWNER_OFFSET, AGENT_WALLET_OWNER_OFFSET + 32),
      );
      return onChainOwner.toBase58() === owner;
    },
  };
}
