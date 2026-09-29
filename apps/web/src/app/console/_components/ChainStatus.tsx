"use client";

import { Icon } from "@/components/Icon";
import { InlineStatus } from "@/components/InlineStatus";
import type { ChainActionState } from "@/lib/console/useChainAction";
import { shortAddress } from "@/lib/format";
import styles from "./console.module.css";

function ExplorerLink({ href }: { href: string }) {
  return (
    <a href={href} target="_blank" rel="noreferrer" className={styles.textLink}>
      View on Solana Explorer
      <Icon name="external" size={14} />
      <span className="visually-hidden">(opens in a new tab)</span>
    </a>
  );
}

/**
 * Pending and confirmed state of one owner change on chain. `done` names the result in the same
 * words as the button, for example "Policy saved" for Save policy.
 */
export function ChainStatus({
  state,
  done,
  failed,
}: {
  state: ChainActionState;
  done: string;
  failed: string;
}) {
  switch (state.phase) {
    case "idle":
      return null;
    case "building":
      return (
        <InlineStatus tone="pending" title="Preparing the transaction">
          The console is building the change for your wallet to sign.
        </InlineStatus>
      );
    case "signing":
      return (
        <InlineStatus tone="pending" title="Approve in your wallet">
          {state.steps > 1 ? `Step ${state.step} of ${state.steps}. ` : ""}
          {state.description}. Your wallet signs as the owner and pays the network fee.
        </InlineStatus>
      );
    case "confirming":
      return (
        <InlineStatus tone="pending" title="Waiting for Solana to confirm">
          {state.steps > 1 ? `Step ${state.step} of ${state.steps}. ` : ""}
          Sent as <span className={styles.mono}>{shortAddress(state.signature, 6, 6)}</span>. This
          usually takes a few seconds.
        </InlineStatus>
      );
    case "confirmed":
      return (
        <InlineStatus tone="positive" title={done}>
          Confirmed on chain. {state.explorerUrl ? <ExplorerLink href={state.explorerUrl} /> : null}
        </InlineStatus>
      );
    case "failed":
      return (
        <InlineStatus tone="critical" title={failed}>
          {state.message} {state.explorerUrl ? <ExplorerLink href={state.explorerUrl} /> : null}
        </InlineStatus>
      );
  }
}
