/**
 * Reasons a payment is refused. Program errors keep their on-chain names so a caller can
 * match them against the agent_wallet and settlement error enums. Facilitator reasons are
 * snake case.
 */
export const FACILITATOR_REASONS = [
  "invalid_payload",
  "unsupported_requirements",
  "requirements_mismatch",
  "authorization_mismatch",
  "authorization_expired",
  "invalid_signature",
  "wallet_not_found",
  "settlement_failed",
] as const;

export type FacilitatorReason = (typeof FACILITATOR_REASONS)[number];

const MESSAGES: Record<string, string> = {
  invalid_payload:
    "The payment payload is malformed. Build it again with the agent SDK from the latest 402 response.",
  unsupported_requirements:
    "These payment requirements were not issued for this facilitator's network, asset or programs. Request the resource again to get fresh requirements.",
  requirements_mismatch:
    "The payment was signed for different terms than the server asked for. Request the resource again and sign the new requirements.",
  authorization_mismatch:
    "The signed authorization does not match the payment requirements. Sign an authorization for the exact amount, asset, recipient, resource and nonce in the requirements.",
  authorization_expired:
    "The payment authorization or its requirements have expired. Request the resource again and sign the fresh requirements.",
  invalid_signature:
    "The session key signature does not cover this authorization. Sign the exact authorization message with the session key named in it.",
  wallet_not_found:
    "No agent wallet exists at the address in the authorization. Check the agent wallet address and the network.",
  settlement_failed:
    "The settlement could not be confirmed on chain. It is queued for replay. Retry the same payment later, it will not be charged twice.",
  settlement_simulation_failed:
    "The settlement program refused this payment for an unlisted reason. Check the agent wallet and try a fresh payment.",
  // agent_wallet program errors
  SessionKeyNotFound:
    "The session key is not registered on this agent wallet. Ask the owner to add it, or sign with a registered key.",
  SessionKeyRevoked: "The session key was revoked by the owner. Sign with an active session key.",
  SessionKeyExpired: "The session key has expired. Ask the owner to add a new session key.",
  PerCallCapExceeded:
    "The price is above the agent wallet's per-call cap. Ask the owner to raise the cap, or use a cheaper resource.",
  DailyCapExceeded:
    "This payment would take the agent wallet above its daily cap. Wait for older spend to age out of the 24 hour window, or ask the owner to raise the cap.",
  ResourceNotAllowed:
    "This resource and recipient pair is not on the agent wallet's allow-list. Ask the owner to add it.",
  InsufficientFunds:
    "The agent wallet vault does not hold enough to pay. Ask the owner to deposit more.",
  ZeroAmount: "The payment amount must be above zero. Request the resource again.",
  MintMismatch:
    "The agent wallet holds a different token than the one requested. Pay with a wallet for this asset.",
  RecipientMismatch:
    "The recipient token account belongs to someone else. The resource server must use its own payTo address.",
  AccountMismatch:
    "An account does not match the authorization, for example the wallet holds a different token. Check the agent wallet and the asset.",
  UnauthorizedCaller:
    "The settlement was not authorized by the settlement program. Check the deployed program ids.",
  ArithmeticOverflow:
    "The agent wallet cannot record this payment because a counter would overflow. Ask the owner to use a new wallet.",
  // settlement program errors
  AuthorizationExpired:
    "The payment authorization has expired on chain. Request the resource again and sign the fresh requirements.",
  MissingSignatureVerification:
    "The settle transaction lacks the Ed25519 check. This is a facilitator bug, report it to the operator.",
  SignatureMismatch:
    "The session key signature does not cover this authorization. Sign the exact authorization message with the session key named in it.",
  NonceAlreadyUsed:
    "This payment has already settled. Call settle with the same payload to get the original receipt, or sign a new payment.",
};

export function reasonMessage(reason: string): string {
  return (
    MESSAGES[reason] ??
    `The payment was refused with ${reason}. Check the agent wallet and policy, then try a fresh payment.`
  );
}
