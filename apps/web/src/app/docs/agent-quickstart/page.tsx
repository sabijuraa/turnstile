import type { Metadata } from "next";
import Link from "next/link";
import { CapturedNote } from "../_components/Captured";
import {
  Code,
  DocHeader,
  DocSection,
  DocSubhead,
  FieldTable,
  JsonBlock,
  Note,
  Prose,
  Sample,
} from "../_components/Doc";
import agentPayment from "../_examples/agent-payment.json";
import agentRefused from "../_examples/agent-refused.json";
import agentRejected from "../_examples/agent-rejected.json";
import capture from "../_examples/capture.json";

export const metadata: Metadata = {
  title: "Agent quickstart",
  description:
    "Generate a session key, create an agent wallet with a policy and let an agent pay a 402 with the agent SDK.",
};

const keygen = `pnpm exec turnstile-agent keygen --out keys/session.json
${capture.sessionKey}

pnpm exec turnstile-agent address keys/session.json
${capture.sessionKey}`;

const install = `{
  "dependencies": {
    "@turnstile/sdk-agent": "workspace:*"
  }
}`;

export default function Page() {
  return (
    <article>
      <DocHeader eyebrow="Agent quickstart" title="Let an agent pay">
        Give an agent its own wallet and a scoped key, set the limits, then let it pay a 402 with
        one fetch call.
      </DocHeader>

      <DocSection id="overview" title="What you will set up">
        <Prose>
          <p>Three things, in this order.</p>
          <ul>
            <li>A session key that lives with the agent and signs payments only.</li>
            <li>
              An agent wallet owned by you, with a per-call cap, a daily cap and an allow-list.
            </li>
            <li>
              The agent SDK, which pays a 402 inside that policy and refuses anything outside it.
            </li>
          </ul>
          <p>
            You need the local stack and a paid route from the{" "}
            <Link href="/docs/quickstart">quickstart</Link>. Add the SDK to the agent package.
          </p>
        </Prose>
        <Code code={install} language="JSON" name="package.json" />
      </DocSection>

      <DocSection id="session-key" title="Generate a session key">
        <Prose>
          <p>
            The <code>turnstile-agent</code> CLI ships with the agent SDK. <code>keygen</code>{" "}
            writes a Solana keypair file and prints only the public key.
          </p>
          <ul>
            <li>The file is written with mode 600, readable by you alone.</li>
            <li>It refuses to overwrite an existing file, so a live key is never lost.</li>
            <li>
              <code>address</code> prints the public key of a key file you already have.
            </li>
          </ul>
        </Prose>
        <Code code={keygen} language="Shell" />
        <Note tone="caution">
          <p>
            Keep the key file with the agent. Never paste it into the console or send it to a
            server. You register only the public key.
          </p>
        </Note>
      </DocSection>

      <DocSection id="wallet" title="Create an agent wallet and set a policy">
        <DocSubhead id="in-the-console">In the console</DocSubhead>
        <Prose>
          <p>
            Sign in with the wallet that will own the agent, then open{" "}
            <Link href="/console/agents/new">Create agent</Link> under Agents.
          </p>
          <ul>
            <li>Paste the session public key and choose when it expires, if ever.</li>
            <li>Set the per-call cap and the daily cap in whole tokens.</li>
            <li>Add each paid route the agent may use, with the address that receives payment.</li>
            <li>Choose an initial deposit for the vault.</li>
          </ul>
          <p>
            The console builds the transactions and your wallet signs them. Neither the console nor
            its backend ever sees your key or the agent key.
          </p>
        </Prose>
        <DocSubhead id="in-code">In code</DocSubhead>
        <Prose>
          <p>
            The same three instructions come from <code>@turnstile/shared/programs</code>. This
            script creates the wallet, funds the vault and sets the allow-list in one transaction.
          </p>
          <ul>
            <li>
              The wallet address is derived from the owner and a numeric <code>id</code>, so one
              owner can run many agents.
            </li>
            <li>
              An empty allow-list allows nothing. Each entry pairs a resource id with the recipient
              that may be paid for it.
            </li>
            <li>
              One <code>update_policy</code> takes at most 15 entries. It replaces the whole policy
              at once.
            </li>
          </ul>
        </Prose>
        <Sample file="owner-policy.ts" name="create-agent.ts" />
        <Prose>
          <p>
            <code>resourceId</code> hashes the canonical resource, the origin plus path with no
            query. It must match the <code>publicUrl</code> and path the server charges for.
          </p>
        </Prose>
      </DocSection>

      <DocSection id="pay" title="Pay a 402">
        <Prose>
          <p>
            <code>createAgent</code> returns an object with a <code>fetch</code> that behaves like
            the one you know. When a response is a 402 it pays and retries once.
          </p>
          <ul>
            <li>It reads the wallet and its policy from chain and caches them for 15 seconds.</li>
            <li>
              It checks the price, the allow-list, the caps and the vault balance before the key
              signs anything.
            </li>
            <li>
              It signs the authorization, retries with <code>PAYMENT-SIGNATURE</code> and attaches
              the settled payment to the response.
            </li>
          </ul>
        </Prose>
        <Sample file="agent-pay.ts" name="agent.ts" />
      </DocSection>

      <DocSection id="payment" title="Read res.payment">
        <Prose>
          <p>
            <code>res.payment</code> is set when the call paid. It is undefined for a route that was
            free.
          </p>
        </Prose>
        <CapturedNote />
        <JsonBlock value={agentPayment} name="res.payment" />
        <FieldTable
          caption="PaymentInfo fields"
          rows={[
            { name: "receipt", type: "string", detail: "Receipt account address on chain." },
            { name: "transaction", type: "string", detail: "Settlement transaction signature." },
            { name: "amount", type: "string", detail: "Base units as a decimal string." },
            { name: "resource", type: "string", detail: "Canonical resource that was paid." },
            { name: "network", type: "string", detail: "CAIP-2 network id." },
            { name: "payer", type: "string", detail: "The agent wallet that paid." },
            { name: "nonce", type: "string", detail: "Hex nonce of the authorization." },
            {
              name: "alreadySettled",
              type: "boolean",
              detail: "True when a retry returned the receipt of an earlier settlement.",
            },
          ]}
        />
      </DocSection>

      <DocSection id="errors" title="Handle refusals">
        <Prose>
          <p>Two errors cover the cases where a call did not pay.</p>
          <ul>
            <li>
              <code>PolicyRefusedError</code> means the payment was outside the policy. Nothing was
              signed and nothing was sent.
            </li>
            <li>
              <code>PaymentRejectedError</code> means the key signed and the server, the facilitator
              or the chain refused. The authorization and payload are attached.
            </li>
          </ul>
        </Prose>
        <DocSubhead>PolicyRefusedError</DocSubhead>
        <Prose>
          <p>
            Captured with a route priced at 0.02 against a per-call cap of 0.01. The agent sent the
            first unpaid request and stopped there.
          </p>
        </Prose>
        <JsonBlock value={agentRefused} name="PolicyRefusedError" />
        <DocSubhead>PaymentRejectedError</DocSubhead>
        <Prose>
          <p>
            The same route with <code>localPolicyCheck: false</code>. The facilitator ran the policy
            against chain and refused before anything settled.
          </p>
        </Prose>
        <JsonBlock value={agentRejected} name="PaymentRejectedError" />
        <Prose>
          <p>
            <code>reason</code> uses the on-chain error names where one applies. The{" "}
            <Link href="/docs/reference#agent-sdk">agent SDK reference</Link> lists them all.
          </p>
        </Prose>
      </DocSection>

      <DocSection id="rotate" title="Rotate or revoke a session key">
        <Prose>
          <p>
            The owner can add a key and revoke another in one transaction. A revoked key cannot
            authorize a payment, and the agent SDK refuses locally with{" "}
            <code>SessionKeyRevoked</code>.
          </p>
        </Prose>
        <Sample file="owner-session-keys.ts" name="rotate-key.ts" />
        <Prose>
          <p>
            A wallet holds up to four session keys. Each can carry an expiry in unix seconds, where
            0 means none.
          </p>
        </Prose>
      </DocSection>
    </article>
  );
}
