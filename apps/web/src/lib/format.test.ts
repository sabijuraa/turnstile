import { describe, expect, it } from "vitest";
import { formatTimestamp, groupDigits, meterRatio, meterTone, shortAddress } from "./format";

describe("meterRatio", () => {
  it("is exact for amounts beyond float precision", () => {
    // 9007199254.740993 USDC spent of a 18014398509.481986 cap is exactly one half.
    expect(meterRatio(9_007_199_254_740_993n, 18_014_398_509_481_986n)).toBe(0.5);
  });

  it("clamps to the range 0 to 1", () => {
    expect(meterRatio(0n, 5_000_000n)).toBe(0);
    expect(meterRatio(-1n, 5_000_000n)).toBe(0);
    expect(meterRatio(7_000_000n, 5_000_000n)).toBe(1);
  });

  it("reads a zero cap as full once anything is spent", () => {
    expect(meterRatio(1n, 0n)).toBe(1);
    expect(meterRatio(0n, 0n)).toBe(0);
  });

  it("keeps six decimal places of precision", () => {
    expect(meterRatio(3_212_000n, 5_000_000n)).toBe(0.6424);
  });
});

describe("meterTone", () => {
  it("moves from normal to caution to critical", () => {
    expect(meterTone(3_999_999n, 5_000_000n)).toBe("normal");
    expect(meterTone(4_000_000n, 5_000_000n)).toBe("caution");
    expect(meterTone(5_000_000n, 5_000_000n)).toBe("critical");
  });

  it("honours a custom caution threshold", () => {
    expect(meterTone(2_500_000n, 5_000_000n, 0.5)).toBe("caution");
  });

  it("treats any spend against a zero cap as critical", () => {
    expect(meterTone(1n, 0n)).toBe("critical");
    expect(meterTone(0n, 0n)).toBe("normal");
  });
});

describe("groupDigits", () => {
  it("groups the whole part only", () => {
    expect(groupDigits("1234567.000123")).toBe("1,234,567.000123");
    expect(groupDigits("999")).toBe("999");
    expect(groupDigits("-12500.5")).toBe("-12,500.5");
  });
});

describe("shortAddress", () => {
  it("keeps head and tail", () => {
    expect(shortAddress("6FrY43zorjSv8wCuarPL3z8ZnyBTyyC86xRjBqgu1K9z")).toBe("6FrY…1K9z");
    expect(shortAddress("abc")).toBe("abc");
  });
});

describe("formatTimestamp", () => {
  it("formats in UTC by default so server and browser agree", () => {
    expect(formatTimestamp("2026-09-29T14:32:08Z")).toBe("29 Sep 14:32:08");
  });

  it("respects an explicit zone", () => {
    expect(formatTimestamp("2026-09-29T23:30:00Z", "Asia/Tokyo")).toBe("30 Sep 08:30:00");
  });

  it("rejects an invalid timestamp with a clear message", () => {
    expect(() => formatTimestamp("yesterday")).toThrow('"yesterday" is not a valid ISO timestamp');
  });
});
