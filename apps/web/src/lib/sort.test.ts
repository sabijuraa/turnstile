import { describe, expect, it } from "vitest";
import { compareValues, nextSort, sortRows } from "./sort";

describe("compareValues", () => {
  it("sorts strings naturally", () => {
    const names = ["agent-10", "agent-2", "Agent-1"];
    expect([...names].sort((a, b) => compareValues(a, b, "ascending"))).toEqual([
      "Agent-1",
      "agent-2",
      "agent-10",
    ]);
  });

  it("compares bigint amounts exactly", () => {
    expect(compareValues(9_007_199_254_740_993n, 9_007_199_254_740_992n, "ascending")).toBe(1);
    expect(compareValues(9_007_199_254_740_993n, 9_007_199_254_740_992n, "descending")).toBe(-1);
  });

  it("puts nulls last in both directions", () => {
    expect(compareValues(null, 1, "ascending")).toBe(1);
    expect(compareValues(null, 1, "descending")).toBe(1);
  });
});

describe("sortRows", () => {
  const rows = [
    { id: "a", amount: 4000n },
    { id: "b", amount: 1000n },
    { id: "c", amount: 4000n },
  ];

  it("is stable and leaves the input untouched", () => {
    const sorted = sortRows(rows, (row) => row.amount, "descending");
    expect(sorted.map((row) => row.id)).toEqual(["a", "c", "b"]);
    expect(rows.map((row) => row.id)).toEqual(["a", "b", "c"]);
  });
});

describe("nextSort", () => {
  it("starts ascending and flips on the same column", () => {
    const first = nextSort(null, "amount");
    expect(first).toEqual({ key: "amount", direction: "ascending" });
    expect(nextSort(first, "amount")).toEqual({ key: "amount", direction: "descending" });
    expect(nextSort(first, "time")).toEqual({ key: "time", direction: "ascending" });
  });
});
