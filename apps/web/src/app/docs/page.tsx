import type { Metadata } from "next";
import { PageIntro } from "@/components/PageIntro";

export const metadata: Metadata = {
  title: "Documentation",
  description:
    "Quickstarts, concepts and reference for taking payments with the resource SDK and paying with the agent SDK.",
};

export default function Page() {
  return (
    <PageIntro eyebrow="Docs" title="Documentation">
      Quickstarts, concepts and reference for taking payments with the resource SDK and paying with
      the agent SDK.
    </PageIntro>
  );
}
