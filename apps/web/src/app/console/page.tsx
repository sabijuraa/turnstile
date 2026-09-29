import type { Metadata } from "next";
import { PageIntro } from "@/components/PageIntro";

export const metadata: Metadata = {
  title: "Console",
  description: "Create agent wallets, set their limits and watch every paid request settle.",
};

export default function Page() {
  return (
    <PageIntro eyebrow="Console" title="Console">
      Create agent wallets, set their limits and watch every paid request settle.
    </PageIntro>
  );
}
