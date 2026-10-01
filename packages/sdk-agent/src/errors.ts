import type { PaymentAuthorization, PaymentPayload, PolicyViolation } from "@turnstile/shared";

/** Base class of every error the agent SDK throws on purpose. `code` is stable. */
export class TurnstileAgentError extends Error {
  override name = "TurnstileAgentError";
  constructor(
    readonly code: string,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
  }
}

/** Reasons the SDK refuses to sign. The policy names match the on-chain agent_wallet errors. */
export type RefusalReason =
  | PolicyViolation
  | "LocalCapExceeded"
  | "AuthorizationExpired"
  | "AuthorizationTtlTooLong"
  | "MintMismatch";

/**
 * The payment falls outside the policy. Nothing was signed and nothing was sent.
 * Thrown before the SDK touches the session key.
 */
export class PolicyRefusedError extends TurnstileAgentError {
  override name = "PolicyRefusedError";
  constructor(
    readonly reason: RefusalReason,
    message: string,
    readonly resource: string,
    readonly amount: bigint,
  ) {
    super("policy_refused", message);
  }
}

/**
 * The server or facilitator refused a signed payment. The authorization and its payload are
 * attached so the caller can inspect them. The chain may or may not have seen it.
 */
export class PaymentRejectedError extends TurnstileAgentError {
  override name = "PaymentRejectedError";
  constructor(
    readonly reason: string,
    message: string,
    readonly status: number,
    readonly authorization: PaymentAuthorization,
    readonly signature: Uint8Array,
    readonly paymentPayload: PaymentPayload,
  ) {
    super("payment_rejected", message);
  }
}

/** The 402 response could not be read, or it offered nothing this agent can pay with. */
export class PaymentRequirementsError extends TurnstileAgentError {
  override name = "PaymentRequirementsError";
  constructor(
    readonly reason:
      | "missing_requirements"
      | "malformed_requirements"
      | "no_matching_requirement"
      | "untrusted_program"
      | "resource_id_mismatch",
    message: string,
    options?: { cause?: unknown },
  ) {
    super(reason, message, options);
  }
}

/** The agent wallet could not be read from the chain. */
export class WalletStateError extends TurnstileAgentError {
  override name = "WalletStateError";
  constructor(message: string, options?: { cause?: unknown }) {
    super("wallet_state_unavailable", message, options);
  }
}
