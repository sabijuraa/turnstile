import type { Metadata } from "next";
import { PageIntro } from "@/components/PageIntro";

export const metadata: Metadata = {
  title: "What you can build",
  description:
    "Metered APIs, paid data feeds, agent to agent services and pay-per-use compute, each with a note on how you would build it.",
};

export default function Page() {
  return (
    <PageIntro eyebrow="Solutions" title="What you can build">
      Metered APIs, paid data feeds, agent to agent services and pay-per-use compute, each with a
      note on how you would build it.
    </PageIntro>
  );
}
