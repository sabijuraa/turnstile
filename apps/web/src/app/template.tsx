import type { ReactNode } from "react";

/** Remounts on every navigation, so each page settles in with a short transition. */
export default function Template({ children }: { children: ReactNode }) {
  return <div className="page-enter">{children}</div>;
}
