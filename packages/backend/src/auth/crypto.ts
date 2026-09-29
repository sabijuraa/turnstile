import { randomBytes } from "node:crypto";
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex } from "@turnstile/shared";
import bs58 from "bs58";

export function sha256Hex(value: string): string {
  return bytesToHex(sha256(new TextEncoder().encode(value)));
}

export function randomBase58(bytes: number): string {
  return bs58.encode(randomBytes(bytes));
}

export function randomToken(): string {
  return randomBytes(32).toString("base64url");
}

export const API_KEY_PREFIX = "tsk_";

/** A new console API key, `tsk_` plus base58 of 32 random bytes. */
export function newApiKey(): string {
  return `${API_KEY_PREFIX}${randomBase58(32)}`;
}

/** The part of a key that is safe to show after creation. */
export function apiKeyDisplayPrefix(key: string): string {
  return key.slice(0, API_KEY_PREFIX.length + 6);
}
