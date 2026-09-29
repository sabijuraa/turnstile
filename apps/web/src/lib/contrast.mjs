// WCAG 2.x relative luminance and contrast ratio for hex colors.

/** @param {string} hex */
function channels(hex) {
  const h = hex.replace("#", "");
  if (!/^[0-9a-fA-F]{6}$/.test(h)) throw new Error(`"${hex}" is not a six digit hex color`);
  return [0, 2, 4].map((i) => Number.parseInt(h.slice(i, i + 2), 16) / 255);
}

/** @param {string} hex */
export function luminance(hex) {
  const [r, g, b] = channels(hex).map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** @param {string} a @param {string} b */
export function contrastRatio(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  const [hi, lo] = la > lb ? [la, lb] : [lb, la];
  return (hi + 0.05) / (lo + 0.05);
}

/**
 * Reads `--color-name: #rrggbb;` declarations from the light theme block.
 * @param {string} css
 * @returns {Record<string, string>}
 */
export function parseTokens(css) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const m of css.matchAll(/--color-([a-z0-9-]+):\s*(#[0-9a-fA-F]{6})\s*;/g)) {
    const [, name, value] = m;
    if (name && value && !(name in out)) out[name] = value.toLowerCase();
  }
  return out;
}

/** Every text or meaningful graphic on a background the UI ships. 4.5 for text, 3 for large text and UI graphics. */
export const PAIRS = [
  { fg: "ink", bg: "paper", min: 4.5 },
  { fg: "ink", bg: "surface", min: 4.5 },
  { fg: "ink", bg: "sunken", min: 4.5 },
  { fg: "ink-muted", bg: "paper", min: 4.5 },
  { fg: "ink-muted", bg: "surface", min: 4.5 },
  { fg: "ink-muted", bg: "sunken", min: 4.5 },
  { fg: "ink-faint", bg: "paper", min: 4.5 },
  { fg: "ink-faint", bg: "surface", min: 4.5 },
  { fg: "ink-faint", bg: "sunken", min: 4.5 },
  { fg: "accent", bg: "paper", min: 4.5 },
  { fg: "accent", bg: "surface", min: 4.5 },
  { fg: "accent", bg: "accent-weak", min: 4.5 },
  { fg: "on-accent", bg: "accent", min: 4.5 },
  { fg: "on-accent", bg: "accent-strong", min: 4.5 },
  { fg: "positive", bg: "paper", min: 4.5 },
  { fg: "positive", bg: "positive-weak", min: 4.5 },
  { fg: "critical", bg: "paper", min: 4.5 },
  { fg: "critical", bg: "critical-weak", min: 4.5 },
  { fg: "caution", bg: "paper", min: 4.5 },
  { fg: "caution", bg: "caution-weak", min: 4.5 },
  { fg: "ink-muted", bg: "accent-weak", min: 4.5 },
  { fg: "ink-muted", bg: "critical-weak", min: 4.5 },
  { fg: "ink-muted", bg: "caution-weak", min: 4.5 },
  { fg: "ink-faint", bg: "accent-weak", min: 4.5 },
  { fg: "on-ink", bg: "ink", min: 4.5 },
  { fg: "on-ink-muted", bg: "ink", min: 4.5 },
  { fg: "focus", bg: "paper", min: 3 },
  { fg: "focus", bg: "surface", min: 3 },
  { fg: "control-border", bg: "surface", min: 3 },
  { fg: "accent", bg: "meter-track", min: 3 },
  { fg: "caution", bg: "meter-track", min: 3 },
  { fg: "critical", bg: "meter-track", min: 3 },
];
