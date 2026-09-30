import type { Metadata } from "next";
import Link from "next/link";
import { CapturedNote } from "../_components/Captured";
import {
  Code,
  DocHeader,
  DocSection,
  DocSubhead,
  JsonBlock,
  Note,
  Prose,
  Sample,
} from "../_components/Doc";
import styles from "../_components/docs.module.css";
import http402 from "../_examples/http-402.json";
import httpPaid from "../_examples/http-paid.json";
import receipt from "../_examples/receipt.json";

export const metadata: Metadata = {
  title: "Quickstart",
  description:
    "Wrap an endpoint with the resource SDK, run a local stack and take a first payment.",
};

const stackCommands = `pnpm install
pnpm build

# Validator and Postgres in docker, migrations, test stablecoin and keys
pnpm dev:up

# The same with solana-test-validator on this machine instead of docker
pnpm dev:up --native`;

const facilitatorCommand = `DATABASE_URL=postgres://turnstile:turnstile@127.0.0.1:5433/turnstile \\
DEPLOYMENT_FILE=deployments/localnet.json \\
FACILITATOR_KEYPAIR=keys/localnet/facilitator.json \\
pnpm --filter @turnstile/facilitator start`;

const fullStack = `# Every service in docker, web on http://localhost:3000
pnpm stack:up

# Stop it and keep the ledger and database
pnpm stack:down`;

const install = `{
  "dependencies": {
    "@turnstile/sdk-resource": "workspace:*"
  }
}`;

const runServer = `PAY_TO=$(node -p "require('./deployments/localnet.json').demoRecipient") \\
FACILITATOR_URL=http://127.0.0.1:4020 \\
npx tsx server.ts`;

const curl = `curl -i -X POST http://127.0.0.1:4030/v1/summarize \\
  -H 'content-type: application/json' \\
  -d '{"text":"Turnstile settles one payment per request. It runs on Solana."}'`;

function http402Text(): string {
  const url = new URL(http402.request.url);
  return [
    `${http402.request.method} ${url.pathname} HTTP/1.1`,
    `Host: ${url.host}`,
    "",
    `HTTP/1.1 ${http402.status} Payment Required`,
    `content-type: ${http402.headers["content-type"]}`,
    `PAYMENT-REQUIRED: ${http402.headers["PAYMENT-REQUIRED"]}`,
  ].join("\n");
}

function paidText(): string {
  const url = new URL(httpPaid.request.url);
  return [
    `${httpPaid.request.method} ${url.pathname} HTTP/1.1`,
    `Host: ${url.host}`,
    `PAYMENT-SIGNATURE: ${httpPaid.request.headers["PAYMENT-SIGNATURE"]}`,
    "",
    `HTTP/1.1 ${httpPaid.status} OK`,
    `PAYMENT-RESPONSE: ${httpPaid.headers["PAYMENT-RESPONSE"]}`,
    "",
    JSON.stringify(httpPaid.body),
  ].join("\n");
}

export default function Page() {
  return (
    <article>
      <DocHeader eyebrow="Quickstart" title="Charge per request">
        Put a price on one route with the resource SDK, run a local stack and watch a real payment
        settle on chain.
      </DocHeader>

      <DocSection id="before" title="Before you start">
        <Prose>
          <p>You need a few things on your machine.</p>
          <ul>
            <li>Node 22 and pnpm 11.</li>
            <li>
              Docker, or the Agave 4.0.2 release if you run the validator natively with{" "}
              <code className={styles.flag}>--native</code>.
            </li>
            <li>A clone of the Turnstile repository. The SDKs are workspace packages.</li>
          </ul>
        </Prose>
      </DocSection>

      <DocSection id="local-stack" title="Run a local stack">
        <Prose>
          <p>These scripts exist in the root package.json today.</p>
          <ul>
            <li>
              <code>pnpm dev:up</code> starts a validator with both programs and Postgres on port
              5433. It applies the migrations and writes <code>deployments/localnet.json</code> and
              the keys in <code>keys/localnet</code>.
            </li>
            <li>
              <code>pnpm stack:up</code> builds and starts every service with docker compose.
            </li>
          </ul>
        </Prose>
        <Code code={stackCommands} language="Shell" />
        <Prose>
          <p>
            With <code>dev:up</code> you run the facilitator yourself. It listens on port 4020.
          </p>
        </Prose>
        <Code code={facilitatorCommand} language="Shell" />
        <Prose>
          <p>Or run the whole product in containers.</p>
        </Prose>
        <Code code={fullStack} language="Shell" />
        <Note>
          <p>
            The bootstrap creates tUSDC, a worthless 6 decimal test stablecoin, and funds a demo
            owner with 1000 of it. It also picks a demo recipient address you can use as{" "}
            <code>payTo</code>.
          </p>
        </Note>
      </DocSection>

      <DocSection id="install" title="Add the resource SDK">
        <Prose>
          <p>
            Add the package to your server package in the monorepo. Hono is an optional peer
            dependency, needed only for <code>honoPaywall</code>.
          </p>
        </Prose>
        <Code code={install} language="JSON" name="package.json" />
      </DocSection>

      <DocSection id="wrap" title="Wrap an endpoint">
        <Prose>
          <p>The paywall sits in front of your routes. You list the paid ones with a price.</p>
          <ul>
            <li>
              Routes are keyed by <code>METHOD /path</code>. Anything not listed passes through.
            </li>
            <li>
              <code>price</code> is a decimal in whole tokens. <code>0.005</code> is 5000 base units
              of a 6 decimal stablecoin.
            </li>
            <li>
              <code>payTo</code> is the address that receives the money. The SDK never holds a key.
            </li>
            <li>
              <code>publicUrl</code> is the origin agents call. Agent allow-lists are keyed by this
              origin plus the path, so set it when you run behind a proxy.
            </li>
          </ul>
        </Prose>
        <DocSubhead id="hono">Hono</DocSubhead>
        <Sample file="paid-route-hono.ts" name="server.ts" />
        <DocSubhead id="express">Express</DocSubhead>
        <Prose>
          <p>
            The same middleware works with a plain <code>http.createServer</code>. It only reads
            headers, so body parsers can come after it.
          </p>
        </Prose>
        <Sample file="paid-route-express.ts" name="server.ts" />
        <Prose>
          <p>Start the server with the demo recipient from the bootstrap.</p>
        </Prose>
        <Code code={runServer} language="Shell" />
      </DocSection>

      <DocSection id="the-402" title="What the 402 looks like">
        <Prose>
          <p>Call the paid route without paying.</p>
        </Prose>
        <Code code={curl} language="Shell" />
        <CapturedNote>
          The exchange below is a real 402 from the Express paywall. That capture server listened on
          port 3581.
        </CapturedNote>
        <Code code={http402Text()} language="HTTP" />
        <Prose>
          <p>
            <code>PAYMENT-REQUIRED</code> is base64 JSON. The body carries the same object, decoded.
          </p>
          <ul>
            <li>
              <code>amount</code> is in base units and <code>asset</code> is the mint.
            </li>
            <li>
              <code>extra.nonce</code> is fresh for every 402. It becomes the receipt address, so a
              payment can settle only once.
            </li>
            <li>
              <code>extra.expiresAt</code> is the last second an authorization for these terms is
              accepted.
            </li>
          </ul>
        </Prose>
        <JsonBlock value={http402.body} name="402 body" />
      </DocSection>

      <DocSection id="first-payment" title="Take a first payment">
        <Prose>
          <p>
            An agent pays the 402 by retrying with a signed authorization. The{" "}
            <Link href="/docs/agent-quickstart">agent quickstart</Link> sets that up. Here is what
            your server sees when it happens.
          </p>
          <ul>
            <li>
              The retry carries <code>PAYMENT-SIGNATURE</code>. The paywall checks the terms match
              the route, then asks the facilitator to verify and settle.
            </li>
            <li>
              Your handler runs only after the settlement confirmed. In Hono it reads{" "}
              <code>c.get(&quot;turnstilePayment&quot;)</code>. In Express it calls{" "}
              <code>getSettlement(req)</code>.
            </li>
            <li>
              The response carries <code>PAYMENT-RESPONSE</code> with the transaction and the
              receipt address.
            </li>
          </ul>
        </Prose>
        <CapturedNote>
          This paid request settled in transaction <code>{httpPaid.decodedHeader.transaction}</code>
          .
        </CapturedNote>
        <Code code={paidText()} language="HTTP" />
        <DocSubhead>PAYMENT-SIGNATURE, decoded</DocSubhead>
        <JsonBlock value={httpPaid.request.decodedHeader} name="PaymentPayload" />
        <DocSubhead>PAYMENT-RESPONSE, decoded</DocSubhead>
        <JsonBlock value={httpPaid.decodedHeader} name="SettlementResponse" />
      </DocSection>

      <DocSection id="receipt" title="Read the receipt">
        <Prose>
          <p>
            The settlement wrote a receipt account on chain. This is the same receipt read back with{" "}
            <code>fetchReceipt</code> from <code>@turnstile/shared/programs</code>.
          </p>
        </Prose>
        <JsonBlock value={receipt} name="Receipt" />
        <Prose>
          <p>Next steps.</p>
          <ul>
            <li>
              <Link href="/docs/reference#resource-sdk">Resource SDK reference</Link> lists every
              option and what each request gets.
            </li>
            <li>
              <Link href="/docs/concepts">Concepts</Link> explains the policy the chain checks.
            </li>
          </ul>
        </Prose>
      </DocSection>
    </article>
  );
}
