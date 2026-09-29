"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { type ReactNode, useEffect, useState } from "react";
import { Button } from "@/components/Button";
import { ToastProvider } from "@/components/Toast";
import { api, errorMessage } from "@/lib/console/api";
import { ConsoleSessionProvider } from "@/lib/console/context";
import type { DeploymentInfo, Me } from "@/lib/console/types";
import { useResource } from "@/lib/console/useResource";
import { shortAddress } from "@/lib/format";
import styles from "./console.module.css";
import { LoadError, Skeleton } from "./Page";

const nav = [
  { href: "/console", label: "Dashboard" },
  { href: "/console/agents", label: "Agents" },
  { href: "/console/receipts", label: "Receipts" },
  { href: "/console/settings", label: "Settings" },
] as const;

function isCurrent(pathname: string, href: string): boolean {
  return href === "/console" ? pathname === "/console" : pathname.startsWith(href);
}

function useDeployment() {
  const [deployment, setDeployment] = useState<DeploymentInfo | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [tick, setTick] = useState(0);
  // biome-ignore lint/correctness/useExhaustiveDependencies: tick is the retry trigger
  useEffect(() => {
    let live = true;
    fetch("/api/console/deployment", { cache: "no-store" })
      .then(async (response) => {
        if (!response.ok) throw new Error("The console could not read the network details.");
        return (await response.json()) as DeploymentInfo;
      })
      .then((value) => {
        if (live) setDeployment(value);
      })
      .catch((err: unknown) => {
        if (live) setError(err);
      });
    return () => {
      live = false;
    };
  }, [tick]);
  return { deployment, error, retry: () => setTick((t) => t + 1) };
}

function networkLabel(network: string): string {
  return network.charAt(0).toUpperCase() + network.slice(1);
}

export function ConsoleShell({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const me = useResource<Me>("/v1/me");
  const { deployment, error: deploymentError, retry } = useDeployment();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState<string | null>(null);

  async function signOut() {
    setSigningOut(true);
    setSignOutError(null);
    try {
      await api("/v1/auth/signout", { method: "POST", body: {} });
      window.location.assign("/signin?signedOut=1");
    } catch (error) {
      setSignOutError(errorMessage(error));
      setSigningOut(false);
    }
  }

  const session = me.data && deployment ? { me: me.data, deployment } : null;
  const failure = me.error ?? deploymentError;

  return (
    <ToastProvider>
      <div className={styles.bar}>
        <div className={styles.barInner}>
          <nav aria-label="Console">
            <ul className={styles.nav}>
              {nav.map((item) => (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    className={styles.navLink}
                    aria-current={isCurrent(pathname, item.href) ? "page" : undefined}
                  >
                    {item.label}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
          <div className={styles.account}>
            {me.data ? (
              <>
                <span className={styles.network}>
                  <span className={styles.networkDot} aria-hidden="true" />
                  <span className="visually-hidden">Network </span>
                  {networkLabel(me.data.network)}
                </span>
                <span className={styles.owner} title={me.data.owner}>
                  <span className="visually-hidden">Signed in as owner </span>
                  <span className={styles.ownerKey}>{shortAddress(me.data.owner, 4, 4)}</span>
                </span>
                <Button
                  variant="quiet"
                  size="sm"
                  onClick={signOut}
                  loading={signingOut}
                  loadingLabel="Signing out"
                >
                  Sign out
                </Button>
              </>
            ) : (
              <Skeleton width="15rem" height="2rem" />
            )}
          </div>
        </div>
      </div>
      <div className={styles.body}>
        {signOutError ? (
          <div style={{ marginBottom: "var(--space-5)" }}>
            <LoadError what="Sign out" error={new Error(signOutError)} onRetry={signOut} />
          </div>
        ) : null}
        {session ? (
          <ConsoleSessionProvider value={session}>{children}</ConsoleSessionProvider>
        ) : failure ? (
          <LoadError
            what="The console"
            error={failure}
            onRetry={() => {
              me.reload();
              retry();
            }}
          />
        ) : (
          <div aria-busy="true" style={{ display: "grid", gap: "var(--space-5)" }}>
            <span className="visually-hidden">Loading the console</span>
            <Skeleton width="14rem" height="2.5rem" />
            <Skeleton height="8rem" />
            <Skeleton height="16rem" />
          </div>
        )}
      </div>
    </ToastProvider>
  );
}
