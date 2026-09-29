import { Keypair, PublicKey } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  AUTHORIZATION_MESSAGE_LEN,
  authorizationFromWire,
  authorizationMessage,
  authorizationToWire,
  canonicalResource,
  evaluatePayment,
  formatUnits,
  type PaymentAuthorization,
  type PolicyState,
  parseUnits,
  randomNonce,
  receiptAddress,
  resourceId,
  rollingSpend,
  SETTLEMENT_PROGRAM_ID,
  signAuthorization,
  verifyAuthorizationSignature,
} from "../src/index.js";

function sampleAuth(session: Keypair): PaymentAuthorization {
  return {
    agentWallet: Keypair.generate().publicKey,
    sessionKey: session.publicKey,
    recipient: Keypair.generate().publicKey,
    mint: Keypair.generate().publicKey,
    amount: 5000n,
    resourceId: resourceId("https://api.example.com/v1/summarize"),
    nonce: randomNonce(),
    expiresAt: 1_900_000_000n,
  };
}

describe("authorization encoding", () => {
  it("produces a 260 byte message with the domain and program id up front", () => {
    const auth = sampleAuth(Keypair.generate());
    const msg = authorizationMessage(auth);
    expect(msg.length).toBe(AUTHORIZATION_MESSAGE_LEN);
    expect(new TextDecoder().decode(msg.slice(0, 20))).toBe("TURNSTILE_PAYMENT_V1");
    expect(new PublicKey(msg.slice(20, 52)).equals(SETTLEMENT_PROGRAM_ID)).toBe(true);
    expect(new PublicKey(msg.slice(52, 84)).equals(auth.agentWallet)).toBe(true);
    expect(Buffer.from(msg.slice(180, 188)).readBigUInt64LE()).toBe(5000n);
  });

  it("verifies a signature by the session key and rejects any tampering", () => {
    const session = Keypair.generate();
    const auth = sampleAuth(session);
    const sig = signAuthorization(auth, session.secretKey);
    expect(verifyAuthorizationSignature(auth, sig)).toBe(true);
    expect(verifyAuthorizationSignature({ ...auth, amount: 5001n }, sig)).toBe(false);
    const other = Keypair.generate();
    expect(verifyAuthorizationSignature({ ...auth, sessionKey: other.publicKey }, sig)).toBe(false);
  });

  it("round trips through the wire form", () => {
    const auth = sampleAuth(Keypair.generate());
    const back = authorizationFromWire(authorizationToWire(auth));
    expect(authorizationMessage(back)).toEqual(authorizationMessage(auth));
  });

  it("rejects malformed wire fields with a specific message", () => {
    const wire = authorizationToWire(sampleAuth(Keypair.generate()));
    expect(() => authorizationFromWire({ ...wire, amount: "-1" })).toThrow(/amount/);
    expect(() => authorizationFromWire({ ...wire, nonce: "abc" })).toThrow(/nonce/);
    expect(() => authorizationFromWire({ ...wire, mint: "not-a-key" })).toThrow(/mint/);
  });

  it("derives distinct receipt addresses per nonce", () => {
    const wallet = Keypair.generate().publicKey;
    const [a] = receiptAddress(wallet, randomNonce());
    const [b] = receiptAddress(wallet, randomNonce());
    expect(a.equals(b)).toBe(false);
  });
});

describe("resources", () => {
  it("canonicalizes without query or trailing slash and keeps path case", () => {
    expect(canonicalResource("HTTPS://Api.Example.com/v1/Summarize/?q=1#x")).toBe(
      "https://api.example.com/v1/Summarize",
    );
    expect(canonicalResource("http://localhost:4021/")).toBe("http://localhost:4021/");
  });
});

describe("amounts", () => {
  it("formats and parses exactly", () => {
    expect(formatUnits(12_500n)).toBe("0.0125");
    expect(formatUnits(1_000_000n)).toBe("1");
    expect(parseUnits("0.0125")).toBe(12_500n);
    expect(parseUnits("250")).toBe(250_000_000n);
    expect(() => parseUnits("0.0000001")).toThrow(/decimal places/);
    expect(() => parseUnits("1e3")).toThrow();
  });
});

describe("policy evaluation", () => {
  const session = Keypair.generate();
  const recipient = Keypair.generate().publicKey;
  const rid = resourceId("https://api.example.com/v1/summarize");
  const now = 1_800_000_000n;
  const base: PolicyState = {
    perCallCap: 10_000n,
    dailyCap: 50_000n,
    sessionKeys: [{ key: session.publicKey, expiresAt: 0n, active: true }],
    allowList: [{ resourceId: rid, recipient }],
    spendBuckets: [],
  };
  const intent = { sessionKey: session.publicKey, amount: 5_000n, resourceId: rid, recipient };

  it("allows a payment inside every limit", () => {
    expect(evaluatePayment(base, intent, now)).toEqual({ ok: true, rollingSpend: 0n });
  });

  it("names the exact limit a payment breaks", () => {
    const reason = (p: PolicyState, i = intent) => {
      const d = evaluatePayment(p, i, now);
      return d.ok ? "ok" : d.reason;
    };
    expect(reason(base, { ...intent, amount: 10_001n })).toBe("PerCallCapExceeded");
    expect(reason(base, { ...intent, recipient: Keypair.generate().publicKey })).toBe(
      "ResourceNotAllowed",
    );
    expect(reason(base, { ...intent, sessionKey: Keypair.generate().publicKey })).toBe(
      "SessionKeyNotFound",
    );
    expect(
      reason({ ...base, sessionKeys: [{ key: session.publicKey, expiresAt: 0n, active: false }] }),
    ).toBe("SessionKeyRevoked");
    expect(
      reason({
        ...base,
        sessionKeys: [{ key: session.publicKey, expiresAt: now - 1n, active: true }],
      }),
    ).toBe("SessionKeyExpired");
    expect(reason({ ...base, spendBuckets: [{ index: now / 900n, amount: 46_000n }] })).toBe(
      "DailyCapExceeded",
    );
    expect(reason({ ...base, vaultBalance: 4_999n })).toBe("InsufficientFunds");
  });

  it("keeps spend in the window for at least 24 hours", () => {
    const idx = now / 900n;
    const buckets = [
      { index: idx - 96n, amount: 7n },
      { index: idx - 97n, amount: 1_000n },
      { index: idx, amount: 3n },
    ];
    expect(rollingSpend(buckets, now)).toBe(10n);
    // A payment made at the very start of a bucket still counts 24 hours later.
    const paidAt = (idx - 96n) * 900n;
    expect(now - paidAt >= 86_400n).toBe(true);
  });
});
