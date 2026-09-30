"use client";

import type { Wallet } from "@wallet-standard/base";
import { useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { Icon } from "@/components/Icon";
import { InlineStatus } from "@/components/InlineStatus";
import { api, ConsoleApiError, fetchSession } from "@/lib/console/api";
import type { Challenge } from "@/lib/console/types";
import {
  connectWallet,
  rememberedWalletName,
  rememberWallet,
  signText,
  useOwnerWallets,
  WalletActionError,
} from "@/lib/console/wallet";
import { shortAddress } from "@/lib/format";
import styles from "./signin.module.css";

type Phase = "idle" | "connecting" | "challenge" | "signing" | "verifying" | "done";

const phaseText: Record<Phase, string> = {
  idle: "",
  connecting: "Connecting your wallet",
  challenge: "Asking the console for a sign-in message",
  signing: "Sign the message in your wallet",
  verifying: "Checking the signature",
  done: "Signed in. Opening the console",
};

interface Problem {
  title: string;
  body: string;
}

function describe(error: unknown): Problem {
  if (error instanceof WalletActionError) {
    if (error.kind === "rejected") {
      return {
        title: "Signature declined",
        body: "The wallet did not sign the message, so you are not signed in. Press Sign in and approve the request. Signing costs nothing and sends no transaction.",
      };
    }
    return { title: "The wallet could not finish", body: error.message };
  }
  if (error instanceof ConsoleApiError) {
    if (error.code === "challenge_expired" || error.code === "challenge_used") {
      return {
        title: "Sign-in request expired",
        body: "The message is valid for five minutes and works once. Press Sign in to get a fresh one.",
      };
    }
    if (error.code === "network_error" || error.code === "backend_unavailable") {
      return { title: "Network problem", body: error.message };
    }
    if (error.code === "bad_signature") {
      return {
        title: "Signature did not match",
        body: "The wallet signed with a different key than the one it shared. Switch the wallet to one account and sign in again.",
      };
    }
    return { title: "Sign in failed", body: error.message };
  }
  return {
    title: "Sign in failed",
    body: "Something stopped the sign-in without a reason. Refresh the page and try again.",
  };
}

function nextPath(): string {
  const next = new URLSearchParams(window.location.search).get("next");
  return next?.startsWith("/console") ? next : "/console";
}

export function SignIn() {
  const { wallets, ready } = useOwnerWallets();
  const [chosen, setChosen] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>("idle");
  const [problem, setProblem] = useState<Problem | null>(null);
  const [account, setAccount] = useState<string | null>(null);
  const [signedOut, setSignedOut] = useState(false);

  useEffect(() => {
    setSignedOut(new URLSearchParams(window.location.search).has("signedOut"));
    const controller = new AbortController();
    fetchSession(controller.signal)
      .then((me) => {
        if (me) window.location.replace(nextPath());
      })
      .catch(() => undefined);
    return () => controller.abort();
  }, []);

  const remembered = typeof window === "undefined" ? null : rememberedWalletName();
  const selected: Wallet | undefined =
    wallets.find((w) => w.name === chosen) ??
    wallets.find((w) => w.name === remembered) ??
    wallets[0];
  const busy = phase !== "idle" && phase !== "done";

  async function signIn() {
    if (!selected) return;
    setProblem(null);
    try {
      setPhase("connecting");
      const connected = await connectWallet(selected);
      setAccount(connected.address);
      rememberWallet(selected.name);
      setPhase("challenge");
      const challenge = await api<Challenge>("/v1/auth/challenge", {
        method: "POST",
        body: { pubkey: connected.address },
      });
      setPhase("signing");
      const signature = await signText(selected, connected, challenge.message);
      setPhase("verifying");
      await api("/v1/auth/verify", {
        method: "POST",
        body: { pubkey: connected.address, nonce: challenge.nonce, signature },
      });
      setPhase("done");
      window.location.assign(nextPath());
    } catch (error) {
      setProblem(describe(error));
      setPhase("idle");
    }
  }

  return (
    <div className={styles.page}>
      <div className={styles.card}>
        <div className={styles.head}>
          <span className={styles.mark}>
            <Icon name="wallet" size={20} />
          </span>
          <h1 className={styles.title}>Sign in to the console</h1>
          <p className={styles.lead}>
            Connect the wallet that owns your agents and sign a short message. Signing proves the
            wallet is yours. It sends no transaction and costs nothing.
          </p>
        </div>

        {signedOut && phase === "idle" && !problem ? (
          <InlineStatus tone="positive" title="Signed out">
            Your console session has ended on this browser.
          </InlineStatus>
        ) : null}

        {!ready && wallets.length === 0 ? (
          <div className={styles.walletsLoading} aria-busy="true">
            <span className="visually-hidden">Looking for wallets</span>
          </div>
        ) : wallets.length === 0 ? (
          <div className={styles.none}>
            <p className={styles.noneTitle}>No Solana wallet found in this browser</p>
            <p className={styles.noneText}>
              The console signs you in with the wallet that owns your agents. Install a Solana
              wallet that supports the Wallet Standard, such as{" "}
              <a href="https://phantom.com/download" target="_blank" rel="noreferrer">
                Phantom
              </a>
              ,{" "}
              <a href="https://solflare.com/download" target="_blank" rel="noreferrer">
                Solflare
              </a>{" "}
              or{" "}
              <a href="https://backpack.app/downloads" target="_blank" rel="noreferrer">
                Backpack
              </a>
              , then reload this page.
            </p>
          </div>
        ) : (
          <fieldset className={styles.wallets} disabled={busy}>
            <legend className={styles.legend}>Wallet</legend>
            {wallets.map((wallet) => (
              <label key={wallet.name} className={styles.wallet}>
                <input
                  type="radio"
                  name="wallet"
                  value={wallet.name}
                  checked={selected?.name === wallet.name}
                  onChange={() => setChosen(wallet.name)}
                />
                {/* biome-ignore lint/performance/noImgElement: wallet icons are data URIs from the extension */}
                <img
                  src={wallet.icon}
                  alt=""
                  width={24}
                  height={24}
                  className={styles.walletIcon}
                />
                <span className={styles.walletName}>{wallet.name}</span>
                {remembered === wallet.name ? (
                  <span className={styles.walletNote}>Used last time</span>
                ) : null}
              </label>
            ))}
          </fieldset>
        )}

        {problem ? (
          <InlineStatus tone="critical" title={problem.title}>
            {problem.body}
          </InlineStatus>
        ) : null}

        {busy || phase === "done" ? (
          <InlineStatus tone={phase === "done" ? "positive" : "pending"} title={phaseText[phase]}>
            {account ? (
              <>
                Owner <span className={styles.mono}>{shortAddress(account, 6, 6)}</span>
              </>
            ) : (
              "Approve the request in your wallet when it opens."
            )}
          </InlineStatus>
        ) : null}

        <Button
          onClick={signIn}
          disabled={!selected}
          loading={busy}
          loadingLabel={phaseText[phase] || "Signing in"}
          icon="arrowRight"
          className={styles.primary}
        >
          {selected ? `Sign in with ${selected.name}` : "Sign in"}
        </Button>

        <p className={styles.foot}>
          Your wallet keeps the owner key. The console never sees it and never sees an agent key.
        </p>
      </div>
    </div>
  );
}
