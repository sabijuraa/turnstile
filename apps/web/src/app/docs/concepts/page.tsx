import type { Metadata } from "next";
import { PageIntro } from "@/components/PageIntro";

export const metadata: Metadata = {
  title: "Concepts",
  description:
    "Agent wallets, session keys, policies, the facilitator and receipts, explained one at a time.",
};

export default function Page() {
  return (
    <PageIntro eyebrow="Docs" title="Concepts">
      Agent wallets, session keys, policies, the facilitator and receipts, explained one at a time.
    </PageIntro>
  );
}
