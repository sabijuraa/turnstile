import Link from "next/link";
import { footerColumns } from "@/lib/site";
import styles from "./Footer.module.css";
import { Wordmark } from "./Wordmark";

export function Footer() {
  return (
    <footer className={styles.footer}>
      <div className={styles.inner}>
        <div className={styles.about}>
          <Link href="/" className={styles.home} aria-label="Turnstile home">
            <Wordmark />
          </Link>
          <p className={styles.line}>
            Turnstile lets software pay per request in a stablecoin, inside limits its owner sets
            once. Built on the x402 standard.
          </p>
          <p className={styles.network}>
            <span className={styles.dot} aria-hidden="true" />
            Settles on Solana
          </p>
        </div>
        <div className={styles.columns}>
          {footerColumns.map((column) => (
            <nav key={column.title} aria-labelledby={`footer-${column.title}`}>
              <h2 id={`footer-${column.title}`} className={`label ${styles.title}`}>
                {column.title}
              </h2>
              <ul className={styles.list}>
                {column.links.map((link) => (
                  <li key={link.href}>
                    <Link href={link.href} className={styles.link}>
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </nav>
          ))}
        </div>
      </div>
      <div className={styles.base}>
        <p>Turnstile. Pay-per-request rails for AI agents.</p>
        <p>Every payment leaves a receipt on chain.</p>
      </div>
    </footer>
  );
}
