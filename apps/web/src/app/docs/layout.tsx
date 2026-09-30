import type { ReactNode } from "react";
import { DocsNav } from "./_components/DocsNav";
import styles from "./_components/docs.module.css";

export default function DocsLayout({ children }: { children: ReactNode }) {
  return (
    <div className={styles.shell}>
      <DocsNav />
      <div className={styles.content}>{children}</div>
    </div>
  );
}
