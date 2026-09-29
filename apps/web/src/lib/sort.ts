export type SortDirection = "ascending" | "descending";
export type SortValue = string | number | bigint | null;

export interface SortState {
  key: string;
  direction: SortDirection;
}

/** Compares two cell values. Nulls sort last in both directions. Strings compare naturally. */
export function compareValues(a: SortValue, b: SortValue, direction: SortDirection): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  let result: number;
  if (typeof a === "string" && typeof b === "string") {
    result = a.localeCompare(b, "en", { numeric: true, sensitivity: "base" });
  } else if (typeof a === "bigint" || typeof b === "bigint") {
    const x = BigInt(a);
    const y = BigInt(b);
    result = x === y ? 0 : x < y ? -1 : 1;
  } else {
    result = Number(a) - Number(b);
  }
  return direction === "ascending" ? result : -result;
}

/** Stable sort of rows by one key without mutating the input. */
export function sortRows<Row>(
  rows: readonly Row[],
  read: (row: Row) => SortValue,
  direction: SortDirection,
): Row[] {
  return rows
    .map((row, index) => ({ row, index }))
    .sort((l, r) => compareValues(read(l.row), read(r.row), direction) || l.index - r.index)
    .map((entry) => entry.row);
}

/** Next state when a header is pressed. A new column starts ascending, the same column flips. */
export function nextSort(current: SortState | null, key: string): SortState {
  if (current?.key === key) {
    return { key, direction: current.direction === "ascending" ? "descending" : "ascending" };
  }
  return { key, direction: "ascending" };
}
