import { z } from "zod";

export const rangeSchema = z.enum(["24h", "7d", "30d"], {
  error: "must be one of 24h, 7d or 30d",
});
export type Range = z.infer<typeof rangeSchema>;

export interface Window {
  range: Range;
  bucket: "hour" | "day";
  /** Start of the first bucket, inclusive. */
  from: Date;
  /** End of the last bucket, exclusive. The last bucket holds the current hour or day. */
  to: Date;
  bucketCount: number;
  stepMs: number;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

/** Buckets are aligned to whole UTC hours or UTC days so the series is stable between refreshes. */
export function windowFor(range: Range, now: Date): Window {
  const t = now.getTime();
  if (range === "24h") {
    const currentStart = Math.floor(t / HOUR) * HOUR;
    return {
      range,
      bucket: "hour",
      from: new Date(currentStart - 23 * HOUR),
      to: new Date(currentStart + HOUR),
      bucketCount: 24,
      stepMs: HOUR,
    };
  }
  const days = range === "7d" ? 7 : 30;
  const currentStart = Math.floor(t / DAY) * DAY;
  return {
    range,
    bucket: "day",
    from: new Date(currentStart - (days - 1) * DAY),
    to: new Date(currentStart + DAY),
    bucketCount: days,
    stepMs: DAY,
  };
}
