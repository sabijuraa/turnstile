import { Icon } from "@/components/Icon";
import { shortAddress } from "@/lib/format";
import { explorerLink } from "../_lib/explorer";
import type { DemoNetwork } from "../_lib/network";
import { DEMO_ASSET, type RunView } from "../_lib/view";
import styles from "./demo.module.css";

interface Row {
  label: string;
  value: string;
  href?: string;
}

/** Where to check this run on the explorer. Every value comes from the run's own events. */
export function OnChain({
  view,
  network,
  settlementProgram,
}: {
  view: RunView;
  network: DemoNetwork;
  settlementProgram: { address: string; url: string };
}) {
  const { started, finished, failed } = view;
  const settled = view.calls.filter((c) => c.type === "call.settled").length;
  const refunded = finished
    ? { amount: finished.withdrawn, tx: finished.withdrawTransaction }
    : failed?.withdrawn
      ? { amount: failed.withdrawn, tx: failed.withdrawTransaction ?? null }
      : null;

  const rows: Row[] = [
    started
      ? {
          label: "Agent wallet",
          value: shortAddress(started.agentWallet),
          href: explorerLink(network.explorerAddress, started.agentWallet),
        }
      : { label: "Agent wallet", value: "Created when a run starts" },
    started
      ? {
          label: "Setup",
          value: shortAddress(started.setupTransaction),
          href: explorerLink(network.explorerTx, started.setupTransaction),
        }
      : { label: "Setup", value: "Not yet" },
    {
      label: "Receipts",
      value: settled === 1 ? "1 on chain" : `${settled} on chain`,
    },
    refunded
      ? {
          label: "Returned",
          value: `${refunded.amount.display} ${DEMO_ASSET} to the owner`,
          ...(refunded.tx ? { href: explorerLink(network.explorerTx, refunded.tx) } : {}),
        }
      : { label: "Returned", value: "At the end of the run" },
    {
      label: "Settlement program",
      value: shortAddress(settlementProgram.address),
      href: settlementProgram.url,
    },
  ];

  return (
    <section className={styles.onchain} aria-labelledby="onchain-title">
      <h2 id="onchain-title" className={styles.sideTitle}>
        <Icon name="receipt" size={18} />
        On chain
      </h2>
      <dl className={styles.facts}>
        {rows.map((row) => (
          <div key={row.label} className={styles.fact}>
            <dt>{row.label}</dt>
            <dd>
              {row.href ? (
                <a className={styles.factLink} href={row.href} target="_blank" rel="noreferrer">
                  {row.value}
                  <Icon name="arrowUpRight" size={14} />
                  <span className="visually-hidden"> (opens in a new tab)</span>
                </a>
              ) : (
                row.value
              )}
            </dd>
          </div>
        ))}
      </dl>
      <p className={styles.sideNote}>
        {network.name === "localnet"
          ? "This demo runs on a local Solana validator. Explorer links point at it on 127.0.0.1:8899, so they open on the machine that runs the demo."
          : "Every link opens Solana Explorer on devnet."}
      </p>
    </section>
  );
}
