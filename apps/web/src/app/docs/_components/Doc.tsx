import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { ReactNode } from "react";
import { CodeBlock } from "@/components/CodeBlock";
import { Icon } from "@/components/Icon";
import { Table } from "@/components/Table";
import styles from "./docs.module.css";
import { formatJson } from "./json";

/** Opens a docs page with an eyebrow, the one h1 and a short lead. */
export function DocHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <header className={styles.header}>
      <p className={`label ${styles.eyebrow}`}>{eyebrow}</p>
      <h1 className={styles.title}>{title}</h1>
      <p className={styles.lead}>{children}</p>
    </header>
  );
}

/** A top level section of a docs page with its h2. The id is the anchor. */
export function DocSection({
  id,
  title,
  children,
}: {
  id: string;
  title: string;
  children: ReactNode;
}) {
  return (
    <section id={id} aria-labelledby={`${id}-title`} className={styles.section}>
      <h2 id={`${id}-title`} className={styles.h2}>
        {title}
      </h2>
      {children}
    </section>
  );
}

/** An h3 inside a section, with its own anchor. */
export function DocSubhead({ id, children }: { id?: string; children: ReactNode }) {
  return (
    <h3 id={id} className={styles.h3}>
      {children}
    </h3>
  );
}

/** Prose wrapper that keeps paragraphs and lists on the reading measure. */
export function Prose({ children }: { children: ReactNode }) {
  return <div className={styles.prose}>{children}</div>;
}

/** A short aside. Tone `info` for context, `caution` for something that bites. */
export function Note({
  tone = "info",
  children,
}: {
  tone?: "info" | "caution";
  children: ReactNode;
}) {
  return (
    <aside className={`${styles.note} ${tone === "caution" ? styles.caution : ""}`}>
      <Icon name={tone === "caution" ? "alert" : "info"} size={18} className={styles.noteIcon} />
      <div>{children}</div>
    </aside>
  );
}

const samplesDir = (() => {
  const local = join(process.cwd(), "src/app/docs/_samples");
  return existsSync(local) ? local : join(process.cwd(), "apps/web/src/app/docs/_samples");
})();

/**
 * Renders a typechecked sample from `_samples`. The file is read at build time, so the page
 * shows exactly the code that compiled.
 */
export function Sample({
  file,
  name,
  highlight,
}: {
  file: string;
  /** File name shown in the header. Defaults to the sample's own name. */
  name?: string;
  highlight?: readonly number[];
}) {
  const code = readFileSync(join(samplesDir, file), "utf8");
  return (
    <div className={styles.block}>
      <CodeBlock code={code} language="TypeScript" filename={name ?? file} highlight={highlight} />
    </div>
  );
}

/** A JSON value from a captured fixture, formatted for reading. */
export function JsonBlock({ value, name }: { value: unknown; name?: string }) {
  return (
    <div className={styles.block}>
      <CodeBlock code={formatJson(value)} language="JSON" filename={name} />
    </div>
  );
}

/** Any other code: shell commands, HTTP exchanges, CSV. */
export function Code({ code, language, name }: { code: string; language: string; name?: string }) {
  return (
    <div className={styles.block}>
      <CodeBlock code={code} language={language} filename={name} />
    </div>
  );
}

export interface FieldRow {
  name: string;
  type?: string;
  detail: ReactNode;
}

/** A reference table of names, types and what they do. */
export function FieldTable({
  caption,
  rows,
  nameLabel = "Name",
  typeLabel = "Type",
}: {
  caption: string;
  rows: readonly FieldRow[];
  nameLabel?: string;
  typeLabel?: string;
}) {
  const hasType = rows.some((row) => row.type !== undefined);
  const columns = [
    { key: "name", label: nameLabel, mono: true, width: "30%" },
    ...(hasType ? [{ key: "type", label: typeLabel, mono: true }] : []),
    { key: "detail", label: "Meaning" },
  ];
  return (
    <div className={styles.block}>
      <Table
        caption={caption}
        columns={columns}
        rows={rows.map((row) => ({
          id: row.name,
          cells: {
            name: { value: row.name },
            type: { value: row.type ?? "" },
            detail: { value: null, display: row.detail },
          },
        }))}
      />
    </div>
  );
}
