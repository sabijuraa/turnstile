import Link from "next/link";
import { Code, DocSection, DocSubhead, FieldTable, Prose } from "../_components/Doc";
import { FacilitatorExchange } from "../_components/Exchange";
import requirements from "../_examples/facilitator-requirements.json";
import requirementsInvalid from "../_examples/facilitator-requirements-invalid.json";
import settle from "../_examples/facilitator-settle.json";
import settleReplay from "../_examples/facilitator-settle-replay.json";
import supported from "../_examples/facilitator-supported.json";
import verify from "../_examples/facilitator-verify.json";
import verifyRejected from "../_examples/facilitator-verify-rejected.json";
import verifyUsedNonce from "../_examples/facilitator-verify-used-nonce.json";
import reclaim from "../_examples/reclaim-dry-run.json";

export function FacilitatorSection() {
  return (
    <DocSection id="facilitator" title="Facilitator">
      <Prose>
        <p>An HTTP service on port 4020 by default. The resource SDK is its usual caller.</p>
        <ul>
          <li>
            Bodies are JSON with <code>Content-Type: application/json</code>, up to 64 KB.
          </li>
          <li>
            Errors are <code>{"{ error: { code, message } }"}</code> with a message that says what
            to do next.
          </li>
          <li>
            <code>GET /healthz</code>, <code>GET /readyz</code> and <code>GET /metrics</code> cover
            health, readiness of Postgres and RPC, and Prometheus metrics.
          </li>
        </ul>
      </Prose>

      <DocSubhead id="supported">GET /supported</DocSubhead>
      <Prose>
        <p>The scheme, network, programs and asset this facilitator settles.</p>
      </Prose>
      <FacilitatorExchange record={supported} />

      <DocSubhead id="requirements">POST /requirements</DocSubhead>
      <Prose>
        <p>
          Issues payment requirements for one request. The resource is canonicalized, a fresh 32
          byte nonce is drawn and the resource name is stored so receipts can show it.
        </p>
      </Prose>
      <FieldTable
        caption="POST /requirements body"
        rows={[
          { name: "resource", type: "string", detail: "Absolute http or https URL of the route." },
          {
            name: "price",
            type: "string",
            detail: "Decimal in whole tokens such as 0.005. Send price or amount, never both.",
          },
          { name: "amount", type: "string", detail: "Base units as a decimal integer string." },
          { name: "payTo", type: "string", detail: "Owner of the recipient token account." },
          { name: "description", type: "string", detail: "What the payment is for." },
          { name: "mimeType", type: "string?", detail: "Default application/json." },
          {
            name: "maxTimeoutSeconds",
            type: "number?",
            detail: "Seconds the client has to pay. Default 60, at most 3600.",
          },
          { name: "asset", type: "string?", detail: "Mint. Must be the deployment mint." },
        ]}
      />
      <FacilitatorExchange record={requirements} />
      <Prose>
        <p>A bad field is refused with a 400 that names it.</p>
      </Prose>
      <FacilitatorExchange record={requirementsInvalid} />

      <DocSubhead id="verify">POST /verify</DocSubhead>
      <Prose>
        <p>
          Takes <code>{"{ paymentPayload, paymentRequirements }"}</code> and returns{" "}
          <code>{"{ isValid, invalidReason?, invalidMessage?, payer? }"}</code>. Checks run in this
          order and stop at the first failure.
        </p>
        <ol>
          <li>
            Payload shape. <code>invalid_payload</code>
          </li>
          <li>
            The requirements were issued for this network, mint and programs.{" "}
            <code>unsupported_requirements</code>
          </li>
          <li>
            The accepted terms equal the requirements. <code>requirements_mismatch</code>
          </li>
          <li>
            The signed authorization matches those terms. <code>authorization_mismatch</code>
          </li>
          <li>
            The Ed25519 signature, offline. <code>invalid_signature</code>
          </li>
          <li>
            Expiry of the authorization and the requirements. <code>authorization_expired</code>
          </li>
          <li>
            The nonce has no receipt yet. <code>NonceAlreadyUsed</code>
          </li>
          <li>
            The agent wallet exists and holds this mint. <code>wallet_not_found</code>,{" "}
            <code>AccountMismatch</code>
          </li>
          <li>
            The policy read from chain with the vault balance. <code>SessionKeyNotFound</code>,{" "}
            <code>SessionKeyRevoked</code>, <code>SessionKeyExpired</code>,{" "}
            <code>PerCallCapExceeded</code>, <code>ResourceNotAllowed</code>,{" "}
            <code>DailyCapExceeded</code>, <code>InsufficientFunds</code>
          </li>
          <li>A simulation of the exact settle transaction. Any program error name.</li>
        </ol>
        <p>
          When the RPC node cannot be reached the answer is a 503 <code>chain_unavailable</code>,
          not a verdict.
        </p>
      </Prose>
      <FacilitatorExchange record={verify} />
      <Prose>
        <p>A payment above the per-call cap.</p>
      </Prose>
      <FacilitatorExchange record={verifyRejected} showRequest={false} />
      <Prose>
        <p>The first payment again, after it settled.</p>
      </Prose>
      <FacilitatorExchange record={verifyUsedNonce} showRequest={false} />

      <DocSubhead id="settle">POST /settle</DocSubhead>
      <Prose>
        <p>
          Takes the same body as verify and returns{" "}
          <code>
            {
              "{ success, transaction, network, payer, receipt?, errorReason?, errorMessage?, alreadySettled? }"
            }
          </code>
          .
        </p>
        <ul>
          <li>
            It derives the receipt address first. If the receipt exists and matches, it returns the
            original transaction with <code>alreadySettled: true</code>.
          </li>
          <li>
            Otherwise it verifies, sends the Ed25519 check and the settle instruction in one
            transaction, and waits for <code>confirmed</code>.
          </li>
          <li>Concurrent settles of one nonce end with one debit.</li>
          <li>Policy and program refusals are final and come back by name.</li>
          <li>
            A send whose outcome is unknown goes to the dead letter table and answers{" "}
            <code>errorReason: &quot;settlement_failed&quot;</code>. Retrying the same payment is
            safe.
          </li>
        </ul>
      </Prose>
      <FacilitatorExchange record={settle} showRequest={false} />
      <Prose>
        <p>The same payment settled a second time. Same transaction, no second debit.</p>
      </Prose>
      <FacilitatorExchange record={settleReplay} showRequest={false} />

      <DocSubhead id="reclaim">Reclaiming receipt rent</DocSubhead>
      <Prose>
        <p>
          The facilitator pays the rent of every receipt it creates. The reclaim job takes it back
          once a receipt is past retention.
        </p>
        <ul>
          <li>
            It finds the receipts this fee payer paid for and closes those whose authorization
            expired more than 7 days ago, in batches of 10 by default and at most 20.
          </li>
          <li>
            <code>--dry-run</code> reports without sending. <code>--limit=N</code> caps one run and{" "}
            <code>--batch=N</code> sets the batch size.
          </li>
          <li>The exit code is 1 when any close failed. Indexed receipts in Postgres are kept.</li>
        </ul>
      </Prose>
      <Code
        code={
          "pnpm --filter @turnstile/facilitator reclaim\npnpm --filter @turnstile/facilitator reclaim -- --dry-run"
        }
        language="Shell"
      />
      <Prose>
        <p>
          A dry run right after the capture. The one receipt is still inside its retention period.
        </p>
      </Prose>
      <Code code={`$ ${reclaim.command}\n${reclaim.output}`} language="Shell" name="Output" />

      <DocSubhead id="headers">x402 headers</DocSubhead>
      <Prose>
        <p>
          Turnstile uses x402 version 2 with the <code>turnstile-policy</code> scheme on network{" "}
          <code>solana:&lt;id&gt;</code>. Every header value is base64 encoded JSON.
        </p>
      </Prose>
      <FieldTable
        caption="x402 headers"
        nameLabel="Header"
        typeLabel="Sent by"
        rows={[
          {
            name: "PAYMENT-REQUIRED",
            type: "server, on 402",
            detail: (
              <>
                <code>{"{ x402Version: 2, error, resource, accepts: [PaymentRequirements] }"}</code>
                . The body holds the same JSON. A refusal adds <code>reason</code> and{" "}
                <code>message</code>.
              </>
            ),
          },
          {
            name: "PAYMENT-SIGNATURE",
            type: "client, on retry",
            detail: (
              <>
                <code>
                  {"{ x402Version: 2, resource, accepted, payload: { authorization, signature } }"}
                </code>
                . Authorization fields are base58 or hex strings. The signature is base58.
              </>
            ),
          },
          {
            name: "PAYMENT-RESPONSE",
            type: "server, on success",
            detail: (
              <>
                <code>{"{ success, transaction, network, payer, receipt }"}</code>.
              </>
            ),
          },
        ]}
      />
      <Prose>
        <p>
          The quickstart shows each one captured and decoded, in{" "}
          <Link href="/docs/quickstart#the-402">the 402</Link> and{" "}
          <Link href="/docs/quickstart#first-payment">the paid request</Link>.
        </p>
      </Prose>

      <DocSubhead id="latency">Measured latency</DocSubhead>
      <Prose>
        <p>
          From the resource SDK integration test. 25 sequential paid requests on one machine with a
          local solana-test-validator from Agave 4.0.2 at default slot timing. A paid request runs
          from sending <code>PAYMENT-SIGNATURE</code> to reading the body, and covers verify, settle
          at <code>confirmed</code> and the handler.
        </p>
      </Prose>
      <FieldTable
        caption="Measured latency on a local validator"
        nameLabel="Run"
        typeLabel="Paid median"
        rows={[
          {
            name: "1",
            type: "455 ms",
            detail: "p90 611 ms. Full loop median, 402 then paid, 475 ms.",
          },
          {
            name: "2",
            type: "427 ms",
            detail: "p90 579 ms. Full loop median, 402 then paid, 446 ms.",
          },
        ]}
      />
    </DocSection>
  );
}
