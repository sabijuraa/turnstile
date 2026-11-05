import type { Metadata } from "next";
import { ClosingCta } from "./_home/ClosingCta";
import { Hero } from "./_home/Hero";
import { Limits } from "./_home/Limits";
import { ReceiptSection } from "./_home/ReceiptSection";
import { Settle } from "./_home/Settle";

export const metadata: Metadata = {
  title: { absolute: "Turnstile. Let software pay for itself" },
};

export default function HomePage() {
  return (
    <>
      <Hero />
      <Settle />
      <Limits />
      <ReceiptSection />
      <ClosingCta />
    </>
  );
}
