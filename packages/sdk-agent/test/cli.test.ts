import { mkdtempSync, readFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Keypair } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import { runCli } from "../src/cli.js";

function capture() {
  const out: string[] = [];
  const err: string[] = [];
  return { io: { out: (l: string) => out.push(l), err: (l: string) => err.push(l) }, out, err };
}

describe("turnstile-agent", () => {
  const dir = mkdtempSync(join(tmpdir(), "turnstile-agent-"));

  it("keygen writes a 0600 Solana key file and prints only the public key", () => {
    const path = join(dir, "nested", "session.json");
    const c = capture();
    expect(runCli(["keygen", "--out", path], c.io)).toBe(0);
    expect(c.out).toHaveLength(1);
    const raw = JSON.parse(readFileSync(path, "utf8")) as number[];
    expect(raw).toHaveLength(64);
    const kp = Keypair.fromSecretKey(Uint8Array.from(raw));
    expect(c.out[0]).toBe(kp.publicKey.toBase58());
    // Nothing printed contains any part of the secret.
    expect(c.out.join("\n")).not.toContain(raw.slice(0, 8).join(","));
    expect(statSync(path).mode & 0o777).toBe(0o600);
  });

  it("keygen refuses to overwrite an existing key", () => {
    const path = join(dir, "twice.json");
    expect(runCli(["keygen", "--out", path], capture().io)).toBe(0);
    const before = readFileSync(path, "utf8");
    const c = capture();
    expect(runCli(["keygen", "--out", path], c.io)).toBe(1);
    expect(c.err[0]).toContain("already exists");
    expect(readFileSync(path, "utf8")).toBe(before);
  });

  it("address prints the public key of a key file", () => {
    const path = join(dir, "addr.json");
    const gen = capture();
    runCli(["keygen", "--out", path], gen.io);
    const c = capture();
    expect(runCli(["address", path], c.io)).toBe(0);
    expect(c.out).toEqual(gen.out);
  });

  it("explains a missing argument or a bad file", () => {
    const a = capture();
    expect(runCli(["keygen"], a.io)).toBe(2);
    expect(a.err[0]).toContain("--out");
    const b = capture();
    expect(runCli(["address", join(dir, "missing.json")], b.io)).toBe(1);
    expect(b.err[0]).toContain("does not exist");
    const c = capture();
    expect(runCli(["launch"], c.io)).toBe(2);
    expect(c.err[0]).toContain('Unknown command "launch"');
  });
});
