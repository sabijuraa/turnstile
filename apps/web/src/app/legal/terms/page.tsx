import type { Metadata } from "next";
import { PageIntro } from "@/components/PageIntro";

export const metadata: Metadata = {
  title: "Terms of service",
  description: "The terms that apply when you use the Turnstile console, SDKs and demo.",
};

export default function Page() {
  return (
    <PageIntro eyebrow="Legal" title="Terms of service">
      The terms that apply when you use the Turnstile console, SDKs and demo.
    </PageIntro>
  );
}
