import type { Metadata } from "next";
import { PageIntro } from "@/components/PageIntro";

export const metadata: Metadata = {
  title: "Live demo",
  description:
    "A real agent pays a real metered API on Solana until its daily cap refuses the next call.",
};

export default function Page() {
  return (
    <PageIntro eyebrow="Live demo" title="Live demo">
      A real agent pays a real metered API on Solana until its daily cap refuses the next call.
    </PageIntro>
  );
}
