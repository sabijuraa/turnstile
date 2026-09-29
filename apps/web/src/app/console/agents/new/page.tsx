import type { Metadata } from "next";
import { CreateAgent } from "./CreateAgent";

export const metadata: Metadata = { title: "Create agent" };

export default function Page() {
  return <CreateAgent />;
}
