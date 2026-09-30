import type { Metadata } from "next";
import { capturedOn } from "../_components/Captured";
import { DocHeader, Note } from "../_components/Doc";
import styles from "../_components/docs.module.css";
import capture from "../_examples/capture.json";
import consoleCapture from "../_examples/console.json";
import { AgentSdkSection } from "./AgentSdkSection";
import { ConsoleApiSection } from "./ConsoleApiSection";
import { ErrorsSection } from "./ErrorsSection";
import { FacilitatorSection } from "./FacilitatorSection";
import { ResourceSdkSection } from "./ResourceSdkSection";

export const metadata: Metadata = {
  title: "API reference",
  description:
    "The facilitator interface, the SDK options and the console endpoints, with real requests and responses.",
};

const ownerTx = (consoleCapture.txConfirm.response as { signature: string }).signature;

export default function Page() {
  return (
    <article>
      <DocHeader eyebrow="Reference" title="API reference">
        The facilitator endpoints, the x402 headers, both SDKs, the console API and every error
        name.
      </DocHeader>
      <Note>
        <p>
          Every request and response on this page was captured from a local validator run on{" "}
          {capturedOn}, not written by hand. A solana-test-validator from Agave 4.0.2 ran both
          programs, with the facilitator, the indexer and the console backend beside it. The
          resource SDK served the routes and the agent SDK paid them.
        </p>
        <dl className={styles.meta}>
          <dt>Payment transaction</dt>
          <dd>{capture.paymentTransaction}</dd>
          <dt>Receipt</dt>
          <dd>{capture.receipt}</dd>
          <dt>Agent wallet</dt>
          <dd>{capture.agentWallet}</dd>
          <dt>Owner transaction</dt>
          <dd>{ownerTx}</dd>
          <dt>Genesis hash</dt>
          <dd>{capture.genesisHash}</dd>
        </dl>
        <p>
          The scripts that made them are <code>_examples/capture.ts</code> and{" "}
          <code>_examples/capture-console.ts</code> in the docs folder of the web app.
        </p>
      </Note>
      <FacilitatorSection />
      <ResourceSdkSection />
      <AgentSdkSection />
      <ConsoleApiSection />
      <ErrorsSection />
    </article>
  );
}
