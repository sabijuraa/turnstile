import type { Metadata } from "next";
import { Audiences } from "./_home/Audiences";
import { ClosingCta } from "./_home/ClosingCta";
import { Control } from "./_home/Control";
import { DemoTeaser } from "./_home/DemoTeaser";
import { Hero } from "./_home/Hero";
import { HowItWorks } from "./_home/HowItWorks";
import { Problem } from "./_home/Problem";
import { Proof } from "./_home/Proof";

export const metadata: Metadata = {
  title: { absolute: "Turnstile. Let software pay for itself" },
};

export default function HomePage() {
  return (
    <>
      <Hero />
      <Problem />
      <HowItWorks />
      <Control />
      <Proof />
      <Audiences />
      <DemoTeaser />
      <ClosingCta />
    </>
  );
}
