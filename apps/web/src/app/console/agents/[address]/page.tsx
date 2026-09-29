import type { Metadata } from "next";
import { AgentDetail } from "./AgentDetail";

export const metadata: Metadata = { title: "Agent" };

export default async function Page({ params }: { params: Promise<{ address: string }> }) {
  const { address } = await params;
  return <AgentDetail address={address} />;
}
