import type { Metadata } from "next";
import { SignIn } from "./SignIn";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Connect the wallet that owns your agents to open the console.",
  robots: { index: false, follow: false },
};

export default function Page() {
  return <SignIn />;
}
