import type { Metadata } from "next";
import { PageIntro } from "@/components/PageIntro";
import { Boundaries } from "./_parts/Boundaries";
import { Closing } from "./_parts/Closing";
import { Guarantee } from "./_parts/Guarantee";
import { Keys } from "./_parts/Keys";
import styles from "./_parts/security.module.css";
import { Threats } from "./_parts/Threats";

export const metadata: Metadata = {
  title: "Security",
  description:
    "What the chain enforces, what each part of the system can and cannot do, and how keys are handled and rotated.",
  alternates: { canonical: "/security" },
};

const sections = [
  { href: "#boundaries", label: "Trust boundaries" },
  { href: "#threats", label: "Threat model" },
  { href: "#guarantee", label: "The guarantee" },
  { href: "#keys", label: "Keys" },
] as const;

export default function SecurityPage() {
  return (
    <>
      <PageIntro
        eyebrow="Security"
        title="What protects your money, and where that ends."
        actions={
          <nav aria-label="On this page" className={styles.jump}>
            {sections.map((section) => (
              <a key={section.href} href={section.href}>
                {section.label}
              </a>
            ))}
          </nav>
        }
      >
        Turnstile puts your spending rules where no single service can change them. This page shows
        what each part can do, what the chain guarantees and what it does not.
      </PageIntro>
      <Boundaries />
      <Threats />
      <Guarantee />
      <Keys />
      <Closing />
    </>
  );
}
