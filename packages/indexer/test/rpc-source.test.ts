import { createHash } from "node:crypto";
import {
  type AccountInfo,
  Keypair,
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  type VersionedTransactionResponse,
} from "@solana/web3.js";
import { SETTLEMENT_PROGRAM_ID } from "@turnstile/shared";
import bs58 from "bs58";
import { describe, expect, it } from "vitest";
import { createRpcSource, type SettlementDecoder, type SolanaRpc } from "../src/rpc-source.js";
import { type SettledReceipt, UntilSignatureUnavailableError } from "../src/source.js";
import { makeReceipt } from "./fake-source.js";

const program = SETTLEMENT_PROGRAM_ID;

/** Decoder stand-in. Logs of the form "event <address>" and account data holding the address. */
function testDecoder(known: Map<string, SettledReceipt>): SettlementDecoder {
  return {
    receiptDiscriminator: Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8]),
    eventsFromLogs: (logs) =>
      logs.flatMap((l) => {
        const m = /^event (\w+)$/.exec(l);
        const r = m?.[1] ? known.get(m[1]) : undefined;
        return r ? [r] : [];
      }),
    receiptFromAccount: (address, data) => {
      const r = known.get(Buffer.from(data).toString("utf8"));
      return r && r.receiptAddress === address ? r : null;
    },
  };
}

function account(owner: PublicKey, text: string): AccountInfo<Buffer> {
  return { owner, data: Buffer.from(text), lamports: 1, executable: false, rentEpoch: 0 };
}

interface Calls {
  [name: string]: unknown[][];
}

function fakeRpc(over: Partial<SolanaRpc>): { rpc: SolanaRpc; calls: Calls } {
  const calls: Calls = {};
  const record =
    <A extends unknown[], R>(name: string, fn: (...a: A) => R) =>
    (...args: A): R => {
      if (!calls[name]) calls[name] = [];
      calls[name].push(args);
      return fn(...args);
    };
  const missing = (name: string) => () => {
    throw new Error(`${name} was not expected in this test`);
  };
  const rpc = {
    getGenesisHash: record("getGenesisHash", over.getGenesisHash ?? missing("getGenesisHash")),
    getSlot: record("getSlot", over.getSlot ?? missing("getSlot")),
    getSignaturesForAddress: record(
      "getSignaturesForAddress",
      over.getSignaturesForAddress ?? missing("getSignaturesForAddress"),
    ),
    getSignatureStatuses: record(
      "getSignatureStatuses",
      over.getSignatureStatuses ?? missing("getSignatureStatuses"),
    ),
    getTransaction: record("getTransaction", over.getTransaction ?? missing("getTransaction")),
    getMultipleAccountsInfo: record(
      "getMultipleAccountsInfo",
      over.getMultipleAccountsInfo ?? missing("getMultipleAccountsInfo"),
    ),
    getProgramAccounts: record(
      "getProgramAccounts",
      over.getProgramAccounts ?? missing("getProgramAccounts"),
    ),
    getMinimumLedgerSlot: record(
      "getMinimumLedgerSlot",
      over.getMinimumLedgerSlot ?? missing("getMinimumLedgerSlot"),
    ),
    getFirstAvailableBlock: record(
      "getFirstAvailableBlock",
      over.getFirstAvailableBlock ?? missing("getFirstAvailableBlock"),
    ),
  } as SolanaRpc;
  return { rpc, calls };
}

describe("rpc source", () => {
  it("asks for settlement program signatures at confirmed and flags failed ones", async () => {
    const { rpc, calls } = fakeRpc({
      getSignaturesForAddress: (async () => [
        { signature: "b", slot: 9, err: null, memo: null, blockTime: null },
        {
          signature: "a",
          slot: 7,
          err: { InstructionError: [1, "Custom"] },
          memo: null,
          blockTime: null,
        },
      ]) as SolanaRpc["getSignaturesForAddress"],
    });
    const src = createRpcSource({
      rpc,
      settlementProgram: program,
      decoder: testDecoder(new Map()),
    });
    const out = await src.signatures({ until: "z", before: "c", limit: 50 });
    expect(out).toEqual([
      { signature: "b", slot: 9, failed: false },
      { signature: "a", slot: 7, failed: true },
    ]);
    expect(calls.getSignaturesForAddress?.[0]).toEqual([
      program,
      { limit: 50, until: "z", before: "c" },
      "confirmed",
    ]);
  });

  it("knows a signature only when the node returns a status for it", async () => {
    let value: unknown[] = [null];
    const { rpc, calls } = fakeRpc({
      getSignatureStatuses: (async () => ({
        context: { slot: 1 },
        value,
      })) as SolanaRpc["getSignatureStatuses"],
    });
    const src = createRpcSource({
      rpc,
      settlementProgram: program,
      decoder: testDecoder(new Map()),
    });
    expect(await src.signatureKnown("s")).toBe(false);
    value = [{ slot: 3, confirmations: null, err: null }];
    expect(await src.signatureKnown("s")).toBe(true);
    expect(calls.getSignatureStatuses?.[0]).toEqual([["s"], { searchTransactionHistory: true }]);
  });

  it("fetches version 0 transactions at confirmed and decodes their events", async () => {
    const r1 = makeReceipt(40);
    const r2 = makeReceipt(40);
    const known = new Map([r1, r2].map((r) => [r.receiptAddress, r]));
    const { rpc, calls } = fakeRpc({
      getTransaction: (async () => ({
        slot: 40,
        meta: {
          err: null,
          logMessages: [`event ${r1.receiptAddress}`, "noise", `event ${r2.receiptAddress}`],
        },
      })) as unknown as SolanaRpc["getTransaction"],
    });
    const src = createRpcSource({ rpc, settlementProgram: program, decoder: testDecoder(known) });
    const tx = await src.transaction("sig");
    expect(tx).toEqual({ signature: "sig", slot: 40, receipts: [r1, r2] });
    expect(calls.getTransaction?.[0]).toEqual([
      "sig",
      { commitment: "confirmed", maxSupportedTransactionVersion: 0 },
    ]);
  });

  it("returns null for a transaction the node does not have and nothing for a failed one", async () => {
    let answer: unknown = null;
    const { rpc } = fakeRpc({
      getTransaction: (async () => answer) as unknown as SolanaRpc["getTransaction"],
    });
    const src = createRpcSource({
      rpc,
      settlementProgram: program,
      decoder: testDecoder(new Map()),
    });
    expect(await src.transaction("sig")).toBeNull();
    answer = { slot: 5, meta: { err: { InstructionError: [0, "Custom"] }, logMessages: [] } };
    expect(await src.transaction("sig")).toEqual({ signature: "sig", slot: 5, receipts: [] });
    answer = { slot: 5, meta: { err: null, logMessages: null } };
    await expect(src.transaction("sig")).rejects.toThrow(/without log messages/);
  });

  it("reads receipt accounts in chunks of 100 and ignores accounts the program does not own", async () => {
    const receipts = Array.from({ length: 150 }, (_, i) => makeReceipt(i));
    const known = new Map(receipts.map((r) => [r.receiptAddress, r]));
    const foreign = receipts[3]?.receiptAddress;
    const { rpc, calls } = fakeRpc({
      getMultipleAccountsInfo: (async (keys: PublicKey[]) =>
        keys.map((k) => {
          const a = k.toBase58();
          if (a === receipts[7]?.receiptAddress) return null;
          return account(a === foreign ? Keypair.generate().publicKey : program, a);
        })) as SolanaRpc["getMultipleAccountsInfo"],
    });
    const src = createRpcSource({ rpc, settlementProgram: program, decoder: testDecoder(known) });
    const out = await src.receiptAccounts(receipts.map((r) => r.receiptAddress));
    expect(calls.getMultipleAccountsInfo?.map((c) => (c[0] as PublicKey[]).length)).toEqual([
      100, 50,
    ]);
    expect(out.length).toBe(150);
    expect(out[0]).toEqual(receipts[0]);
    expect(out[3]).toBeNull();
    expect(out[7]).toBeNull();
    expect(out[149]).toEqual(receipts[149]);
  });

  it("reads receipts from the settle instructions when the logs are truncated", async () => {
    const r1 = makeReceipt(60);
    const r2 = makeReceipt(60);
    const known = new Map([r1, r2].map((r) => [r.receiptAddress, r]));
    const discriminator = createHash("sha256").update("global:settle").digest().subarray(0, 8);
    const settleIx = (receipt: string) =>
      new TransactionInstruction({
        programId: program,
        keys: [0, 1, 2, 3, 4]
          .map(() => ({
            pubkey: Keypair.generate().publicKey,
            isSigner: false,
            isWritable: false,
          }))
          .concat([{ pubkey: new PublicKey(receipt), isSigner: false, isWritable: true }]),
        data: Buffer.concat([discriminator, Buffer.alloc(208)]),
      });
    const message = new TransactionMessage({
      payerKey: Keypair.generate().publicKey,
      recentBlockhash: PublicKey.default.toBase58(),
      instructions: [settleIx(r1.receiptAddress), settleIx(r2.receiptAddress)],
    }).compileToV0Message();
    const { rpc } = fakeRpc({
      getTransaction: (async () =>
        ({
          slot: 60,
          transaction: { message, signatures: [] },
          meta: {
            err: null,
            innerInstructions: [],
            loadedAddresses: { writable: [], readonly: [] },
            logMessages: [`event ${r1.receiptAddress}`, "Log truncated"],
          },
        }) as unknown as VersionedTransactionResponse) as unknown as SolanaRpc["getTransaction"],
      getMultipleAccountsInfo: (async (keys: PublicKey[]) =>
        keys.map((k) => account(program, k.toBase58()))) as SolanaRpc["getMultipleAccountsInfo"],
    });
    const src = createRpcSource({ rpc, settlementProgram: program, decoder: testDecoder(known) });
    const tx = await src.transaction("sig");
    expect(tx?.receipts).toEqual([r1, r2]);
  });

  it("turns a refused until into UntilSignatureUnavailableError and passes other errors on", async () => {
    let message = "failed to get signatures for address: Transaction 5xyz not found";
    const { rpc } = fakeRpc({
      getSignaturesForAddress: (async () => {
        throw new Error(message);
      }) as SolanaRpc["getSignaturesForAddress"],
    });
    const src = createRpcSource({
      rpc,
      settlementProgram: program,
      decoder: testDecoder(new Map()),
    });
    await expect(src.signatures({ until: "5xyz", limit: 10 })).rejects.toBeInstanceOf(
      UntilSignatureUnavailableError,
    );
    // Without until the same text is an ordinary RPC failure.
    await expect(src.signatures({ limit: 10 })).rejects.not.toBeInstanceOf(
      UntilSignatureUnavailableError,
    );
    message = "fetch failed";
    await expect(src.signatures({ until: "5xyz", limit: 10 })).rejects.toThrow("fetch failed");
    await expect(src.signatures({ until: "5xyz", limit: 10 })).rejects.not.toBeInstanceOf(
      UntilSignatureUnavailableError,
    );
  });

  it("reports history from the later of the minimum ledger slot and the first block", async () => {
    const { rpc } = fakeRpc({
      getMinimumLedgerSlot: (async () => 700) as SolanaRpc["getMinimumLedgerSlot"],
      getFirstAvailableBlock: (async () => 712) as SolanaRpc["getFirstAvailableBlock"],
    });
    const src = createRpcSource({
      rpc,
      settlementProgram: program,
      decoder: testDecoder(new Map()),
    });
    expect(await src.historyStartSlot()).toBe(712);
  });

  it("lists live receipts with a discriminator filter", async () => {
    const r1 = makeReceipt(3);
    const r2 = makeReceipt(4);
    const known = new Map([r1, r2].map((r) => [r.receiptAddress, r]));
    const { rpc, calls } = fakeRpc({
      getProgramAccounts: (async () =>
        [r1, r2].map((r) => ({
          pubkey: new PublicKey(r.receiptAddress),
          account: account(program, r.receiptAddress),
        }))) as unknown as SolanaRpc["getProgramAccounts"],
    });
    const src = createRpcSource({ rpc, settlementProgram: program, decoder: testDecoder(known) });
    expect(await src.liveReceipts()).toEqual([r1, r2]);
    expect(calls.getProgramAccounts?.[0]).toEqual([
      program,
      {
        commitment: "confirmed",
        filters: [
          { memcmp: { offset: 0, bytes: bs58.encode(Uint8Array.from([1, 2, 3, 4, 5, 6, 7, 8])) } },
        ],
      },
    ]);
  });
});
