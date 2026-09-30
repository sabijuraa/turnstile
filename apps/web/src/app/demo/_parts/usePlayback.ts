"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { isCallEvent, type RunEvent } from "../_lib/events";

/** One call on the gate. Matches the --cycle the demo sets on the gate. */
export const CALL_DWELL_MS = 2400;
/** When the receipt lands in the gate. The gate's land keyframe finishes at 70 percent. */
export const CALL_LAND_MS = Math.round(CALL_DWELL_MS * 0.7);

const REDUCED = "(prefers-reduced-motion: reduce)";

function subscribeReduced(onChange: () => void): () => void {
  const query = window.matchMedia(REDUCED);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

export function usePrefersReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReduced,
    () => window.matchMedia(REDUCED).matches,
    () => false,
  );
}

export interface Playback {
  /** Events whose call is on the gate or already done. */
  revealed: number;
  /** Events applied to the receipts, the meter and the detail panel. */
  committed: number;
}

/**
 * Paces live events so each call can be read. A local run settles a call every few hundred
 * milliseconds, faster than the gate can show it. Each call gets the gate for one cycle. Its
 * receipt lands in the list when it lands in the gate. Events at or below `instantUntil`, which
 * came from history, and every event under reduced motion apply at once.
 */
export function usePlayback(
  events: readonly RunEvent[],
  instantUntil: number,
  reduced: boolean,
): Playback {
  const [state, setState] = useState<Playback>(() => ({
    revealed: events.length,
    committed: events.length,
  }));
  const lastCallAt = useRef(0);
  const { revealed, committed } = state;
  const total = events.length;

  // A new run replaces the list. Start again from its first event.
  const firstKey = events[0] ? `${events[0].runId}` : "";
  const [runKey, setRunKey] = useState(firstKey);
  if (runKey !== firstKey) {
    setRunKey(firstKey);
    setState({ revealed: 0, committed: 0 });
  }

  useEffect(() => {
    if (revealed > total || committed > total) {
      setState({ revealed: total, committed: total });
      return;
    }
    const now = performance.now();
    if (committed < revealed) {
      const wait = reduced ? 0 : Math.max(0, lastCallAt.current + CALL_LAND_MS - now);
      const timer = window.setTimeout(
        () => setState((s) => ({ ...s, committed: s.revealed })),
        wait,
      );
      return () => window.clearTimeout(timer);
    }
    if (revealed >= total) return;
    const next = events[revealed];
    if (!next) return;
    const instant = reduced || next.seq <= instantUntil;
    if (instant) {
      // Apply every instant event in one step.
      let end = revealed;
      while (end < total) {
        const e = events[end];
        if (!e || !(reduced || e.seq <= instantUntil)) break;
        end += 1;
      }
      setState({ revealed: end, committed: end });
      return;
    }
    const previous = events[revealed - 1];
    const wait =
      previous && isCallEvent(previous) && previous.seq > instantUntil
        ? Math.max(0, lastCallAt.current + CALL_DWELL_MS - now)
        : 0;
    const timer = window.setTimeout(() => {
      if (isCallEvent(next)) {
        lastCallAt.current = performance.now();
        setState({ revealed: revealed + 1, committed });
      } else {
        setState({ revealed: revealed + 1, committed: revealed + 1 });
      }
    }, wait);
    return () => window.clearTimeout(timer);
  }, [events, instantUntil, reduced, revealed, committed, total]);

  return { revealed: Math.min(revealed, total), committed: Math.min(committed, total) };
}
