import type { Metadata } from "next";
import { PageIntro } from "@/components/PageIntro";
import { Closing } from "./_parts/Closing";
import { Flow } from "./_parts/Flow";
import { Model } from "./_parts/Model";
import { Policy } from "./_parts/Policy";
import { Posture } from "./_parts/Posture";
import { Records } from "./_parts/Records";

export const metadata: Metadata = {
  title: "How Turnstile works",
  description:
    "How a request, a signed payment and an on-chain receipt fit together, and how your limits keep every agent in check.",
  alternates: { canonical: "/product" },
};

export default function ProductPage() {
  return (
    <>
      <PageIntro eyebrow="Product" title="Every request carries its own payment.">
        Your agent pays for each API call the moment it makes it, in a stablecoin on Solana. The
        chain holds the money and the rules. Everything else is there for speed.
      </PageIntro>
      <Model />
      <Flow />
      <Policy />
      <Records />
      <Posture />
      <Closing />
    </>
  );
}
