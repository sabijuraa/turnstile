import type { Metadata } from "next";
import { CornerShapes } from "@/components/art/scenes";
import { PageIntro } from "@/components/PageIntro";

export const metadata: Metadata = {
  title: "About Turnstile",
  description:
    "Turnstile builds payment rails that let software pay per request, inside limits its owner sets and the chain enforces.",
};

export default function Page() {
  return (
    <PageIntro eyebrow="Company" title="About Turnstile" art={<CornerShapes />}>
      Payment rails that let software pay per request, inside limits its owner sets.
    </PageIntro>
  );
}
