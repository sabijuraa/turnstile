import type { ByteField } from "./ByteMap";

/** The `Receipt` account, in the order the settlement program lays it out. */
export const receiptFields: readonly ByteField[] = [
  { name: "discriminator", bytes: 8, group: "domain" },
  { name: "agent_wallet", bytes: 32, group: "who" },
  { name: "owner", bytes: 32, group: "who" },
  { name: "session_key", bytes: 32, group: "who" },
  { name: "recipient", bytes: 32, group: "who" },
  { name: "recipient_token", bytes: 32, group: "who" },
  { name: "mint", bytes: 32, group: "what" },
  { name: "amount", bytes: 8, group: "what" },
  { name: "resource_id", bytes: 32, group: "what" },
  { name: "nonce", bytes: 32, group: "replay" },
  { name: "slot", bytes: 8, group: "when" },
  { name: "unix_timestamp", bytes: 8, group: "when" },
  { name: "fee_payer", bytes: 32, group: "who" },
  { name: "bump", bytes: 1, group: "domain" },
  { name: "expires_at", bytes: 8, group: "when" },
];

/** What the session key signs. `"TURNSTILE_PAYMENT_V1" || program id || borsh(authorization)`. */
export const messageFields: readonly ByteField[] = [
  { name: "TURNSTILE_PAYMENT_V1", bytes: 20, group: "domain" },
  { name: "settlement program id", bytes: 32, group: "domain" },
  { name: "agent_wallet", bytes: 32, group: "who" },
  { name: "session_key", bytes: 32, group: "who" },
  { name: "recipient", bytes: 32, group: "who" },
  { name: "mint", bytes: 32, group: "what" },
  { name: "amount", bytes: 8, group: "what" },
  { name: "resource_id", bytes: 32, group: "what" },
  { name: "nonce", bytes: 32, group: "replay" },
  { name: "expires_at", bytes: 8, group: "when" },
];
