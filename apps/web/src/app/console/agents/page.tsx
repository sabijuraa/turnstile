import type { Metadata } from "next";
import { AgentsList } from "./AgentsList";

export const metadata: Metadata = { title: "Agents" };

export default function Page() {
  return <AgentsList />;
}
