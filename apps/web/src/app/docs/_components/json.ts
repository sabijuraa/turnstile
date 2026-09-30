const INLINE_LIMIT = 96;

function isPlain(value: unknown): boolean {
  return value === null || ["string", "number", "boolean"].includes(typeof value);
}

/**
 * Pretty prints JSON with two space indents. Objects and arrays whose members are all plain
 * values are kept on one line when they fit, so long series stay readable. Output is valid JSON
 * with the same content as the input.
 */
export function formatJson(value: unknown, indent = ""): string {
  if (isPlain(value)) return JSON.stringify(value);
  const inner = `${indent}  `;
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    if (value.every(isPlain)) {
      const inline = `[${value.map((v) => JSON.stringify(v)).join(", ")}]`;
      if (inline.length + indent.length <= INLINE_LIMIT) return inline;
    }
    return `[\n${value.map((v) => inner + formatJson(v, inner)).join(",\n")}\n${indent}]`;
  }
  const entries = Object.entries(value as Record<string, unknown>).filter(
    ([, v]) => v !== undefined,
  );
  if (entries.length === 0) return "{}";
  if (entries.every(([, v]) => isPlain(v))) {
    const inline = `{ ${entries.map(([k, v]) => `${JSON.stringify(k)}: ${JSON.stringify(v)}`).join(", ")} }`;
    if (inline.length + indent.length <= INLINE_LIMIT) return inline;
  }
  return `{\n${entries
    .map(([k, v]) => `${inner}${JSON.stringify(k)}: ${formatJson(v, inner)}`)
    .join(",\n")}\n${indent}}`;
}
