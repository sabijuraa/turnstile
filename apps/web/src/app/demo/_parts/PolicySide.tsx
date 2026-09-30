import { InlineStatus } from "@/components/InlineStatus";
import { PolicyPanel } from "@/components/PolicyPanel";
import { shortAddress } from "@/lib/format";
import type { DemoPolicyView } from "../_lib/events";
import { DEMO_ASSET } from "../_lib/view";
import styles from "./demo.module.css";

/** Shows a resource as host and path, which is what a reader needs from the full URL. */
function shortResource(resource: string): string {
  try {
    const url = new URL(resource);
    return `${url.host}${url.pathname}`;
  } catch {
    // Not a URL. Show it as the runner sent it.
    return resource;
  }
}

export function PolicySide({
  policy,
  settleable,
}: {
  policy: DemoPolicyView | null;
  settleable: number | null;
}) {
  if (!policy) {
    return (
      <InlineStatus tone="caution" title="Policy not available">
        The demo agent did not answer, so the policy in force cannot be shown. Reload the page in a
        minute.
      </InlineStatus>
    );
  }
  return (
    <div className={styles.sideBlock}>
      <PolicyPanel
        title="Policy in force"
        headingLevel={2}
        perCallCap={policy.perCallCap.display}
        dailyCap={policy.dailyCap.display}
        asset={DEMO_ASSET}
        sessionKey={shortAddress(policy.sessionKey)}
        allowList={policy.allowList.map((entry) => ({
          resource: shortResource(entry.resource),
          recipient: shortAddress(entry.recipient),
        }))}
      />
      <ol className={styles.steps} aria-label="What happens in a run">
        <li>
          A fresh agent wallet is funded with {policy.funding.display} {DEMO_ASSET}.
        </li>
        <li>
          The agent pays {policy.pricePerCall.display} {DEMO_ASSET} for each summary it asks for.
        </li>
        <li>
          {settleable !== null
            ? `After ${settleable} calls it has spent the ${policy.dailyCap.display} daily cap.`
            : `It keeps paying while the daily cap of ${policy.dailyCap.display} allows.`}
        </li>
        <li>The next call is refused on chain and what is left goes back to the owner.</li>
      </ol>
    </div>
  );
}
