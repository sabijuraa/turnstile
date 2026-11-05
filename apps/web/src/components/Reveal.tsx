"use client";

import { type ReactNode, useEffect, useRef, useState } from "react";
import styles from "./Reveal.module.css";

/**
 * Fades and lifts its children in as they scroll into view. The server renders them visible, so
 * nothing is hidden without script, and anything already on screen stays put.
 */
export function Reveal({
  children,
  className,
  stagger = false,
}: {
  children: ReactNode;
  className?: string;
  /** Delays each direct child a little after the one before. */
  stagger?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [state, setState] = useState<"idle" | "waiting" | "in">("idle");

  useEffect(() => {
    const node = ref.current;
    if (!node || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    if (node.getBoundingClientRect().top < window.innerHeight * 0.92) return;
    setState("waiting");
    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry?.isIntersecting) {
          setState("in");
          observer.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  return (
    <div
      ref={ref}
      data-state={state}
      className={[styles.reveal, stagger ? styles.stagger : "", className]
        .filter(Boolean)
        .join(" ")}
    >
      {children}
    </div>
  );
}
