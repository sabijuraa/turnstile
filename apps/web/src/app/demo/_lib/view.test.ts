import { describe, expect, it } from "vitest";
import { parseApiError, parseRunEvent, parseSnapshot, type RunEvent } from "./events";
import { explorerLink } from "./explorer";
import { errorLogLine, expectedSettled, gateOf, receiptsOf, viewOf } from "./view";

const runId = "b8e4947d-7bff-4419-8555-030a4c3b4ad7";
const amount = (baseUnits: string, display: string) => ({ baseUnits, display });

const policy = {
  perCallCap: amount("10000", "0.01"),
  dailyCap: amount("30000", "0.03"),
  funding: amount("100000", "0.1"),
  pricePerCall: amount("5000", "0.005"),
  allowList: [
    {
      resource: "http://127.0.0.1:34021/v1/summarize",
      resourceId: "ac2d007bc56cd376b74bbd6a5c46fc736fbad701adb6bc15083ba6c2d4b6b708",
      recipient: "GSbySCxvk7zjAnHCv7kS7qN3fnYqPdFexjGmmRQGWNLS",
    },
  ],
  sessionKey: "123S8gsnRaXwDFqskKPs4FU8Y71VG8VTP4XDdySUhUyh",
  owner: "EGNvPSJfRvWGfAQePvBNWvX6ktA44W8abtz6JupdwJ6W",
  mint: "DbuD1yvnQb8rFsjWQP1G51nCyCukbyHYXtY1MyHiHpiX",
  network: "solana:localnet",
};

// Shapes copied from a real run against the local validator.
const events: unknown[] = [
  {
    runId,
    seq: 1,
    type: "run.started",
    at: "2026-09-29T16:53:25.894Z",
    data: {
      runId,
      agentWallet: "8jYyVsquJS5Ly4bhg4QJAcNbCwPvSW8jfroVL3LLVZma",
      walletId: "0",
      vault: "BvrViYju6tMP1T9KHt9h7suwhzbztGMecQgGkZXq8mW4",
      policy,
      setupTransaction: "3aiQpZTR9NptTsrYzRUj6TntqTBmwvH5TwkwjK88evvT",
    },
  },
  {
    runId,
    seq: 2,
    type: "call.settled",
    at: "2026-09-29T16:53:26.874Z",
    data: {
      index: 1,
      amount: amount("5000", "0.005"),
      receipt: "CaTXXfFsqww8vSzV5Ecupatmvk3z1Ar1Sfu62JWwZdhX",
      transaction: "66BU4cLCDNgNgYjBQ65xicntC8N39GkrW7xitRrqBuwk",
      rollingSpend: amount("5000", "0.005"),
      dailyCap: amount("30000", "0.03"),
      vaultBalance: amount("95000", "0.095"),
      passage: { title: "The Wealth of Nations", author: "Adam Smith", year: 1776 },
      summaryExcerpt: "But man has almost constant occasion for the help of his brethren.",
      compressionRatio: 0.356,
      latencyMs: 958,
    },
  },
  {
    runId,
    seq: 3,
    type: "call.refused",
    at: "2026-09-29T16:53:29.434Z",
    data: {
      index: 7,
      amount: amount("5000", "0.005"),
      reason: "DailyCapExceeded",
      message: "The settlement program refused call 7 with DailyCapExceeded. No funds moved.",
      facilitatorReason: "DailyCapExceeded",
      failedTransaction: "jeNQCzy6iKLyxf2WBuafsY1Hh5dh7XVDtRastVCevtb5",
      programLogs: [
        "Program log: AnchorError thrown in programs/agent-wallet/src/policy.rs:95. Error Code: DailyCapExceeded. Error Number: 6004.",
        "Program 7onzUVc1HGc9oBDUspBdP8dz1QW6uXrSdBn4NH6aiLb failed: custom program error: 0x1774",
      ],
      rollingSpend: amount("30000", "0.03"),
      dailyCap: amount("30000", "0.03"),
    },
  },
  {
    runId,
    seq: 4,
    type: "run.finished",
    at: "2026-09-29T16:53:29.909Z",
    data: {
      settledCalls: 1,
      refusedCalls: 1,
      totalSpent: amount("5000", "0.005"),
      withdrawn: amount("95000", "0.095"),
      withdrawTransaction: "xSP6Y6q8v5k1XDNdTytfgf5Rm538FCgwoaFXeNmaksg1",
      receipts: ["CaTXXfFsqww8vSzV5Ecupatmvk3z1Ar1Sfu62JWwZdhX"],
      durationMs: 4586,
    },
  },
];

const parsed = events.map(parseRunEvent).filter((e): e is RunEvent => e !== null);
const explorer = {
  explorerTx: "https://explorer.solana.com/tx/{value}?cluster=devnet",
  explorerAddress: "https://explorer.solana.com/address/{value}?cluster=devnet",
};

describe("parseRunEvent", () => {
  it("accepts every event shape the runner sends", () => {
    expect(parsed.map((e) => e.type)).toEqual([
      "run.started",
      "call.settled",
      "call.refused",
      "run.finished",
    ]);
  });

  it("rejects an unknown type and a settled call without its receipt", () => {
    expect(parseRunEvent({ ...(events[1] as object), type: "call.maybe" })).toBeNull();
    const broken = structuredClone(events[1]) as { data: { receipt?: string } };
    delete broken.data.receipt;
    expect(parseRunEvent(broken)).toBeNull();
    expect(parseRunEvent({ ...(events[1] as object), seq: "2" })).toBeNull();
  });

  it("rejects an amount that is not whole base units", () => {
    const broken = structuredClone(events[1]) as { data: { amount: unknown } };
    broken.data.amount = amount("0.005", "0.005");
    expect(parseRunEvent(broken)).toBeNull();
  });
});

describe("parseSnapshot and parseApiError", () => {
  it("orders events by seq and drops events of other runs", () => {
    const other = { ...(events[1] as object), runId: "00000000-0000-0000-0000-000000000000" };
    const snapshot = parseSnapshot({
      run: { id: runId, status: "finished", startedAt: "2026-09-29T16:53:25.000Z" },
      events: [events[2], events[0], other],
    });
    expect(snapshot?.events.map((e) => e.seq)).toEqual([1, 3]);
    expect(snapshot?.run.agentWallet).toBeNull();
  });

  it("reads the 409 body with the run that holds the lock", () => {
    expect(parseApiError({ error: { code: "run_in_progress", message: "Busy." }, runId })).toEqual({
      code: "run_in_progress",
      message: "Busy.",
      runId,
    });
    expect(parseApiError({ error: "nope" })).toBeNull();
  });
});

describe("viewOf and receiptsOf", () => {
  const view = viewOf(parsed);

  it("tracks rolling spend from the chain reading of the last call", () => {
    expect(view.spent).toBe(30000n);
    expect(view.refusal?.reason).toBe("DailyCapExceeded");
    expect(view.finished?.withdrawn.display).toBe("0.095");
  });

  it("lists receipts newest first with the refused call as failed", () => {
    const rows = receiptsOf(view, explorer);
    expect(rows.map((r) => [r.status, r.payer])).toEqual([
      ["failed", "Call 7"],
      ["settled", "Call 1"],
    ]);
    expect(rows[0]?.explorerUrl).toBe(
      "https://explorer.solana.com/tx/jeNQCzy6iKLyxf2WBuafsY1Hh5dh7XVDtRastVCevtb5?cluster=devnet",
    );
    expect(rows[1]?.explorerUrl).toBe(
      "https://explorer.solana.com/address/CaTXXfFsqww8vSzV5Ecupatmvk3z1Ar1Sfu62JWwZdhX?cluster=devnet",
    );
  });
});

describe("gateOf", () => {
  it("passes every check for a settled call", () => {
    const call = parsed[1];
    if (call?.type !== "call.settled") throw new Error("fixture order changed");
    const gate = gateOf(call, policy.perCallCap);
    expect(gate.checks.map((c) => c.state)).toEqual(["pass", "pass", "pass"]);
    expect(gate.outcome).toEqual({
      kind: "settled",
      amount: "0.005",
      asset: "tUSDC",
      reference: "CaTX…ZdhX",
    });
  });

  it("fails the daily cap last, in program order, for DailyCapExceeded", () => {
    const call = parsed[2];
    if (call?.type !== "call.refused") throw new Error("fixture order changed");
    const gate = gateOf(call, policy.perCallCap);
    expect(gate.checks.map((c) => [c.label, c.state])).toEqual([
      ["Per-call cap", "pass"],
      ["Allow-listed", "pass"],
      ["Daily cap", "fail"],
    ]);
    expect(gate.checks[2]?.detail).toBe("0.03 + 0.005 > 0.03");
    expect(gate.outcome).toEqual({
      kind: "refused",
      reason: "Daily cap reached",
      code: "DailyCapExceeded",
    });
  });
});

describe("helpers", () => {
  it("counts the calls that fit under the cap in base units", () => {
    expect(expectedSettled(policy)).toBe(6);
    expect(expectedSettled({ ...policy, pricePerCall: amount("7000", "0.007") })).toBe(4);
    expect(expectedSettled({ ...policy, pricePerCall: amount("20000", "0.02") })).toBeNull();
  });

  it("picks the log line that names the error", () => {
    expect(
      errorLogLine(["Program x invoke [1]", "Program log: Error Code: DailyCapExceeded."]),
    ).toBe("Error Code: DailyCapExceeded.");
  });

  it("fills explorer templates with an encoded value", () => {
    expect(explorerLink(explorer.explorerTx, "abc")).toBe(
      "https://explorer.solana.com/tx/abc?cluster=devnet",
    );
  });
});
