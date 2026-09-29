"use client";

import { getWallets } from "@wallet-standard/app";
import type { Wallet, WalletAccount } from "@wallet-standard/base";
import { createContext, type ReactNode, useContext } from "react";
import type { DeploymentInfo, Me } from "./types";
import {
  connectWallet,
  isOwnerCapable,
  rememberedWalletName,
  rememberWallet,
  WalletActionError,
} from "./wallet";

export interface ConsoleSession {
  me: Me;
  deployment: DeploymentInfo;
}

const SessionContext = createContext<ConsoleSession | null>(null);

export function ConsoleSessionProvider({
  value,
  children,
}: {
  value: ConsoleSession;
  children: ReactNode;
}) {
  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useConsoleSession(): ConsoleSession {
  const session = useContext(SessionContext);
  if (!session) throw new Error("useConsoleSession needs the console shell above it");
  return session;
}

export interface OwnerSigner {
  wallet: Wallet;
  account: WalletAccount;
}

/**
 * Finds the wallet that holds the signed-in owner key and connects it. The wallet used at sign in
 * is tried first. A wallet that shares a different account is refused, because only the owner
 * can sign policy and funding changes.
 */
export async function connectOwner(owner: string): Promise<OwnerSigner> {
  const wallets = getWallets().get().filter(isOwnerCapable);
  if (wallets.length === 0) {
    throw new WalletActionError(
      "unsupported",
      "No Solana wallet was found in this browser. Install or enable the wallet you signed in with, then try again.",
    );
  }
  const remembered = rememberedWalletName();
  const ordered = [...wallets].sort((a, b) =>
    a.name === remembered ? -1 : b.name === remembered ? 1 : 0,
  );
  let lastAccount: string | null = null;
  for (const wallet of ordered) {
    const existing = wallet.accounts.find((a) => a.address === owner);
    if (existing) return { wallet, account: existing };
    const account = await connectWallet(wallet);
    if (account.address === owner) {
      rememberWallet(wallet.name);
      return { wallet, account };
    }
    lastAccount = account.address;
  }
  throw new WalletActionError(
    "wrong_account",
    `Your wallet is on account ${lastAccount ?? "unknown"}, but this console belongs to ${owner}. Switch the wallet to the owner account and try again.`,
  );
}
