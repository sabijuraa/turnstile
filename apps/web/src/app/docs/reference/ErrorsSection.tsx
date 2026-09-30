import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DocSection, DocSubhead, FieldTable, Prose } from "../_components/Doc";

const facilitatorReasons: readonly { name: string; detail: string }[] = [
  {
    name: "invalid_payload",
    detail: "The payment payload is malformed. Build it again from the latest 402.",
  },
  {
    name: "unsupported_requirements",
    detail: "The requirements were not issued for this network, asset or programs.",
  },
  {
    name: "requirements_mismatch",
    detail: "The payment was signed for different terms than the server asked for.",
  },
  {
    name: "authorization_mismatch",
    detail: "The signed authorization does not match the requirements.",
  },
  {
    name: "authorization_expired",
    detail: "The authorization or its requirements expired. Request the resource again.",
  },
  {
    name: "invalid_signature",
    detail: "The session key signature does not cover this authorization.",
  },
  { name: "wallet_not_found", detail: "No agent wallet exists at that address on this network." },
  {
    name: "settlement_failed",
    detail: "The outcome is unknown. It is queued for replay and retrying is safe.",
  },
  {
    name: "settlement_simulation_failed",
    detail: "The program refused the payment for an unlisted reason.",
  },
];

const consoleErrors: readonly { name: string; type: string; detail: string }[] = [
  {
    name: "invalid_request, invalid_query, invalid_json, invalid_cursor, invalid_address, invalid_signature_encoding",
    type: "400",
    detail: "The message names the field and the fix.",
  },
  {
    name: "unauthenticated, session_expired, invalid_authorization, invalid_api_key, api_key_revoked",
    type: "401",
    detail: "Sign in again or send a valid key.",
  },
  {
    name: "unknown_challenge, challenge_used, challenge_expired, bad_signature",
    type: "401",
    detail: "Start sign-in again.",
  },
  {
    name: "api_key_not_allowed, origin_not_allowed, not_agent_owner",
    type: "403",
    detail: "The caller may not make this change.",
  },
  { name: "not_found, api_key_not_found", type: "404", detail: "Nothing at that path or id." },
  { name: "too_many_api_keys", type: "409", detail: "Revoke a key before creating another." },
  { name: "unsupported_media_type", type: "415", detail: "Send JSON bodies." },
  { name: "internal_error", type: "500", detail: "Retry. Share the request id if it persists." },
];

interface ProgramError {
  code: number;
  name: string;
  message: string;
  program: string;
}

/**
 * The program errors, read at build time from the IDLs that @turnstile/shared ships. They are
 * the same files PROGRAM_ERRORS in @turnstile/shared/programs is built from. That module is not
 * imported here because it pulls the Anchor client into the server bundle.
 */
function programErrors(): ProgramError[] {
  const local = join(process.cwd(), "../../packages/shared/idl");
  const dir = existsSync(local) ? local : join(process.cwd(), "packages/shared/idl");
  const out: ProgramError[] = [];
  for (const program of ["agent_wallet", "settlement"]) {
    const idl = JSON.parse(readFileSync(join(dir, `${program}.json`), "utf8")) as {
      errors?: { code: number; name: string; msg?: string }[];
    };
    if (!idl.errors?.length) throw new Error(`The ${program} IDL lists no errors. Run sync-idl.`);
    for (const e of idl.errors) {
      out.push({ code: e.code, name: e.name, message: e.msg ?? e.name, program });
    }
  }
  return out.sort((a, b) => a.code - b.code);
}

export function ErrorsSection() {
  const errors = programErrors();
  return (
    <DocSection id="errors" title="Errors">
      <Prose>
        <p>Three families of names, one per layer.</p>
        <ul>
          <li>
            Program errors come from the chain. The agent SDK and the facilitator keep their names.
          </li>
          <li>Facilitator reasons are snake case and describe checks made before the chain.</li>
          <li>Console API codes describe the console backend.</li>
        </ul>
      </Prose>

      <DocSubhead id="program-errors">Program errors</DocSubhead>
      <Prose>
        <p>
          agent_wallet uses codes from 6000 and settlement from 6100, so a code is unambiguous even
          when an agent_wallet error surfaces through the settle call. This table is read from the
          program IDLs in <code>@turnstile/shared</code> when the site is built, the same source as{" "}
          <code>PROGRAM_ERRORS</code>.
        </p>
      </Prose>
      <FieldTable
        caption="Program errors"
        nameLabel="Code and name"
        typeLabel="Program"
        rows={errors.map((e) => ({
          name: `${e.code} ${e.name}`,
          type: e.program,
          detail: e.message,
        }))}
      />

      <DocSubhead id="facilitator-reasons">Facilitator reasons</DocSubhead>
      <Prose>
        <p>
          Returned as <code>invalidReason</code> from verify, <code>errorReason</code> from settle
          and <code>reason</code> in a paywall 402. Policy refusals use the program error names
          above.
        </p>
      </Prose>
      <FieldTable caption="Facilitator reasons" nameLabel="Reason" rows={facilitatorReasons} />

      <DocSubhead id="console-errors">Console API codes</DocSubhead>
      <FieldTable
        caption="Console API error codes"
        nameLabel="Codes"
        typeLabel="Status"
        rows={consoleErrors}
      />
    </DocSection>
  );
}
