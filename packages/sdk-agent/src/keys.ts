import { chmodSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { Keypair } from "@solana/web3.js";
import { TurnstileAgentError } from "./errors.js";

/** Reads a Solana CLI keypair file, a JSON array of 64 byte values. */
export function readKeypairFile(path: string): Keypair {
  if (!existsSync(path)) {
    throw new TurnstileAgentError(
      "key_file_missing",
      `${path} does not exist. Create one with turnstile-agent keygen --out ${path}.`,
    );
  }
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (err) {
    throw new TurnstileAgentError(
      "key_file_invalid",
      `${path} is not JSON. A key file is a JSON array of 64 numbers.`,
      { cause: err },
    );
  }
  if (
    !Array.isArray(raw) ||
    raw.length !== 64 ||
    !raw.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)
  ) {
    throw new TurnstileAgentError(
      "key_file_invalid",
      `${path} is not a 64 byte Solana keypair file.`,
    );
  }
  try {
    return Keypair.fromSecretKey(Uint8Array.from(raw as number[]));
  } catch (err) {
    throw new TurnstileAgentError(
      "key_file_invalid",
      `${path} holds 64 bytes that are not a valid Solana keypair.`,
      { cause: err },
    );
  }
}

/**
 * Writes a new keypair to `path` with mode 0600, readable by the current user only.
 * Refuses to replace an existing file so a live session key is never lost by accident.
 */
export function writeNewKeypairFile(path: string, keypair: Keypair = Keypair.generate()): Keypair {
  if (existsSync(path)) {
    throw new TurnstileAgentError(
      "key_file_exists",
      `${path} already exists. Pick another path or move the old key away first.`,
    );
  }
  mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
  writeFileSync(path, JSON.stringify(Array.from(keypair.secretKey)), { mode: 0o600, flag: "wx" });
  // The umask can widen the mode given to writeFileSync on some systems. Set it again.
  chmodSync(path, 0o600);
  const mode = statSync(path).mode & 0o777;
  if (mode !== 0o600) {
    throw new TurnstileAgentError(
      "key_file_mode",
      `${path} was written with mode ${mode.toString(8)} instead of 600. Fix it with chmod 600 ${path}.`,
    );
  }
  return keypair;
}
