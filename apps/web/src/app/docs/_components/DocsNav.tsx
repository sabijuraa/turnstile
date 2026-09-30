"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { Icon } from "@/components/Icon";
import styles from "./docs.module.css";
import { docsNav } from "./nav";

/**
 * The docs sidebar. On wide screens it is a sticky list. On narrow screens it collapses into a
 * disclosure that names the current page. Escape and outside clicks close it.
 */
export function DocsNav() {
  const pathname = usePathname() ?? "/docs";
  const [open, setOpen] = useState(false);
  const listId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLElement>(null);
  const current = docsNav.find((item) => item.href === pathname) ?? docsNav[0];

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) toggleRef.current?.focus();
  }, []);

  const lastPath = useRef(pathname);
  useEffect(() => {
    if (lastPath.current !== pathname) {
      lastPath.current = pathname;
      setOpen(false);
    }
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") close(true);
    };
    const onPointer = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onPointer);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onPointer);
    };
  }, [open, close]);

  return (
    <nav aria-label="Documentation" className={styles.nav} ref={rootRef}>
      <button
        ref={toggleRef}
        type="button"
        className={styles.toggle}
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
      >
        <span className={styles.toggleText}>
          <span className={`label ${styles.toggleEyebrow}`}>Docs</span>
          <span>{current?.label}</span>
        </span>
        <Icon name="chevronDown" size={18} className={styles.toggleIcon} />
        <span className="visually-hidden">{open ? "Close docs menu" : "Open docs menu"}</span>
      </button>
      <ul id={listId} className={styles.list} data-open={open ? "true" : "false"}>
        {docsNav.map((item) => {
          const active = item.href === pathname;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                className={styles.link}
                aria-current={active ? "page" : undefined}
                onClick={() => close(false)}
              >
                {item.label}
              </Link>
              {item.sections ? (
                <ul className={styles.sublist}>
                  {item.sections.map((section) => (
                    <li key={section.href}>
                      <Link
                        href={section.href}
                        className={styles.sublink}
                        onClick={() => close(false)}
                      >
                        {section.label}
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : null}
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
