import type { Metadata } from "next";
import { PageIntro } from "@/components/PageIntro";

export const metadata: Metadata = {
  title: "How Turnstile works",
  description:
    "How a request, a signed payment and an on-chain receipt fit together, and how your limits keep every agent in check.",
};

export default function Page() {
  return (
    <PageIntro eyebrow="Product" title="How Turnstile works">
      How a request, a signed payment and an on-chain receipt fit together, and how your limits keep
      every agent in check.
    </PageIntro>
  );
}
