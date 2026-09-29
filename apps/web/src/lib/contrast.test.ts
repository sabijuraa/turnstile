import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { contrastRatio, PAIRS, parseTokens } from "./contrast.mjs";

const css = readFileSync(fileURLToPath(new URL("../styles/tokens.css", import.meta.url)), "utf8");
const tokens = parseTokens(css);

describe("contrast math", () => {
  it("matches the WCAG reference values", () => {
    expect(contrastRatio("#000000", "#ffffff")).toBeCloseTo(21, 5);
    expect(contrastRatio("#767676", "#ffffff")).toBeCloseTo(4.54, 2);
  });
});

describe("design tokens", () => {
  it.each(PAIRS)("$fg on $bg meets $min", ({ fg, bg, min }) => {
    const a = tokens[fg];
    const b = tokens[bg];
    expect(a, `token --color-${fg}`).toBeDefined();
    expect(b, `token --color-${bg}`).toBeDefined();
    expect(contrastRatio(a as string, b as string)).toBeGreaterThanOrEqual(min);
  });
});
