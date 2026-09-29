import type { Metadata } from "next";
import { PageIntro } from "@/components/PageIntro";

export const metadata: Metadata = {
  title: "Security",
  description:
    "What the chain enforces, what each part of the system can and cannot do, and how keys are handled and rotated.",
};

export default function Page() {
  return (
    <PageIntro eyebrow="Security" title="Security">
      What the chain enforces, what each part of the system can and cannot do, and how keys are
      handled and rotated.
    </PageIntro>
  );
}
