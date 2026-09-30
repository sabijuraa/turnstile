import { Code, DocSection, DocSubhead, FieldTable, Prose } from "../_components/Doc";

const cli = `turnstile-agent keygen --out <file>   create a new session key file with mode 600
turnstile-agent address <file>        print the public key of a key file`;

export function AgentSdkSection() {
  return (
    <DocSection id="agent-sdk" title="Agent SDK">
      <Prose>
        <p>
          <code>@turnstile/sdk-agent</code> pays <code>turnstile-policy</code> 402s from an agent
          wallet. The session key never leaves the process.
        </p>
      </Prose>

      <DocSubhead id="agent-options">createAgent options</DocSubhead>
      <FieldTable
        caption="AgentOptions"
        nameLabel="Option"
        rows={[
          {
            name: "agentWallet",
            type: "string | PublicKey",
            detail: "Agent wallet address. Required.",
          },
          {
            name: "sessionKey",
            type: "Keypair | Uint8Array",
            detail: "The session keypair or its 64 byte secret. Required.",
          },
          {
            name: "rpcUrl",
            type: "string?",
            detail: "RPC endpoint used to read the wallet. Pass this or connection.",
          },
          { name: "connection", type: "Connection?", detail: "A web3.js connection to reuse." },
          {
            name: "maxPerCall",
            type: "string?",
            detail: "A local cap per call in whole tokens, tighter than the chain.",
          },
          {
            name: "localPolicyCheck",
            type: "boolean?",
            detail: "Check the on-chain policy before signing. Default true.",
          },
          {
            name: "policyTtlMs",
            type: "number?",
            detail: "How long a wallet read stays fresh. Default 15000.",
          },
          {
            name: "onPayment",
            type: "(event) => void",
            detail: "Called inline for every settled, refused or rejected payment.",
          },
          {
            name: "settlementProgram",
            type: "string | PublicKey?",
            detail: "Program the SDK signs for. Requirements naming another are refused.",
          },
          {
            name: "agentWalletProgram",
            type: "string | PublicKey?",
            detail: "Program that owns the wallet account.",
          },
          {
            name: "mintDecimals",
            type: "number?",
            detail: "Decimals used to parse maxPerCall. Default 6.",
          },
          {
            name: "fetch",
            type: "typeof fetch?",
            detail: "Custom fetch for the HTTP calls.",
          },
          {
            name: "stateSource",
            type: "WalletStateSource?",
            detail: "Replaces the chain reader, for tests or custom caching.",
          },
          {
            name: "now",
            type: "() => number?",
            detail: "Clock in milliseconds. Default Date.now.",
          },
        ]}
      />

      <DocSubhead id="agent-object">The agent</DocSubhead>
      <FieldTable
        caption="Agent members"
        nameLabel="Member"
        rows={[
          {
            name: "fetch(input, init?)",
            type: "Promise<PaidResponse>",
            detail: (
              <>
                Like fetch. Pays a 402 inside policy and retries once. <code>res.payment</code> is
                set when it paid.
              </>
            ),
          },
          {
            name: "wallet({ refresh? })",
            type: "Promise<WalletSnapshot>",
            detail: "The wallet, its policy and vault balance, read from chain when stale.",
          },
          { name: "agentWallet", type: "PublicKey", detail: "The wallet this agent pays from." },
          {
            name: "sessionPublicKey",
            type: "PublicKey",
            detail: "Public half of the session key.",
          },
        ]}
      />
      <Prose>
        <p>
          <code>onPayment</code> receives one of three events.
        </p>
        <ul>
          <li>
            <code>settled</code> with the <code>PaymentInfo</code> that also lands on{" "}
            <code>res.payment</code>.
          </li>
          <li>
            <code>refused</code> with the reason, before anything was signed.
          </li>
          <li>
            <code>rejected</code> with the reason and HTTP status, after the server or facilitator
            refused.
          </li>
        </ul>
      </Prose>

      <DocSubhead id="agent-errors">Errors</DocSubhead>
      <Prose>
        <p>
          Every error the SDK throws on purpose extends <code>TurnstileAgentError</code> and has a
          stable <code>code</code>.
        </p>
      </Prose>
      <FieldTable
        caption="Agent SDK errors"
        nameLabel="Class"
        typeLabel="code"
        rows={[
          {
            name: "PolicyRefusedError",
            type: "policy_refused",
            detail: (
              <>
                Outside the policy. Nothing signed or sent. Has <code>reason</code>,{" "}
                <code>resource</code> and <code>amount</code> as bigint.
              </>
            ),
          },
          {
            name: "PaymentRejectedError",
            type: "payment_rejected",
            detail: (
              <>
                Signed, then refused. Has <code>reason</code>, <code>status</code>,{" "}
                <code>authorization</code>, <code>signature</code> and <code>paymentPayload</code>.
              </>
            ),
          },
          {
            name: "PaymentRequirementsError",
            type: "its reason",
            detail: (
              <>
                The 402 was unreadable or offered nothing payable. Reasons are{" "}
                <code>missing_requirements</code>, <code>malformed_requirements</code>,{" "}
                <code>no_matching_requirement</code>, <code>untrusted_program</code> and{" "}
                <code>resource_id_mismatch</code>.
              </>
            ),
          },
          {
            name: "WalletStateError",
            type: "wallet_state_unavailable",
            detail: "The wallet or its vault could not be read from chain.",
          },
          {
            name: "TurnstileAgentError",
            type: "invalid_option, key_file_*",
            detail: (
              <>
                A bad option to <code>createAgent</code>, or a key file that is missing, invalid,
                already present or written with the wrong mode.
              </>
            ),
          },
        ]}
      />
      <Prose>
        <p>
          A <code>PolicyRefusedError</code> reason is one of these. The policy names match the
          on-chain errors.
        </p>
        <ul>
          <li>
            <code>SessionKeyNotFound</code>, <code>SessionKeyRevoked</code>,{" "}
            <code>SessionKeyExpired</code>
          </li>
          <li>
            <code>PerCallCapExceeded</code>, <code>DailyCapExceeded</code>,{" "}
            <code>ResourceNotAllowed</code>, <code>InsufficientFunds</code>, <code>ZeroAmount</code>
          </li>
          <li>
            <code>LocalCapExceeded</code> when the price is above <code>maxPerCall</code>
          </li>
          <li>
            <code>AuthorizationExpired</code> when the requirements expired before signing
          </li>
        </ul>
      </Prose>

      <DocSubhead id="agent-helpers">Other exports</DocSubhead>
      <FieldTable
        caption="Agent SDK helpers"
        nameLabel="Export"
        rows={[
          { name: "readKeypairFile(path)", detail: "Reads a Solana CLI keypair file." },
          {
            name: "writeNewKeypairFile(path)",
            detail: "Writes a new keypair with mode 600 and refuses to overwrite.",
          },
          {
            name: "readPaymentRequired(res)",
            detail: "Reads PaymentRequired from a 402, header first, body as fallback.",
          },
          {
            name: "readSettlementResponse(res)",
            detail: "Reads PAYMENT-RESPONSE, or null when absent.",
          },
          {
            name: "selectRequirement(required, mint, program)",
            detail: "Picks the requirement this wallet can pay and checks its resource id.",
          },
          {
            name: "chainWalletStateSource(connection, wallet, program)",
            detail: "The default chain reader, one RPC round trip per refresh.",
          },
        ]}
      />

      <DocSubhead id="cli">turnstile-agent CLI</DocSubhead>
      <Code code={cli} language="Shell" />
    </DocSection>
  );
}
