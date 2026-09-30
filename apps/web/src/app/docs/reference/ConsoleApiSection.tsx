import { DocSection, DocSubhead, FieldTable, Prose } from "../_components/Doc";
import { ConsoleExchange, type ConsoleRecord } from "../_components/Exchange";
import consoleCapture from "../_examples/console.json";

const c = consoleCapture as unknown as Record<string, ConsoleRecord>;

function rec(name: string): ConsoleRecord {
  const found = c[name];
  if (!found) throw new Error(`console.json has no ${name} exchange. Run capture-console.ts.`);
  return found;
}

export function ConsoleApiSection() {
  return (
    <DocSection id="console-api" title="Console API">
      <Prose>
        <p>
          The backend behind the console, on port 4022 by default. It never holds an agent key or an
          owner key.
        </p>
        <ul>
          <li>
            A console session comes from signing a sign-in message with the owner wallet. It is an
            httpOnly <code>turnstile_session</code> cookie that lasts 12 hours.
          </li>
          <li>
            A console API key is sent as <code>Authorization: Bearer tsk_...</code>. Keys only read.
            Keys and session tokens are stored as SHA-256 hashes.
          </li>
          <li>
            Writes made with the cookie must come from the web origin, or they get{" "}
            <code>403 origin_not_allowed</code>.
          </li>
          <li>
            Every response carries <code>x-request-id</code>. Errors have the same{" "}
            <code>{"{ error: { code, message } }"}</code> shape as the facilitator.
          </li>
        </ul>
      </Prose>
      <FieldTable
        caption="Console API endpoints"
        nameLabel="Endpoint"
        typeLabel="Auth"
        rows={[
          {
            name: "POST /v1/auth/challenge",
            type: "none",
            detail: "The sign-in message for a wallet. Valid 5 minutes, usable once.",
          },
          {
            name: "POST /v1/auth/verify",
            type: "none",
            detail: "Checks the wallet signature and sets the session cookie.",
          },
          { name: "POST /v1/auth/signout", type: "none", detail: "Ends the session." },
          { name: "GET /v1/me", type: "session or key", detail: "The signed-in owner." },
          {
            name: "GET /v1/receipts",
            type: "session or key",
            detail:
              "Receipts, filtered by agent, resource, from, to and search, sorted, paged by cursor.",
          },
          {
            name: "GET /v1/receipts.csv",
            type: "session or key",
            detail: "Every matching receipt as a CSV statement.",
          },
          {
            name: "GET /v1/spend",
            type: "session or key",
            detail: "Spend over 24h, 7d or 30d in hourly or daily buckets.",
          },
          {
            name: "GET /v1/summary",
            type: "session or key",
            detail: "Totals, active agents, recent receipts and settlements waiting for replay.",
          },
          {
            name: "GET /v1/agents",
            type: "session or key",
            detail: "Every agent wallet of the owner, read from chain, with balances and spend.",
          },
          {
            name: "GET /v1/agents/:address",
            type: "session or key",
            detail: "One wallet with its session keys and allow-list.",
          },
          {
            name: "PUT /v1/agents/:address/label",
            type: "session",
            detail: "Names a wallet in the console.",
          },
          {
            name: "GET, POST /v1/api-keys",
            type: "session",
            detail: "Lists keys, or creates one. The full key is in the create response only.",
          },
          { name: "DELETE /v1/api-keys/:id", type: "session", detail: "Revokes a key." },
          {
            name: "POST /v1/tx/<action>",
            type: "session",
            detail: (
              <>
                Builds an unsigned owner transaction. Actions are <code>create-agent</code>,{" "}
                <code>deposit</code>, <code>withdraw</code>, <code>update-policy</code>,{" "}
                <code>add-session-key</code>, <code>revoke-session-key</code> and{" "}
                <code>close-wallet</code>.
              </>
            ),
          },
          {
            name: "POST /v1/tx/confirm",
            type: "session",
            detail: "Waits for a signature and names any program error.",
          },
        ]}
      />

      <DocSubhead id="console-signin">Sign in</DocSubhead>
      <Prose>
        <p>
          The browser asks the wallet to sign <code>message</code> as UTF-8 bytes and sends the 64
          byte signature in base58. The session token is shown as a placeholder.
        </p>
      </Prose>
      <ConsoleExchange record={rec("authChallenge")} />
      <ConsoleExchange record={rec("authVerify")} />
      <Prose>
        <p>The same challenge cannot be used twice.</p>
      </Prose>
      <ConsoleExchange record={rec("authReplay")} />

      <DocSubhead id="console-keys">API keys</DocSubhead>
      <Prose>
        <p>
          The key in this example was revoked at the end of the capture. An owner can hold 25 active
          keys.
        </p>
      </Prose>
      <ConsoleExchange record={rec("apiKeyCreate")} />
      <Prose>
        <p>A key on an endpoint that changes data is refused.</p>
      </Prose>
      <ConsoleExchange record={rec("apiKeyNotAllowed")} />
      <Prose>
        <p>A revoked key is refused everywhere.</p>
      </Prose>
      <ConsoleExchange record={rec("apiKeyRevoked")} />

      <DocSubhead id="console-receipts">Receipts</DocSubhead>
      <Prose>
        <p>
          Amounts are base units as strings with an exact <code>displayAmount</code>. Query
          parameters are <code>agent</code>, <code>resource</code>, <code>from</code>,{" "}
          <code>to</code>, <code>search</code>, <code>sort</code>, <code>limit</code> up to 200 and{" "}
          <code>cursor</code>.
        </p>
      </Prose>
      <ConsoleExchange record={rec("receipts")} />
      <ConsoleExchange record={rec("receiptsBadQuery")} />
      <ConsoleExchange record={rec("receiptsCsv")} />

      <DocSubhead id="console-spend">Spend</DocSubhead>
      <ConsoleExchange record={rec("spend")} />

      <DocSubhead id="console-agents">Agents</DocSubhead>
      <ConsoleExchange record={rec("agent")} />

      <DocSubhead id="console-tx">Owner transactions</DocSubhead>
      <Prose>
        <p>The backend builds, the owner wallet signs and sends, the backend confirms.</p>
        <ul>
          <li>
            Amounts and caps are decimal strings in whole tokens. Allow-list entries take a{" "}
            <code>resource</code> URL or hex id and a <code>recipient</code>.
          </li>
          <li>
            Each built transaction is base64 of an unsigned legacy transaction with the owner as fee
            payer.
          </li>
          <li>
            <code>/v1/tx/confirm</code> answers <code>confirmed</code>, <code>finalized</code>,{" "}
            <code>failed</code> with the program error, or <code>pending</code>.
          </li>
        </ul>
      </Prose>
      <ConsoleExchange record={rec("txUpdatePolicy")} />
      <ConsoleExchange record={rec("txConfirm")} />
    </DocSection>
  );
}
