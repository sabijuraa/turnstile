"use client";

import { usePathname } from "next/navigation";
import { useCallback, useEffect, useId, useRef, useState } from "react";
import type { NavLink } from "@/lib/site";
import { ButtonLink } from "./Button";
import styles from "./Header.module.css";
import { Icon } from "./Icon";
import { NavLinks } from "./NavLinks";

interface MobileMenuProps {
  links: readonly NavLink[];
  signIn: NavLink;
  console: NavLink;
}

/** Disclosure menu for narrow screens. Escape and outside clicks close it and focus returns to the toggle. */
export function MobileMenu({ links, signIn, console: consoleHref }: MobileMenuProps) {
  const [open, setOpen] = useState(false);
  const panelId = useId();
  const toggleRef = useRef<HTMLButtonElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);
  const pathname = usePathname();

  const close = useCallback((returnFocus: boolean) => {
    setOpen(false);
    if (returnFocus) toggleRef.current?.focus();
  }, []);

  // A route change always closes the menu.
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
    <div className={styles.mobile} ref={rootRef}>
      <button
        ref={toggleRef}
        type="button"
        className={styles.menuButton}
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((value) => !value)}
      >
        <Icon name={open ? "close" : "menu"} size={22} />
        <span className="visually-hidden">{open ? "Close menu" : "Open menu"}</span>
      </button>
      <div id={panelId} className={styles.panel} hidden={!open}>
        <nav aria-label="Mobile">
          <NavLinks links={links} onNavigate={() => close(false)} />
        </nav>
        <div className={styles.panelActions}>
          <ButtonLink href={signIn.href} variant="secondary" onClick={() => close(false)}>
            {signIn.label}
          </ButtonLink>
          <ButtonLink href={consoleHref.href} onClick={() => close(false)}>
            {consoleHref.label}
          </ButtonLink>
        </div>
      </div>
    </div>
  );
}
