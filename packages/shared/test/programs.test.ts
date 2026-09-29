import { BN } from "@anchor-lang/core";
import { Keypair, PublicKey, type TransactionInstruction } from "@solana/web3.js";
import { describe, expect, it } from "vitest";
import {
  AGENT_WALLET_PROGRAM_ID,
  agentWalletAddress,
  authorizationMessage,
  encodeAuthorizationBody,
  evaluatePayment,
  type PaymentAuthorization,
  receiptAddress,
  resourceId,
  SETTLEMENT_PROGRAM_ID,
  settlementAuthorityAddress,
  signAuthorization,
  vaultAddress,
} from "../src/index.js";
import {
  addSessionKeyInstruction,
  agentWalletCoder,
  agentWalletIdl,
  closeWalletInstruction,
  createWalletInstruction,
  decodeAgentWallet,
  decodePaymentSettledEvents,
  decodeReceipt,
  decodeRollingSpendReturnData,
  depositInstruction,
  MAX_ALLOW_LIST_PER_UPDATE,
  PROGRAM_ERRORS,
  parseProgramError,
  programErrorName,
  revokeSessionKeyInstruction,
  rollingSpendInstruction,
  settleInstructions,
  settlementCoder,
  settlementIdl,
  updatePolicyInstruction,
  withdrawInstruction,
} from "../src/programs/index.js";

interface IdlIxAccount {
  name: string;
  writable?: boolean;
  signer?: boolean;
}
interface IdlIx {
  name: string;
  discriminator: readonly number[];
  accounts: readonly IdlIxAccount[];
}

function idlIx(idl: { instructions: readonly unknown[] }, name: string): IdlIx {
  const ix = (idl.instructions as readonly IdlIx[]).find((i) => i.name === name);
  if (!ix) throw new Error(`instruction ${name} missing from IDL`);
  return ix;
}

function expectMatchesIdl(
  ix: TransactionInstruction,
  idl: { instructions: readonly unknown[] },
  name: string,
) {
  const spec = idlIx(idl, name);
  expect(Array.from(ix.data.subarray(0, 8))).toEqual([...spec.discriminator]);
  expect(ix.keys.map((k) => [k.isSigner, k.isWritable])).toEqual(
    spec.accounts.map((a) => [a.signer ?? false, a.writable ?? false]),
  );
}

const owner = Keypair.generate().publicKey;
const [wallet] = agentWalletAddress(owner, 3n);

function sampleAuth(session: Keypair): PaymentAuthorization {
  return {
    agentWallet: wallet,
    sessionKey: session.publicKey,
    recipient: Keypair.generate().publicKey,
    mint: Keypair.generate().publicKey,
    amount: 12_500n,
    resourceId: resourceId("https://demo.turnstile.dev/v1/summarize"),
    nonce: Uint8Array.from({ length: 32 }, (_, i) => i),
    expiresAt: 1_900_000_000n,
  };
}

describe("instruction builders", () => {
  it("match the IDL account order, signer and writable flags", () => {
    const mint = Keypair.generate().publicKey;
    const token = Keypair.generate().publicKey;
    const session = Keypair.generate().publicKey;
    const cases: [TransactionInstruction, string][] = [
      [
        createWalletInstruction({
          owner,
          mint,
          id: 3n,
          perCallCap: 10n,
          dailyCap: 100n,
          sessionKey: session,
          sessionExpiresAt: 0n,
        }),
        "create_wallet",
      ],
      [
        depositInstruction({ owner, agentWallet: wallet, ownerToken: token, amount: 1n }),
        "deposit",
      ],
      [
        withdrawInstruction({ owner, agentWallet: wallet, ownerToken: token, amount: 1n }),
        "withdraw",
      ],
      [
        addSessionKeyInstruction({
          owner,
          agentWallet: wallet,
          sessionKey: session,
          expiresAt: 0n,
        }),
        "add_session_key",
      ],
      [
        revokeSessionKeyInstruction({ owner, agentWallet: wallet, sessionKey: session }),
        "revoke_session_key",
      ],
      [
        updatePolicyInstruction({
          owner,
          agentWallet: wallet,
          perCallCap: 1n,
          dailyCap: 2n,
          allowList: [{ resourceId: new Uint8Array(32).fill(7), recipient: session }],
        }),
        "update_policy",
      ],
      [closeWalletInstruction({ owner, agentWallet: wallet }), "close_wallet"],
      [rollingSpendInstruction({ agentWallet: wallet }), "rolling_spend"],
    ];
    for (const [ix, name] of cases) {
      expect(ix.programId.equals(AGENT_WALLET_PROGRAM_ID)).toBe(true);
      expectMatchesIdl(ix, agentWalletIdl, name);
    }
    const create = cases[0]?.[0];
    expect(create?.keys[1]?.pubkey.equals(wallet)).toBe(true);
    expect(create?.keys[3]?.pubkey.equals(vaultAddress(wallet)[0])).toBe(true);
  });

  it("settle carries the exact 208 byte authorization body after the discriminator", () => {
    const session = Keypair.generate();
    const auth = sampleAuth(session);
    const signature = signAuthorization(auth, session.secretKey);
    const [ed, settle] = settleInstructions({
      authorization: auth,
      signature,
      feePayer: Keypair.generate().publicKey,
    });
    expectMatchesIdl(settle, settlementIdl, "settle");
    expect(settle.programId.equals(SETTLEMENT_PROGRAM_ID)).toBe(true);
    expect(settle.data.length).toBe(8 + 208);
    expect(
      Buffer.from(settle.data.subarray(8)).equals(Buffer.from(encodeAuthorizationBody(auth))),
    ).toBe(true);
    expect(settle.keys[1]?.pubkey.equals(settlementAuthorityAddress()[0])).toBe(true);
    expect(settle.keys[5]?.pubkey.equals(receiptAddress(wallet, auth.nonce)[0])).toBe(true);

    // The Ed25519 instruction verifies the session key over the exact message, inline.
    const data = ed.data;
    expect(data[0]).toBe(1);
    const u16 = (at: number) => data.readUInt16LE(at);
    expect([u16(4), u16(8), u16(14)]).toEqual([0xffff, 0xffff, 0xffff]);
    expect(
      Buffer.from(data.subarray(u16(6), u16(6) + 32)).equals(session.publicKey.toBuffer()),
    ).toBe(true);
    const message = Buffer.from(authorizationMessage(auth));
    expect(u16(12)).toBe(260);
    expect(Buffer.from(data.subarray(u16(10), u16(10) + 260)).equals(message)).toBe(true);
  });

  it("caps update_policy at the 15 entries that fit in one transaction", () => {
    const entry = { resourceId: new Uint8Array(32).fill(1), recipient: owner };
    const make = (n: number) =>
      updatePolicyInstruction({
        owner,
        agentWallet: wallet,
        perCallCap: 1n,
        dailyCap: 1n,
        allowList: Array.from({ length: n }, () => entry),
      });
    expect(make(MAX_ALLOW_LIST_PER_UPDATE).data.length).toBe(8 + 8 + 8 + 4 + 15 * 64);
    expect(() => make(16)).toThrow("at most 15");
  });

  it("rejects resource ids and nonces that are not 32 bytes", () => {
    expect(() =>
      updatePolicyInstruction({
        owner,
        agentWallet: wallet,
        perCallCap: 1n,
        dailyCap: 1n,
        allowList: [{ resourceId: new Uint8Array(31), recipient: owner }],
      }),
    ).toThrow("resourceId must be 32 bytes");
  });
});

describe("decoders", () => {
  it("decodes an agent wallet into the policy shape evaluatePayment takes", async () => {
    const session = Keypair.generate().publicKey;
    const recipient = Keypair.generate().publicKey;
    const rid = resourceId("https://demo.turnstile.dev/v1/summarize");
    const now = 1_800_000_000n;
    const index = now / 900n;
    const buckets = Array.from({ length: 97 }, () => ({ index: new BN(0), amount: new BN(0) }));
    buckets[Number(index % 97n)] = { index: new BN(index.toString()), amount: new BN(40) };
    const data = encodeLargeAccount("AgentWallet", {
      owner,
      id: new BN(3),
      mint: PublicKey.default,
      vault: vaultAddress(wallet)[0],
      bump: 254,
      vault_bump: 253,
      created_at: new BN(1_700_000_000),
      per_call_cap: new BN(50),
      daily_cap: new BN(100),
      session_keys: [{ key: session, expires_at: new BN(0), active: true }],
      allow_list: [{ resource_id: Array.from(rid), recipient }],
      spend_buckets: buckets,
      total_spent: new BN(40),
      settlement_count: new BN(1),
    });
    const decoded = decodeAgentWallet(data);
    expect(decoded.owner.equals(owner)).toBe(true);
    expect(decoded.id).toBe(3n);
    expect(decoded.bump).toBe(254);
    expect(decoded.vaultBump).toBe(253);
    expect(decoded.createdAt).toBe(1_700_000_000n);
    expect(decoded.totalSpent).toBe(40n);
    expect(decoded.settlementCount).toBe(1n);
    expect(decoded.policy.perCallCap).toBe(50n);
    expect(decoded.policy.spendBuckets).toHaveLength(97);
    const intent = { sessionKey: session, amount: 60n, resourceId: rid, recipient };
    expect(evaluatePayment(decoded.policy, { ...intent, amount: 60n }, now)).toMatchObject({
      ok: false,
      reason: "PerCallCapExceeded",
    });
    expect(evaluatePayment(decoded.policy, { ...intent, amount: 50n }, now)).toEqual({
      ok: true,
      rollingSpend: 40n,
    });
    expect(evaluatePayment(decoded.policy, { ...intent, amount: 50n }, now + 900n * 97n)).toEqual({
      ok: true,
      rollingSpend: 0n,
    });
  });

  it("refuses to decode a receipt as an agent wallet", async () => {
    const data = await settlementCoder.accounts.encode("Receipt", receiptFields());
    expect(() => decodeAgentWallet(data)).toThrow();
    const r = decodeReceipt(data);
    expect(r.amount).toBe(777n);
    expect(r.nonce).toEqual(new Uint8Array(32).fill(9));
    expect(r.unixTimestamp).toBe(1_800_000_123n);
    expect(r.expiresAt).toBe(1_800_000_400n);
  });

  it("decodes PaymentSettled only from settlement program logs", () => {
    const fields = { receipt: Keypair.generate().publicKey, ...receiptFields() };
    const layout = settlementCoder.types;
    const body = layout.encode("PaymentSettled", fields);
    const spec = (
      settlementIdl.events as readonly { name: string; discriminator: readonly number[] }[]
    ).find((e) => e.name === "PaymentSettled");
    if (!spec) throw new Error("PaymentSettled missing from IDL");
    const line = `Program data: ${Buffer.concat([Buffer.from(spec.discriminator), body]).toString("base64")}`;
    const s = SETTLEMENT_PROGRAM_ID.toBase58();
    const a = AGENT_WALLET_PROGRAM_ID.toBase58();
    const logs = [
      `Program ${s} invoke [1]`,
      "Program log: Instruction: Settle",
      `Program ${a} invoke [2]`,
      line,
      `Program ${a} success`,
      line,
      `Program ${s} success`,
    ];
    const events = decodePaymentSettledEvents(logs);
    expect(events).toHaveLength(1);
    expect(events[0]?.amount).toBe(777n);
    expect(events[0]?.expiresAt).toBe(1_800_000_400n);
    expect(events[0]?.receipt.equals(fields.receipt)).toBe(true);
    expect(
      decodePaymentSettledEvents([`Program ${a} invoke [1]`, line, `Program ${a} success`]),
    ).toEqual([]);
  });

  it("reads rolling_spend return data", () => {
    const buf = Buffer.alloc(8);
    buf.writeBigUInt64LE(123_456n);
    expect(decodeRollingSpendReturnData(buf.toString("base64"))).toBe(123_456n);
    expect(() => decodeRollingSpendReturnData("AA==")).toThrow("8 bytes");
  });
});

/**
 * The Anchor account coder encodes into a fixed 1000 byte buffer and the AgentWallet account is
 * about 2.9 KB. Tests reach the same IDL derived layout with a larger buffer.
 */
function encodeLargeAccount(name: string, value: Record<string, unknown>): Buffer {
  const coder = agentWalletCoder.accounts as unknown as {
    accountLayouts: Map<string, { layout: { encode(v: unknown, b: Buffer): number } }>;
  };
  const entry = coder.accountLayouts.get(name);
  if (!entry) throw new Error(`${name} layout missing`);
  const buf = Buffer.alloc(8192);
  const len = entry.layout.encode(value, buf);
  return Buffer.concat([
    agentWalletCoder.accounts.accountDiscriminator(name),
    buf.subarray(0, len),
  ]);
}

function receiptFields() {
  return {
    agent_wallet: wallet,
    owner,
    session_key: Keypair.generate().publicKey,
    recipient: Keypair.generate().publicKey,
    recipient_token: Keypair.generate().publicKey,
    mint: Keypair.generate().publicKey,
    amount: new BN(777),
    resource_id: Array(32).fill(3),
    nonce: Array(32).fill(9),
    slot: new BN(42),
    unix_timestamp: new BN(1_800_000_123),
    fee_payer: Keypair.generate().publicKey,
    bump: 255,
    expires_at: new BN(1_800_000_400),
  };
}

describe("program errors", () => {
  it("maps both programs without collisions", () => {
    expect(programErrorName(6004)).toBe("DailyCapExceeded");
    expect(programErrorName(6103)).toBe("NonceAlreadyUsed");
    expect(programErrorName(6104)).toBe("AccountMismatch");
    expect(PROGRAM_ERRORS.get(6016)?.program).toBe("agent_wallet");
    expect(programErrorName(6105)).toBe("RetentionNotElapsed");
    expect(programErrorName(6106)).toBe("NotFeePayer");
    expect(PROGRAM_ERRORS.size).toBe(18 + 7);
    expect(programErrorName(1)).toBeNull();
  });

  it("parses transaction errors and logs", () => {
    expect(parseProgramError({ InstructionError: [1, { Custom: 6003 }] })?.name).toBe(
      "PerCallCapExceeded",
    );
    expect(
      parseProgramError(null, [
        "Program log: AnchorError thrown in programs/settlement/src/lib.rs:1. Error Code: NonceAlreadyUsed. Error Number: 6103. Error Message: x.",
      ])?.name,
    ).toBe("NonceAlreadyUsed");
    expect(parseProgramError(new Error("custom program error: 0x1772"))?.name).toBe(
      "SessionKeyExpired",
    );
    expect(parseProgramError({ InstructionError: [0, "InvalidAccountData"] })).toBeNull();
  });
});
