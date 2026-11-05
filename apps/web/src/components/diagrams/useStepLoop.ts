"use client";

import { type RefObject, useEffect, useRef, useState } from "react";

/**
 * Walks through `frames` on a timer while the element is on screen. The server and a reader who
 * prefers reduced motion get `initial`, the finished picture, so nothing depends on the loop.
 */
export function useStepLoop<T extends Element>(
  frames: number,
  intervalMs: number,
  initial: number,
): { ref: RefObject<T | null>; frame: number } {
  const ref = useRef<T>(null);
  const [frame, setFrame] = useState(initial);

  useEffect(() => {
    const node = ref.current;
    if (!node || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let timer: number | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting && timer === undefined) {
        timer = window.setInterval(() => setFrame((f) => (f + 1) % frames), intervalMs);
      } else if (!entry?.isIntersecting && timer !== undefined) {
        window.clearInterval(timer);
        timer = undefined;
      }
    });
    setFrame(0);
    observer.observe(node);
    return () => {
      observer.disconnect();
      if (timer !== undefined) window.clearInterval(timer);
    };
  }, [frames, intervalMs]);

  return { ref, frame };
}
