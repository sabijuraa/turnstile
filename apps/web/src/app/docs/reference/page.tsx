import type { Metadata } from "next";
import { PageIntro } from "@/components/PageIntro";

export const metadata: Metadata = {
  title: "API reference",
  description:
    "The facilitator interface, the SDK options and the console endpoints, with real requests and responses.",
};

export default function Page() {
  return (
    <PageIntro eyebrow="Docs" title="API reference">
      The facilitator interface, the SDK options and the console endpoints, with real requests and
      responses.
    </PageIntro>
  );
}
