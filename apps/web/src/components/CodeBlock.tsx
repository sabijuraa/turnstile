import styles from "./CodeBlock.module.css";
import { CopyButton } from "./CopyButton";

export interface CodeBlockProps {
  code: string;
  /** Language name shown in the header, for example "TypeScript" or "Shell". */
  language: string;
  /** Optional file name shown instead of the language. */
  filename?: string;
  /** Lines to emphasise, one based. */
  highlight?: readonly number[];
}

/** Code with a header and a copy button. Server rendered. Only the button hydrates. */
export function CodeBlock({ code, language, filename, highlight = [] }: CodeBlockProps) {
  const marked = new Set(highlight);
  const lines = code.replace(/\n$/, "").split("\n");
  return (
    <div className={styles.block}>
      <div className={styles.head}>
        <span className={styles.name}>{filename ?? language}</span>
        <CopyButton text={code} label={`Copy ${filename ?? language} code`} />
      </div>
      {/* biome-ignore lint/a11y/noNoninteractiveTabindex: a scrollable region must take focus so keyboard users can scroll it */}
      <pre className={styles.pre} tabIndex={0}>
        <code>
          {lines.map((line, index) => (
            <span
              // Lines are positional and never reorder.
              // biome-ignore lint/suspicious/noArrayIndexKey: line numbers are the identity here
              key={index}
              className={marked.has(index + 1) ? `${styles.line} ${styles.marked}` : styles.line}
            >
              {line}
              {"\n"}
            </span>
          ))}
        </code>
      </pre>
    </div>
  );
}
