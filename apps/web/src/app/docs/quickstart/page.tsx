import type { Metadata } from "next";
import { PageIntro } from "@/components/PageIntro";

export const metadata: Metadata = {
  title: "Quickstart",
  description: "Wrap an endpoint with the resource SDK and take your first paid request.",
};

export default function Page() {
  return (
    <PageIntro eyebrow="Docs" title="Quickstart">
      Wrap an endpoint with the resource SDK and take your first paid request.
    </PageIntro>
  );
}
