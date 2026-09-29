import type { Metadata } from "next";
import { PageIntro } from "@/components/PageIntro";

export const metadata: Metadata = {
  title: "Pricing",
  description:
    "How Turnstile charges, what the fee covers and answers to the questions people ask before they start.",
};

export default function Page() {
  return (
    <PageIntro eyebrow="Pricing" title="Pricing">
      How Turnstile charges, what the fee covers and answers to the questions people ask before they
      start.
    </PageIntro>
  );
}
