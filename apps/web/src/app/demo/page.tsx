import { explorerAddressUrl, NETWORKS, SETTLEMENT_PROGRAM_ID } from "@turnstile/shared";
import type { Metadata } from "next";
import { demoNetwork } from "./_lib/network";
import { loadLatestRun, loadPolicy } from "./_lib/runner";
import { DemoRun } from "./_parts/DemoRun";
import styles from "./_parts/demo.module.css";

export const metadata: Metadata = {
  title: "Live demo",
  description:
    "Watch a real agent pay a real metered API on Solana, one call at a time, until the chain refuses the call that would pass its daily cap.",
};

// Every visit reads the latest run from the demo agent.
export const dynamic = "force-dynamic";

export default async function Page() {
  const [latest, policy] = await Promise.all([loadLatestRun(), loadPolicy()]);
  const initial = latest.ok ? latest.value : null;
  const startedPolicy = initial?.events.find((e) => e.type === "run.started");
  const reported = policy.ok
    ? policy.value.network
    : startedPolicy?.type === "run.started"
      ? startedPolicy.data.policy.network
      : undefined;
  const network = demoNetwork(reported);
  const settlement = SETTLEMENT_PROGRAM_ID.toBase58();

  return (
    <div className={styles.page}>
      <header className={styles.intro}>
        <p className={`label ${styles.eyebrow}`}>Live demo</p>
        <h1 className={styles.title}>Watch an agent pay its way, then hit its limit.</h1>
        <p className={styles.lead}>
          A real agent pays a real metered API on {network.label}. Every call settles on its own and
          leaves a receipt. When the next call would pass the daily cap, the chain refuses it.
        </p>
      </header>
      <DemoRun
        network={network}
        policy={policy.ok ? policy.value : null}
        initial={initial}
        offline={!latest.ok && !policy.ok}
        settlementProgram={{
          address: settlement,
          url: explorerAddressUrl(NETWORKS[network.name], settlement),
        }}
      />
    </div>
  );
}
