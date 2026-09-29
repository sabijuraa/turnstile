import type { Metadata } from "next";
import { PageIntro } from "@/components/PageIntro";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Connect the wallet that owns your agents to open the console.",
};

export default function Page() {
  return (
    <PageIntro eyebrow="Console" title="Sign in">
      Connect the wallet that owns your agents to open the console.
    </PageIntro>
  );
}
