import type { Metadata } from "next";
import { Suspense } from "react";
import { Receipts } from "./Receipts";

export const metadata: Metadata = { title: "Receipts" };

export default function Page() {
  return (
    <Suspense>
      <Receipts />
    </Suspense>
  );
}
