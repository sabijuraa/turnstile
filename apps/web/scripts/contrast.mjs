// Computes WCAG 2.x contrast ratios for every text and background pair the UI uses.
// Token values are read from src/styles/tokens.css so the numbers never drift from the source.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { contrastRatio, PAIRS, parseTokens } from "../src/lib/contrast.mjs";

const css = readFileSync(
  fileURLToPath(new URL("../src/styles/tokens.css", import.meta.url)),
  "utf8",
);
const tokens = parseTokens(css);
let failures = 0;
const rows = [];
for (const pair of PAIRS) {
  const fg = tokens[pair.fg];
  const bg = tokens[pair.bg];
  if (!fg || !bg) {
    console.error(`Missing token ${fg ? pair.bg : pair.fg}. Define it in tokens.css.`);
    process.exit(1);
  }
  const ratio = contrastRatio(fg, bg);
  const pass = ratio >= pair.min;
  if (!pass) failures += 1;
  rows.push(
    `| ${pair.fg} ${fg} | ${pair.bg} ${bg} | ${ratio.toFixed(2)} | ${pair.min} | ${pass ? "pass" : "FAIL"} |`,
  );
}
process.stdout.write(
  `| Foreground | Background | Ratio | Needs | Result |\n| --- | --- | --- | --- | --- |\n${rows.join("\n")}\n`,
);
if (failures > 0) {
  console.error(`${failures} pair(s) fall below their WCAG AA target.`);
  process.exit(1);
}
