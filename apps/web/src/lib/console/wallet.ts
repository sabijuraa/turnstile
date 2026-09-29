"use client";

/**
 * A lean Wallet Standard integration for the owner wallet. It discovers installed wallets,
 * connects, signs the sign-in message and signs owner transactions. No keys ever live here.
 */

import {
  SolanaSignAndSendTransaction,
  type SolanaSignAndSendTransactionFeature,
  SolanaSignMessage,
  type SolanaSignMessageFeature,
  SolanaSignTransaction,
  type SolanaSignTransactionFeature,
} from "@solana/wallet-standard-features";
import { getWallets } from "@wallet-standard/app";
import type { IdentifierString, Wallet, WalletAccount } from "@wallet-standard/base";
import {
  StandardConnect,
  type StandardConnectFeature,
  StandardDisconnect,
  type StandardDisconnectFeature,
} from "@wallet-standard/features";
import bs58 from "bs58";
import { useEffect, useState } from "react";

const REMEMBERED_WALLET = "turnstile.console.wallet";

export class WalletActionError extends Error {
  readonly kind: "rejected" | "unsupported" | "no_account" | "wrong_account" | "failed";

  constructor(kind: WalletActionError["kind"], message: string) {
    super(message);
    this.name = "WalletActionError";
    this.kind = kind;
  }
}

/** A wallet that can act as the owner authority. It must connect and sign messages. */
export function isOwnerCapable(wallet: Wallet): boolean {
  return (
    StandardConnect in wallet.features &&
    SolanaSignMessage in wallet.features &&
    (SolanaSignTransaction in wallet.features || SolanaSignAndSendTransaction in wallet.features) &&
    wallet.chains.some((chain) => chain.startsWith("solana:"))
  );
}

/** Live list of installed wallets that can sign for an owner. */
export function useOwnerWallets(): { wallets: readonly Wallet[]; ready: boolean } {
  const [wallets, setWallets] = useState<readonly Wallet[]>([]);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const registry = getWallets();
    const refresh = () => setWallets(registry.get().filter(isOwnerCapable));
    refresh();
    // Wallet extensions register a moment after the page loads. Give them a beat before
    // saying none were found.
    const timer = setTimeout(() => setReady(true), 600);
    const offRegister = registry.on("register", refresh);
    const offUnregister = registry.on("unregister", refresh);
    return () => {
      clearTimeout(timer);
      offRegister();
      offUnregister();
    };
  }, []);
  return { wallets, ready };
}

export function rememberWallet(name: string): void {
  try {
    window.localStorage.setItem(REMEMBERED_WALLET, name);
  } catch {
    // Storage can be blocked. The console then asks which wallet to use each time.
  }
}

export function rememberedWalletName(): string | null {
  try {
    return window.localStorage.getItem(REMEMBERED_WALLET);
  } catch {
    return null;
  }
}

function isRejection(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const code = (error as Error & { code?: unknown }).code;
  return code === 4001 || /reject|denied|declined|cancel/i.test(error.message);
}

function wrap(error: unknown, action: string): WalletActionError {
  if (error instanceof WalletActionError) return error;
  if (isRejection(error)) {
    return new WalletActionError(
      "rejected",
      `The wallet request to ${action} was declined. Approve it in your wallet to continue.`,
    );
  }
  const detail = error instanceof Error && error.message ? ` The wallet said ${error.message}` : "";
  return new WalletActionError(
    "failed",
    `The wallet could not ${action}.${detail} Unlock the wallet and try again.`,
  );
}

/** Connects and returns the first Solana account the wallet exposes. */
export async function connectWallet(wallet: Wallet, silent = false): Promise<WalletAccount> {
  const feature = (wallet.features as Partial<StandardConnectFeature>)[StandardConnect];
  if (!feature) {
    throw new WalletActionError("unsupported", `${wallet.name} cannot connect to this site.`);
  }
  let accounts: readonly WalletAccount[];
  try {
    ({ accounts } = await feature.connect(silent ? { silent: true } : undefined));
  } catch (error) {
    throw wrap(error, "connect");
  }
  const account = accounts.find((a) => a.chains.some((c) => c.startsWith("solana:")));
  if (!account) {
    throw new WalletActionError(
      "no_account",
      `${wallet.name} did not share a Solana account. Add or unlock an account in the wallet and try again.`,
    );
  }
  return account;
}

export async function disconnectWallet(wallet: Wallet): Promise<void> {
  const feature = (wallet.features as Partial<StandardDisconnectFeature>)[StandardDisconnect];
  if (!feature) return;
  try {
    await feature.disconnect();
  } catch (error) {
    console.warn("Wallet disconnect failed", error);
  }
}

/** Signs UTF-8 text and returns the 64 byte signature in base58. */
export async function signText(
  wallet: Wallet,
  account: WalletAccount,
  text: string,
): Promise<string> {
  const feature = (wallet.features as Partial<SolanaSignMessageFeature>)[SolanaSignMessage];
  if (!feature) {
    throw new WalletActionError("unsupported", `${wallet.name} cannot sign messages.`);
  }
  try {
    const [output] = await feature.signMessage({
      account,
      message: new TextEncoder().encode(text),
    });
    if (!output) throw new Error("no signature came back");
    return bs58.encode(output.signature);
  } catch (error) {
    throw wrap(error, "sign the sign-in message");
  }
}

function base64ToBytes(value: string): Uint8Array {
  const binary = atob(value);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function relay(signedTransaction: Uint8Array): Promise<string> {
  let response: Response;
  try {
    response = await fetch("/api/console/send", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ transaction: bytesToBase64(signedTransaction) }),
    });
  } catch {
    throw new WalletActionError(
      "failed",
      "The signed transaction could not be sent because the network is unreachable. Check your connection and try again.",
    );
  }
  const body = (await response.json().catch(() => null)) as {
    signature?: string;
    error?: { message?: string };
  } | null;
  if (!response.ok || !body?.signature) {
    throw new WalletActionError(
      "failed",
      body?.error?.message ??
        `Solana refused the transaction with status ${response.status}. Try again in a moment.`,
    );
  }
  return body.signature;
}

/**
 * Signs one unsigned owner transaction from the backend and sends it. Returns the signature.
 * The wallet sends it itself when it supports this network. Otherwise the wallet only signs
 * and the web server passes the signed bytes to the network's RPC.
 */
export async function signAndSend(
  wallet: Wallet,
  account: WalletAccount,
  transactionBase64: string,
  network: string,
): Promise<string> {
  const chain = `solana:${network}` as IdentifierString;
  const transaction = base64ToBytes(transactionBase64);
  const sendFeature = (wallet.features as Partial<SolanaSignAndSendTransactionFeature>)[
    SolanaSignAndSendTransaction
  ];
  const signFeature = (wallet.features as Partial<SolanaSignTransactionFeature>)[
    SolanaSignTransaction
  ];
  const walletSends =
    sendFeature && wallet.chains.includes(chain) && account.chains.includes(chain);
  if (walletSends) {
    try {
      const [output] = await sendFeature.signAndSendTransaction({
        account,
        chain,
        transaction,
        options: { preflightCommitment: "confirmed" },
      });
      if (!output) throw new Error("no signature came back");
      return bs58.encode(output.signature);
    } catch (error) {
      throw wrap(error, "sign and send the transaction");
    }
  }
  if (!signFeature) {
    throw new WalletActionError(
      "unsupported",
      `${wallet.name} cannot send transactions on ${network}. Switch the wallet to ${network} or use a wallet that can sign transactions.`,
    );
  }
  let signed: Uint8Array;
  try {
    const [output] = await signFeature.signTransaction({ account, transaction });
    if (!output) throw new Error("no signed transaction came back");
    signed = output.signedTransaction;
  } catch (error) {
    throw wrap(error, "sign the transaction");
  }
  return relay(signed);
}
