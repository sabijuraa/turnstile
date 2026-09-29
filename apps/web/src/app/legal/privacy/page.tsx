import type { Metadata } from "next";
import { PageIntro } from "@/components/PageIntro";

export const metadata: Metadata = {
  title: "Privacy policy",
  description:
    "What Turnstile collects when you use the console and the site, and what it does with it.",
};

export default function Page() {
  return (
    <PageIntro eyebrow="Legal" title="Privacy policy">
      What Turnstile collects when you use the console and the site, and what it does with it.
    </PageIntro>
  );
}
