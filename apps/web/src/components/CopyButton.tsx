"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./CodeBlock.module.css";
import { Icon } from "./Icon";

type CopyState = "idle" | "copied" | "failed";

/** Copies text to the clipboard and says so in the same words, for screen readers too. */
export function CopyButton({ text, label = "Copy code" }: { text: string; label?: string }) {
  const [state, setState] = useState<CopyState>("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setState("copied");
    } catch (error) {
      console.warn("Clipboard write was refused", error);
      setState("failed");
    }
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setState("idle"), 2000);
  }

  return (
    <>
      <button type="button" className={styles.copy} onClick={copy} aria-label={label}>
        <Icon name={state === "copied" ? "check" : "copy"} size={16} />
        <span aria-hidden="true">
          {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : "Copy"}
        </span>
      </button>
      <span className="visually-hidden" role="status">
        {state === "copied"
          ? "Copied"
          : state === "failed"
            ? "Copy failed. Select the code and copy it by hand."
            : ""}
      </span>
    </>
  );
}
