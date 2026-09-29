import { describe, expect, it } from "vitest";
import { classifyError } from "../src/chain/solana.js";

const names: Record<number, string> = { 6003: "PerCallCapExceeded", 6103: "NonceAlreadyUsed" };
const byCode = (code: number) => names[code];

describe("classifyError", () => {
  it("names a custom program error from its code", () => {
    expect(classifyError({ InstructionError: [1, { Custom: 6003 }] }, null, byCode)).toMatchObject({
      kind: "named",
      reason: "PerCallCapExceeded",
    });
  });

  it("falls back to the Anchor error log line", () => {
    const logs = [
      "Program log: AnchorError occurred. Error Code: DailyCapExceeded. Error Number: 6004.",
    ];
    expect(classifyError({ InstructionError: [1, { Custom: 6004 }] }, logs, byCode)).toMatchObject({
      reason: "DailyCapExceeded",
    });
  });

  it("treats a failure in the Ed25519 instruction as a bad signature", () => {
    expect(classifyError({ InstructionError: [0, { Custom: 2 }] }, null, byCode)).toMatchObject({
      reason: "invalid_signature",
    });
  });

  it("keeps an unnamed instruction failure final and a transaction error unknown", () => {
    expect(
      classifyError({ InstructionError: [1, "AccountAlreadyInitialized"] }, null, byCode),
    ).toMatchObject({ kind: "named", reason: "settlement_simulation_failed" });
    expect(classifyError("BlockhashNotFound", null, byCode)).toEqual({
      kind: "other",
      detail: '"BlockhashNotFound"',
    });
  });
});
