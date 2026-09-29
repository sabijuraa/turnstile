import type { Metadata } from "next";
import { PageIntro } from "@/components/PageIntro";

export const metadata: Metadata = {
  title: "Agent quickstart",
  description: "Create an agent wallet, set its policy and let the agent pay a 402 on its own.",
};

export default function Page() {
  return (
    <PageIntro eyebrow="Docs" title="Agent quickstart">
      Create an agent wallet, set its policy and let the agent pay a 402 on its own.
    </PageIntro>
  );
}
