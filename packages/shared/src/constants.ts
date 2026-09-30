import { PublicKey } from "@solana/web3.js";

export const AGENT_WALLET_PROGRAM_ID = new PublicKey("7onzUVc1HGc9oBDUspBdP8dz1QW6uXrSdBn4NH6aiLb");
export const SETTLEMENT_PROGRAM_ID = new PublicKey("6FrY43zorjSv8wCuarPL3z8ZnyBTyyC86xRjBqgu1K9z");

export const SEED_AGENT_WALLET = "agent_wallet";
export const SEED_VAULT = "vault";
export const SEED_RECEIPT = "receipt";
export const SEED_SETTLEMENT_AUTHORITY = "settlement_authority";

/** Domain prefix of every signed payment authorization. Exactly 20 ASCII bytes. */
export const AUTHORIZATION_DOMAIN = "TURNSTILE_PAYMENT_V1";
export const AUTHORIZATION_BODY_LEN = 208;
export const AUTHORIZATION_MESSAGE_LEN = 20 + 32 + AUTHORIZATION_BODY_LEN;

export const MAX_SESSION_KEYS = 4;
export const MAX_ALLOW_LIST = 16;

/** Rolling daily cap is tracked in 15 minute buckets. */
export const SPEND_BUCKET_SECONDS = 900;
export const SPEND_BUCKET_COUNT = 97;
/** Buckets with index >= now_index - SPEND_WINDOW_LOOKBACK count toward the daily cap. */
export const SPEND_WINDOW_LOOKBACK = 96;

export const X402_VERSION = 2;
export const SCHEME = "turnstile-policy";

export const HEADER_PAYMENT_REQUIRED = "PAYMENT-REQUIRED";
export const HEADER_PAYMENT_SIGNATURE = "PAYMENT-SIGNATURE";
export const HEADER_PAYMENT_RESPONSE = "PAYMENT-RESPONSE";

export const RESOURCE_ID_PREFIX = "turnstile:resource:";

export { STABLECOIN_DECIMALS } from "./units.js";
