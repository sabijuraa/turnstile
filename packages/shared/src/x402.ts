import type { PaymentAuthorizationWire } from "./authorization.js";
import { base64Decode, base64Encode } from "./bytes.js";
import { SCHEME, X402_VERSION } from "./constants.js";

export interface PaymentRequirementsExtra {
  /** Hex encoded 32 byte resource id. */
  resourceId: string;
  /** Hex encoded 32 byte nonce issued for this request. */
  nonce: string;
  settlementProgram: string;
  agentWalletProgram: string;
  /** Base URL of the facilitator that will settle this payment. */
  facilitator: string;
  /** Unix seconds after which an authorization for these requirements is refused. */
  expiresAt: string;
  /** Human readable price, for display only. */
  displayAmount: string;
}

export interface PaymentRequirements {
  scheme: typeof SCHEME;
  /** CAIP-2 network id, for example `solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1`. */
  network: string;
  /** Base units as a decimal string. */
  amount: string;
  /** Mint address. */
  asset: string;
  /** Owner of the recipient token account. */
  payTo: string;
  maxTimeoutSeconds: number;
  resource: string;
  description: string;
  mimeType: string;
  extra: PaymentRequirementsExtra;
}

export interface PaymentRequired {
  x402Version: typeof X402_VERSION;
  error: string;
  resource: string;
  accepts: PaymentRequirements[];
}

export interface TurnstilePaymentPayloadBody {
  authorization: PaymentAuthorizationWire;
  /** Base58 Ed25519 signature by the session key. */
  signature: string;
}

export interface PaymentPayload {
  x402Version: typeof X402_VERSION;
  resource: string;
  accepted: PaymentRequirements;
  payload: TurnstilePaymentPayloadBody;
}

export interface SettlementResponse {
  success: boolean;
  /** Transaction signature, empty on failure. */
  transaction: string;
  network: string;
  /** Agent wallet address. */
  payer: string;
  /** Receipt account address, present on success. */
  receipt?: string;
  errorReason?: string;
  /** Plain sentence that explains the failure and what to do next. */
  errorMessage?: string;
  /** True when the receipt already existed and this response is a replay of the first settlement. */
  alreadySettled?: boolean;
}

export interface VerifyResponse {
  isValid: boolean;
  invalidReason?: string;
  invalidMessage?: string;
  payer?: string;
}

export interface SupportedKind {
  x402Version: typeof X402_VERSION;
  scheme: typeof SCHEME;
  network: string;
  extra: { settlementProgram: string; agentWalletProgram: string; asset: string };
}

export interface SupportedResponse {
  kinds: SupportedKind[];
}

export function encodeHeader(value: unknown): string {
  return base64Encode(JSON.stringify(value));
}

export function decodeHeader<T>(value: string): T {
  try {
    return JSON.parse(base64Decode(value)) as T;
  } catch {
    throw new Error("Header is not base64 encoded JSON");
  }
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Structural check of an untrusted payment payload. Returns a reason on failure. */
export function validatePaymentPayloadShape(value: unknown): string | null {
  if (!isObject(value)) return "Payment payload must be a JSON object.";
  if (value.x402Version !== X402_VERSION) return `x402Version must be ${X402_VERSION}.`;
  if (typeof value.resource !== "string") return "resource must be a string.";
  if (!isObject(value.accepted)) return "accepted must be the payment requirements object.";
  if (value.accepted.scheme !== SCHEME) return `scheme must be ${SCHEME}.`;
  if (!isObject(value.payload)) return "payload is missing.";
  if (typeof value.payload.signature !== "string") return "payload.signature must be base58.";
  if (!isObject(value.payload.authorization)) return "payload.authorization is missing.";
  return null;
}
