"use client";

import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Table } from "@/components/Table";
import type { SpendSeries } from "@/lib/console/types";
import { amountText } from "./format";
import styles from "./SpendChart.module.css";

const HEIGHT = 232;
const PAD = { top: 12, right: 8, bottom: 28, left: 56 };
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function bucketLabel(iso: string, bucket: SpendSeries["bucket"]): string {
  const d = new Date(iso);
  if (bucket === "hour") return `${String(d.getUTCHours()).padStart(2, "0")}:00`;
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
}

function bucketLong(iso: string, bucket: SpendSeries["bucket"]): string {
  const d = new Date(iso);
  const day = `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
  if (bucket === "day") return `${day}, UTC day`;
  const h = d.getUTCHours();
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${day}, ${pad(h)}:00 to ${pad((h + 1) % 24)}:00 UTC`;
}

/** A clean tick step for a maximum value, 1, 2 or 5 times a power of ten. */
function niceStep(max: number, count: number): number {
  const raw = max / count;
  const power = 10 ** Math.floor(Math.log10(raw));
  const unit = raw / power;
  const nice = unit <= 1 ? 1 : unit <= 2 ? 2 : unit <= 5 ? 5 : 10;
  return nice * power;
}

function tickText(value: number, step: number): string {
  const decimals = Math.max(0, Math.min(6, -Math.floor(Math.log10(step))));
  return amountText(value.toFixed(decimals));
}

/** Spend per hour or per day as columns on one baseline. Hover or arrow keys show the exact value. */
export function SpendChart({
  series,
  asset,
  refreshing = false,
}: {
  series: SpendSeries;
  asset: string;
  refreshing?: boolean;
}) {
  const box = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const [active, setActive] = useState<number | null>(null);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(Math.floor(entry.contentRect.width));
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  const points = series.series;
  const values = useMemo(() => points.map((p) => Number(p.displayAmount)), [points]);
  const max = Math.max(...values, 0);
  const step = max > 0 ? niceStep(max, 4) : 1;
  const top = max > 0 ? Math.ceil(max / step) * step : 4;
  const ticks = Array.from({ length: Math.round(top / step) + 1 }, (_, i) => i * step);

  const plotW = Math.max(0, width - PAD.left - PAD.right);
  const plotH = HEIGHT - PAD.top - PAD.bottom;
  const band = points.length > 0 ? plotW / points.length : 0;
  const barW = Math.max(2, Math.min(24, band - 2));
  const y = (v: number) => PAD.top + plotH - (v / top) * plotH;
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(1, Math.floor(plotW / 64))));

  function onKey(event: KeyboardEvent<SVGSVGElement>) {
    if (points.length === 0) return;
    const current = active ?? points.length - 1;
    let next: number | null = null;
    if (event.key === "ArrowRight") next = Math.min(points.length - 1, current + 1);
    if (event.key === "ArrowLeft") next = Math.max(0, current - 1);
    if (event.key === "Home") next = 0;
    if (event.key === "End") next = points.length - 1;
    if (event.key === "Escape") {
      setActive(null);
      return;
    }
    if (next !== null) {
      event.preventDefault();
      setActive(next);
    }
  }

  const shown = active !== null ? points[active] : undefined;
  const tipLeft =
    active !== null ? Math.min(Math.max(PAD.left + band * (active + 0.5), 80), width - 80) : 0;
  const unitWord = series.bucket === "hour" ? "hour" : "day";

  return (
    <div className={`${styles.wrap} ${refreshing ? styles.refreshing : ""}`}>
      <div ref={box} className={styles.plot} style={{ height: HEIGHT }}>
        {width > 0 ? (
          <svg
            width={width}
            height={HEIGHT}
            role="img"
            aria-label={`Spend per ${unitWord}, ${series.totals.displayAmount} ${asset} in total. Use the left and right arrow keys to read each ${unitWord}.`}
            // biome-ignore lint/a11y/noNoninteractiveTabindex: the chart takes focus so arrow keys can read each column
            tabIndex={0}
            onKeyDown={onKey}
            onBlur={() => setActive(null)}
            onPointerLeave={() => setActive(null)}
            className={styles.svg}
          >
            {ticks.map((t) => (
              <g key={t}>
                <line
                  x1={PAD.left}
                  x2={width - PAD.right}
                  y1={y(t)}
                  y2={y(t)}
                  className={t === 0 ? styles.baseline : styles.grid}
                />
                <text
                  x={PAD.left - 8}
                  y={y(t)}
                  dy="0.32em"
                  textAnchor="end"
                  className={styles.tick}
                >
                  {tickText(t, step)}
                </text>
              </g>
            ))}
            {points.map((p, i) => {
              const v = values[i] ?? 0;
              const x = PAD.left + band * i + (band - barW) / 2;
              const h = Math.max(0, y(0) - y(v));
              const r = Math.min(4, barW / 2, h);
              const top0 = y(0) - h;
              return (
                <g key={p.start}>
                  {h > 0 ? (
                    <path
                      d={`M${x},${y(0)} V${top0 + r} Q${x},${top0} ${x + r},${top0} H${x + barW - r} Q${x + barW},${top0} ${x + barW},${top0 + r} V${y(0)} Z`}
                      className={active === i ? styles.barActive : styles.bar}
                    />
                  ) : null}
                  {i % labelEvery === 0 ? (
                    <text
                      x={PAD.left + band * (i + 0.5)}
                      y={HEIGHT - 8}
                      textAnchor="middle"
                      className={styles.tick}
                    >
                      {bucketLabel(p.start, series.bucket)}
                    </text>
                  ) : null}
                  <rect
                    x={PAD.left + band * i}
                    y={PAD.top}
                    width={band}
                    height={plotH}
                    fill="transparent"
                    onPointerEnter={() => setActive(i)}
                    onPointerDown={() => setActive(i)}
                  />
                </g>
              );
            })}
            {active !== null ? (
              <line
                x1={PAD.left + band * (active + 0.5)}
                x2={PAD.left + band * (active + 0.5)}
                y1={PAD.top}
                y2={y(0)}
                className={styles.crosshair}
              />
            ) : null}
          </svg>
        ) : null}
        {shown ? (
          <div className={styles.tip} style={{ left: tipLeft }} aria-hidden="true">
            <span className={styles.tipValue}>
              {amountText(shown.displayAmount)} {asset}
            </span>
            <span className={styles.tipLabel}>
              {shown.count} {shown.count === 1 ? "settlement" : "settlements"}
            </span>
            <span className={styles.tipLabel}>{bucketLong(shown.start, series.bucket)}</span>
          </div>
        ) : null}
        <p className="visually-hidden" aria-live="polite">
          {shown
            ? `${bucketLong(shown.start, series.bucket)}. ${shown.displayAmount} ${asset}, ${shown.count} settlements.`
            : ""}
        </p>
      </div>
      <details className={styles.details}>
        <summary className={styles.summary}>Show the numbers as a table</summary>
        <Table
          caption={`Spend per ${unitWord}`}
          columns={[
            { key: "start", label: unitWord === "hour" ? "Hour" : "Day", sortable: true },
            { key: "count", label: "Settlements", numeric: true, sortable: true },
            { key: "amount", label: `Spend, ${asset}`, numeric: true, sortable: true },
          ]}
          rows={points.map((p) => ({
            id: p.start,
            cells: {
              start: { value: p.start, display: bucketLong(p.start, series.bucket) },
              count: { value: p.count },
              amount: { value: BigInt(p.amount), display: amountText(p.displayAmount) },
            },
          }))}
          initialSort={{ key: "start", direction: "descending" }}
        />
      </details>
    </div>
  );
}
