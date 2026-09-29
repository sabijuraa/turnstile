import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import { AGENT_WALLET_PROGRAM_ID, SETTLEMENT_PROGRAM_ID } from "@turnstile/shared";
import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "../src/config.js";

const dir = mkdtempSync(join(tmpdir(), "facilitator-config-"));
const kp = Keypair.generate();
const keyFile = join(dir, "facilitator.json");
writeFileSync(keyFile, JSON.stringify(Array.from(kp.secretKey)));
const mint = Keypair.generate().publicKey.toBase58();

function deployment(overrides: Record<string, unknown> = {}): string {
  const file = join(dir, `deploy-${Math.random().toString(16).slice(2)}.json`);
  writeFileSync(
    file,
    JSON.stringify({
      network: "localnet",
      caip2: "solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z",
      programs: {
        agentWallet: AGENT_WALLET_PROGRAM_ID.toBase58(),
        settlement: SETTLEMENT_PROGRAM_ID.toBase58(),
      },
      mint,
      mintDecimals: 6,
      facilitator: kp.publicKey.toBase58(),
      ...overrides,
    }),
  );
  return file;
}

const env = (extra: Record<string, string | undefined> = {}) => ({
  DATABASE_URL: "postgres://u:p@127.0.0.1:5433/turnstile",
  DEPLOYMENT_FILE: deployment(),
  FACILITATOR_KEYPAIR: keyFile,
  ...extra,
});

describe("loadConfig", () => {
  it("reads the deployment and the fee payer", () => {
    const { config, feePayer } = loadConfig(env({ SOLANA_RPC_URL: "http://127.0.0.1:18899" }));
    expect(feePayer.publicKey.equals(kp.publicKey)).toBe(true);
    expect(config.port).toBe(4020);
    expect(config.caip2).toBe("solana:4uhcVJyU9pJkvQyS88uRDiswHXSCkY3z");
    expect(config.mint.toBase58()).toBe(mint);
    expect(config.rpcUrl).toBe("http://127.0.0.1:18899");
    expect(config.wsUrl).toBe("ws://127.0.0.1:18900");
    expect(config.publicUrl).toBe("http://127.0.0.1:4020");
  });

  it("names every missing variable", () => {
    expect(() => loadConfig({})).toThrowError(ConfigError);
    try {
      loadConfig({});
    } catch (err) {
      const msg = (err as Error).message;
      expect(msg).toContain("DATABASE_URL is not set");
      expect(msg).toContain("DEPLOYMENT_FILE is not set");
      expect(msg).toContain("FACILITATOR_KEYPAIR is not set");
    }
  });

  it("refuses a deployment with a bad mint or a network mismatch", () => {
    expect(() => loadConfig(env({ DEPLOYMENT_FILE: deployment({ mint: "nope" }) }))).toThrow(
      /mint must be a base58 Solana address/,
    );
    expect(() => loadConfig(env({ TURNSTILE_NETWORK: "devnet" }))).toThrow(
      /DEPLOYMENT_FILE is for localnet but TURNSTILE_NETWORK is devnet/,
    );
  });

  it("refuses a malformed keypair without echoing its contents", () => {
    const bad = join(dir, "bad.json");
    writeFileSync(bad, JSON.stringify([1, 2, 3, 99999]));
    try {
      loadConfig(env({ FACILITATOR_KEYPAIR: bad }));
      expect.unreachable();
    } catch (err) {
      expect((err as Error).message).toContain("is not a 64 byte Solana keypair file");
      expect((err as Error).message).not.toContain("99999");
    }
  });
});
