import type { Metadata } from "next";
import { PolicyEditor } from "./PolicyEditor";

export const metadata: Metadata = { title: "Edit policy" };

export default async function Page({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return <PolicyEditor address={address} />;
}
