import type { Metadata } from "next";
import { ClosingCta } from "./_home/ClosingCta";
import { Hero } from "./_home/Hero";
import { HomeFaq } from "./_home/HomeFaq";
import { HowItWorks } from "./_home/HowItWorks";
import { Limits } from "./_home/Limits";
import { Receipts } from "./_home/Receipts";

export const metadata: Metadata = {
  title: { absolute: "Turnstile. Let software pay for itself" },
};

export default function HomePage() {
  return (
    <>
      <Hero />
      <HowItWorks />
      <Limits />
      <Receipts />
      <HomeFaq />
      <ClosingCta />
    </>
  );
}
