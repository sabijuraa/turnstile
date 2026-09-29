"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { isActivePath, type NavLink } from "@/lib/site";
import styles from "./Header.module.css";

export function NavLinks({
  links,
  onNavigate,
}: {
  links: readonly NavLink[];
  onNavigate?: () => void;
}) {
  const pathname = usePathname() ?? "/";
  return (
    <ul className={styles.navList}>
      {links.map((link) => {
        const active = isActivePath(pathname, link.href);
        return (
          <li key={link.href}>
            <Link
              href={link.href}
              className={styles.navLink}
              aria-current={active ? "page" : undefined}
              onClick={onNavigate}
            >
              {link.label}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
