import { DocSection, DocSubhead, FieldTable, JsonBlock, Prose, Sample } from "../_components/Doc";
import httpRejected from "../_examples/http-rejected.json";

export function ResourceSdkSection() {
  return (
    <DocSection id="resource-sdk" title="Resource SDK">
      <Prose>
        <p>
          <code>@turnstile/sdk-resource</code> turns routes into paid routes. It never sees an agent
          key and never reads the request body.
        </p>
      </Prose>
      <FieldTable
        caption="Resource SDK exports"
        nameLabel="Export"
        typeLabel="Kind"
        rows={[
          {
            name: "honoPaywall(options | paywall)",
            type: "Hono middleware",
            detail: (
              <>
                Sets <code>turnstilePayment</code> on the context for paid routes.
              </>
            ),
          },
          {
            name: "expressPaywall(options | paywall)",
            type: "Node middleware",
            detail: (
              <>
                Works with Express and <code>node:http</code>. Sets{" "}
                <code>res.locals.turnstilePayment</code> on Express.
              </>
            ),
          },
          {
            name: "getSettlement(req)",
            type: "function",
            detail: "The settlement that paid for a Node request, or undefined.",
          },
          {
            name: "createPaywall(options)",
            type: "function",
            detail: "The framework free core. Its handle(request) never throws.",
          },
          {
            name: "resourceIdHex(resource)",
            type: "function",
            detail: "Hex resource id of a canonical resource, for building allow-lists.",
          },
          {
            name: "FacilitatorClient",
            type: "class",
            detail: "Typed client with supported, requirements, verify and settle.",
          },
          {
            name: "FacilitatorUnavailableError",
            type: "error",
            detail: "The facilitator could not be reached or answered badly. Nothing was decided.",
          },
        ]}
      />

      <DocSubhead id="paywall-options">PaywallOptions</DocSubhead>
      <FieldTable
        caption="PaywallOptions"
        nameLabel="Option"
        rows={[
          {
            name: "facilitatorUrl",
            type: "string",
            detail: "Base URL of the facilitator, for example http://127.0.0.1:4020.",
          },
          { name: "payTo", type: "string", detail: "Base58 owner of the recipient token account." },
          {
            name: "routes",
            type: "Record<string, PaywallRoute>",
            detail: (
              <>
                Paid routes keyed by <code>METHOD /path</code>. GET, POST, PUT, PATCH and DELETE.
              </>
            ),
          },
          {
            name: "publicUrl",
            type: "string?",
            detail:
              "External origin agents call. The canonical resource is this origin plus the request path.",
          },
          { name: "fetch", type: "typeof fetch?", detail: "Custom fetch for facilitator calls." },
          {
            name: "timeoutMs",
            type: "number?",
            detail: "Timeout for requirements and verify. Default 10000.",
          },
          {
            name: "settleTimeoutMs",
            type: "number?",
            detail: "Timeout for settle, which waits for confirmation. Default 60000.",
          },
        ]}
      />
      <FieldTable
        caption="PaywallRoute"
        nameLabel="Field"
        rows={[
          {
            name: "price",
            type: "string",
            detail: "Decimal in whole tokens, above zero, at most 6 decimal places.",
          },
          { name: "description", type: "string", detail: "Required. Shown in the requirements." },
          { name: "mimeType", type: "string?", detail: "Default application/json." },
          {
            name: "maxTimeoutSeconds",
            type: "number?",
            detail: "Seconds the client has to pay. The facilitator default is 60.",
          },
        ]}
      />

      <DocSubhead id="outcomes">Outcomes</DocSubhead>
      <Prose>
        <p>
          <code>paywall.handle(request)</code> resolves to one of four outcomes. The middlewares act
          on them for you.
        </p>
      </Prose>
      <FieldTable
        caption="PaywallOutcome kinds"
        nameLabel="kind"
        rows={[
          { name: "free", detail: "The route is not paid. Serve it." },
          {
            name: "payment-required",
            detail: (
              <>
                No <code>PAYMENT-SIGNATURE</code>. Return <code>outcome.response</code>, a 402.
              </>
            ),
          },
          {
            name: "rejected",
            detail: (
              <>
                Return <code>outcome.response</code>. A 402 with a reason and fresh requirements, or
                a 503 with <code>Retry-After: 2</code>.
              </>
            ),
          },
          {
            name: "paid",
            detail: (
              <>
                Serve it and set <code>PAYMENT-RESPONSE</code> to{" "}
                <code>outcome.paymentResponseHeader</code>. <code>outcome.settlement</code> holds
                the receipt.
              </>
            ),
          },
        ]}
      />
      <Sample file="paywall-core.ts" name="handler.ts" />

      <DocSubhead id="responses">What each request gets</DocSubhead>
      <FieldTable
        caption="Paywall responses"
        nameLabel="Situation"
        rows={[
          { name: "Route not listed", detail: "Passes through untouched." },
          {
            name: "No payment header",
            detail: "402 with PAYMENT-REQUIRED and the same JSON body.",
          },
          {
            name: "Header not base64 JSON",
            detail: (
              <>
                402 with <code>reason: &quot;invalid_payload&quot;</code> and fresh requirements.
              </>
            ),
          },
          {
            name: "Signed for other terms",
            detail: (
              <>
                402 with <code>reason: &quot;requirements_mismatch&quot;</code>. The facilitator is
                not called.
              </>
            ),
          },
          {
            name: "Facilitator refuses",
            detail: "402 with the facilitator reason, for example PerCallCapExceeded.",
          },
          {
            name: "Payment settles",
            detail: "The handler runs. The response has PAYMENT-RESPONSE.",
          },
          {
            name: "Same header again",
            detail: "Settle returns the first receipt with alreadySettled. No second debit.",
          },
          {
            name: "Outcome unknown",
            detail: "503 with Retry-After 2. Retrying the same header is safe.",
          },
          {
            name: "Facilitator down",
            detail: "503 payment_service_unavailable. The handler never runs.",
          },
        ]}
      />
      <Prose>
        <p>A refused payment, captured from the paywall.</p>
      </Prose>
      <JsonBlock value={httpRejected.body} name={`Response, HTTP/1.1 ${httpRejected.status}`} />
    </DocSection>
  );
}
