import type { PublicKey } from "@solana/web3.js";
import {
  bytesToHex,
  decodeHeader,
  HEADER_PAYMENT_REQUIRED,
  HEADER_PAYMENT_RESPONSE,
  type PaymentRequired,
  type PaymentRequirements,
  resourceId,
  SCHEME,
  type SettlementResponse,
  X402_VERSION,
} from "@turnstile/shared";
import { PaymentRequirementsError } from "./errors.js";

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

const HEX32 = /^[0-9a-f]{64}$/;
const UINT = /^\d+$/;

/** Returns a reason when a requirement is not a usable turnstile-policy requirement. */
function requirementProblem(r: unknown): string | null {
  if (!isObject(r)) return "a requirement is not an object";
  if (r.scheme !== SCHEME) return null;
  for (const field of ["network", "amount", "asset", "payTo", "resource"] as const) {
    if (typeof r[field] !== "string") return `${field} must be a string`;
  }
  if (!UINT.test(r.amount as string)) return "amount must be base units as a decimal string";
  if (typeof r.maxTimeoutSeconds !== "number") return "maxTimeoutSeconds must be a number";
  const extra = r.extra;
  if (!isObject(extra)) return "extra is missing";
  if (typeof extra.resourceId !== "string" || !HEX32.test(extra.resourceId)) {
    return "extra.resourceId must be 64 lowercase hex characters";
  }
  if (typeof extra.nonce !== "string" || !HEX32.test(extra.nonce)) {
    return "extra.nonce must be 64 lowercase hex characters";
  }
  if (typeof extra.expiresAt !== "string" || !UINT.test(extra.expiresAt)) {
    return "extra.expiresAt must be unix seconds as a decimal string";
  }
  if (typeof extra.settlementProgram !== "string") return "extra.settlementProgram is missing";
  return null;
}

function checkPaymentRequired(value: unknown, source: string): PaymentRequired {
  if (!isObject(value) || !Array.isArray(value.accepts)) {
    throw new PaymentRequirementsError(
      "malformed_requirements",
      `The ${source} of the 402 is not an x402 PaymentRequired object with an accepts list.`,
    );
  }
  if (value.x402Version !== X402_VERSION) {
    throw new PaymentRequirementsError(
      "malformed_requirements",
      `The 402 uses x402 version ${String(value.x402Version)}. This SDK speaks version ${X402_VERSION}.`,
    );
  }
  for (const r of value.accepts) {
    const problem = requirementProblem(r);
    if (problem) {
      throw new PaymentRequirementsError(
        "malformed_requirements",
        `The 402 offers a ${SCHEME} requirement that cannot be used because ${problem}.`,
      );
    }
  }
  return value as unknown as PaymentRequired;
}

/**
 * Reads PaymentRequired from a 402. The PAYMENT-REQUIRED header wins. The JSON body is the
 * fallback. Reads the body from a clone so the caller can still consume the response.
 */
export async function readPaymentRequired(res: Response): Promise<PaymentRequired> {
  const header = res.headers.get(HEADER_PAYMENT_REQUIRED);
  if (header) {
    let decoded: unknown;
    try {
      decoded = decodeHeader<unknown>(header);
    } catch (err) {
      throw new PaymentRequirementsError(
        "malformed_requirements",
        `The ${HEADER_PAYMENT_REQUIRED} header is not base64 encoded JSON.`,
        { cause: err },
      );
    }
    return checkPaymentRequired(decoded, `${HEADER_PAYMENT_REQUIRED} header`);
  }
  let body: unknown;
  try {
    body = await res.clone().json();
  } catch (err) {
    throw new PaymentRequirementsError(
      "missing_requirements",
      `The server answered 402 without a ${HEADER_PAYMENT_REQUIRED} header or a JSON body, so there is nothing to pay.`,
      { cause: err },
    );
  }
  return checkPaymentRequired(body, "body");
}

/** Reads PAYMENT-RESPONSE when present. Returns null when the header is absent. */
export function readSettlementResponse(res: Response): SettlementResponse | null {
  const header = res.headers.get(HEADER_PAYMENT_RESPONSE);
  if (!header) return null;
  let decoded: unknown;
  try {
    decoded = decodeHeader<unknown>(header);
  } catch (err) {
    throw new PaymentRequirementsError(
      "malformed_requirements",
      `The ${HEADER_PAYMENT_RESPONSE} header is not base64 encoded JSON.`,
      { cause: err },
    );
  }
  if (!isObject(decoded) || typeof decoded.success !== "boolean") {
    throw new PaymentRequirementsError(
      "malformed_requirements",
      `The ${HEADER_PAYMENT_RESPONSE} header is not a settlement response.`,
    );
  }
  return decoded as unknown as SettlementResponse;
}

/**
 * Picks the turnstile-policy requirement this wallet can pay: same mint, and signed for the
 * settlement program this agent trusts. The resource id must be the hash of the resource.
 */
export function selectRequirement(
  required: PaymentRequired,
  mint: PublicKey,
  settlementProgram: PublicKey,
): PaymentRequirements {
  const ours = required.accepts.filter((r) => r.scheme === SCHEME);
  if (ours.length === 0) {
    throw new PaymentRequirementsError(
      "no_matching_requirement",
      `The 402 for ${required.resource} offers no ${SCHEME} payment option.`,
    );
  }
  const sameMint = ours.filter((r) => r.asset === mint.toBase58());
  if (sameMint.length === 0) {
    throw new PaymentRequirementsError(
      "no_matching_requirement",
      `The 402 for ${required.resource} asks for ${ours.map((r) => r.asset).join(", ")}, but this agent wallet holds ${mint.toBase58()}.`,
    );
  }
  const trusted = sameMint.filter(
    (r) => r.extra.settlementProgram === settlementProgram.toBase58(),
  );
  const chosen = trusted[0];
  if (!chosen) {
    throw new PaymentRequirementsError(
      "untrusted_program",
      `The 402 for ${required.resource} names settlement program ${sameMint[0]?.extra.settlementProgram}, but this agent only signs for ${settlementProgram.toBase58()}.`,
    );
  }
  const expected = bytesToHex(resourceId(chosen.resource));
  if (chosen.extra.resourceId !== expected) {
    throw new PaymentRequirementsError(
      "resource_id_mismatch",
      `The resource id in the 402 does not match ${chosen.resource}. Refusing to sign for a different resource.`,
    );
  }
  return chosen;
}
