import Link from "next/link";
import { consoleLink, primaryNav, signInLink } from "@/lib/site";
import { ButtonLink } from "./Button";
import styles from "./Header.module.css";
import { MobileMenu } from "./MobileMenu";
import { NavLinks } from "./NavLinks";
import { Wordmark } from "./Wordmark";

export function Header() {
  return (
    <header className={styles.header}>
      <div className={styles.inner}>
        <Link href="/" className={styles.home} aria-label="Turnstile home">
          <Wordmark />
        </Link>
        <nav aria-label="Primary" className={styles.nav}>
          <NavLinks links={primaryNav} />
        </nav>
        <div className={styles.actions}>
          <ButtonLink href={signInLink.href} variant="quiet" size="sm">
            {signInLink.label}
          </ButtonLink>
          <ButtonLink href={consoleLink.href} size="sm">
            {consoleLink.label}
          </ButtonLink>
        </div>
        <MobileMenu links={primaryNav} signIn={signInLink} console={consoleLink} />
      </div>
    </header>
  );
}
