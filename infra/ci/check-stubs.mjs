// Fails the build if shipped source contains stub markers.
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("../..", import.meta.url).pathname;
const scanDirs = ["programs", "packages", "apps", "infra", ".github"];
const skip = new Set(["node_modules", "target", "dist", ".next", "coverage", "idl", "results"]);
const exts = [
  ".rs",
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".css",
  ".sql",
  ".sh",
  ".yml",
  ".yaml",
  ".toml",
  "Dockerfile",
];
// This file lists the markers, so it would always match itself.
const self = new URL(import.meta.url).pathname;
const markers = [
  /\bTODO\b/,
  /\bFIXME\b/,
  /\bXXX\b/,
  /\btodo!\(/,
  /\bunimplemented!\(/,
  /not implemented/i,
  /\bplaceholder data\b/i,
  /lorem ipsum/i,
];

const hits = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (skip.has(name) || name.startsWith(".next-")) continue;
    const full = join(dir, name);
    const st = statSync(full);
    if (st.isDirectory()) walk(full);
    else if (full !== self && exts.some((e) => name.endsWith(e))) {
      const lines = readFileSync(full, "utf8").split("\n");
      lines.forEach((line, i) => {
        if (markers.some((m) => m.test(line)))
          hits.push(`${relative(root, full)}:${i + 1}: ${line.trim()}`);
      });
    }
  }
}
for (const d of scanDirs) {
  try {
    walk(join(root, d));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
  }
}
if (hits.length > 0) {
  console.error(`Found ${hits.length} stub marker(s):\n${hits.join("\n")}`);
  process.exit(1);
}
console.warn("No stub markers found.");
