"use client";

import { type ReactNode, useMemo, useState } from "react";
import { nextSort, type SortState, type SortValue, sortRows } from "@/lib/sort";
import { Icon } from "./Icon";
import styles from "./Table.module.css";

export interface TableColumn {
  key: string;
  label: string;
  /** Right aligns the column and uses tabular figures. Use for amounts and counts. */
  numeric?: boolean;
  /** Uses the mono family, for addresses and identifiers. */
  mono?: boolean;
  sortable?: boolean;
  /** CSS width, for example "8rem". */
  width?: string;
}

export interface TableCell {
  /** Value used for sorting. Base unit amounts go here as bigint so sorting stays exact. */
  value: SortValue;
  /** What to render. Falls back to the value as text. */
  display?: ReactNode;
}

export interface TableRow {
  id: string;
  cells: Record<string, TableCell>;
}

export interface TableProps {
  columns: readonly TableColumn[];
  rows: readonly TableRow[];
  /** Names the table for assistive tech. Hidden visually unless `showCaption` is set. */
  caption: string;
  showCaption?: boolean;
  /** Sort applied on first render. */
  initialSort?: SortState;
  /** Controlled sort. When set, rows are shown in the order given and the parent sorts. */
  sort?: SortState | null;
  onSortChange?: (sort: SortState) => void;
  /** Shown in place of the body when there are no rows. */
  empty?: ReactNode;
}

export function Table({
  columns,
  rows,
  caption,
  showCaption = false,
  initialSort,
  sort: controlledSort,
  onSortChange,
  empty,
}: TableProps) {
  const [localSort, setLocalSort] = useState<SortState | null>(initialSort ?? null);
  const controlled = controlledSort !== undefined;
  const sort = controlled ? controlledSort : localSort;

  const shown = useMemo(() => {
    if (controlled || !sort) return rows;
    return sortRows(rows, (row) => row.cells[sort.key]?.value ?? null, sort.direction);
  }, [rows, sort, controlled]);

  function press(key: string) {
    const next = nextSort(sort, key);
    if (!controlled) setLocalSort(next);
    onSortChange?.(next);
  }

  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must take focus so keyboard users can scroll it
    <section className={styles.scroller} aria-label={caption} tabIndex={0}>
      <table className={styles.table}>
        <caption className={showCaption ? styles.caption : "visually-hidden"}>{caption}</caption>
        <thead>
          <tr>
            {columns.map((column) => {
              const active = sort?.key === column.key;
              const className = column.numeric ? styles.numeric : undefined;
              return (
                <th
                  key={column.key}
                  scope="col"
                  className={className}
                  style={column.width ? { width: column.width } : undefined}
                  aria-sort={
                    column.sortable ? (active && sort ? sort.direction : "none") : undefined
                  }
                >
                  {column.sortable ? (
                    <button type="button" className={styles.sort} onClick={() => press(column.key)}>
                      {column.label}
                      <Icon
                        name={
                          active && sort
                            ? sort.direction === "ascending"
                              ? "sortAsc"
                              : "sortDesc"
                            : "sort"
                        }
                        size={14}
                        className={active ? styles.sortActive : styles.sortIdle}
                      />
                    </button>
                  ) : (
                    column.label
                  )}
                </th>
              );
            })}
          </tr>
        </thead>
        <tbody>
          {shown.length === 0 ? (
            <tr>
              <td colSpan={columns.length} className={styles.empty}>
                {empty ?? "Nothing to show yet."}
              </td>
            </tr>
          ) : (
            shown.map((row) => (
              <tr key={row.id}>
                {columns.map((column) => {
                  const cell = row.cells[column.key];
                  const classes = [
                    column.numeric ? styles.numeric : "",
                    column.mono ? styles.mono : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  return (
                    <td key={column.key} className={classes || undefined}>
                      {cell?.display ?? (cell?.value === null ? "" : String(cell?.value ?? ""))}
                    </td>
                  );
                })}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </section>
  );
}
