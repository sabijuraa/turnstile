// Accessibility and layout audit of the console routes, signed in as the owner the console run
// created. Run e2e/console.mjs first. It reads output/console/state.json and run.json.
//   E2E_BASE_URL=http://localhost:3300 node e2e/console-audit.mjs
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");
const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const out = fileURLToPath(new URL("./output/console/", import.meta.url));
const run = JSON.parse(readFileSync(`${out}run.json`, "utf8"));
const routes = [
  "/console",
  "/console/agents",
  "/console/agents/new",
  `/console/agents/${run.agentAddress}`,
  `/console/agents/${run.agentAddress}/policy`,
  "/console/receipts",
  "/console/settings",
];
const failures = [];
const report = { base, axe: {}, overflow: {}, cls: {}, focus: {}, console: [] };

const browser = await chromium.launch();

async function open(width, signedIn = true) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    reducedMotion: "reduce",
    storageState: signedIn ? `${out}state.json` : undefined,
  });
  await context.addInitScript(() => {
    window.__cls = 0;
    window.__shifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        window.__cls += entry.value;
        window.__shifts.push({
          value: Number(entry.value.toFixed(4)),
          at: Math.round(entry.startTime),
          nodes: (entry.sources ?? []).map((s) => {
            const n = s.node;
            if (!n?.tagName) return "text";
            return `${n.tagName.toLowerCase()}.${String(n.className).slice(0, 40)}`;
          }),
        });
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  const page = await context.newPage();
  page.on("console", (m) => {
    if (m.type() === "error" || m.type() === "warning") {
      report.console.push({ width, url: page.url(), type: m.type(), text: m.text() });
    }
  });
  page.on("pageerror", (e) => report.console.push({ width, url: page.url(), text: String(e) }));
  return { context, page };
}

async function ready(page) {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(
    () => document.querySelectorAll('[aria-busy="true"]').length === 0,
    null,
    {
      timeout: 20_000,
    },
  );
  await page.waitForTimeout(300);
}

async function audit(page, key) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  report.overflow[key] = overflow;
  if (overflow > 0) failures.push(`${key} scrolls sideways by ${overflow}px`);
  await page.addScriptTag({ path: axePath });
  const result = await page.evaluate(async () =>
    window.axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"],
      },
    }),
  );
  report.axe[key] = {
    violations: result.violations.map((v) => ({
      id: v.id,
      nodes: v.nodes.map((n) => n.target.join(" ")),
    })),
    passes: result.passes.length,
  };
  for (const v of result.violations) failures.push(`axe ${v.id} on ${key}`);
  report.cls[key] = await page.evaluate(() => window.__cls);
  report.shifts = report.shifts ?? {};
  report.shifts[key] = await page.evaluate(() => window.__shifts);
  if (report.cls[key] > 0.01) failures.push(`layout shift ${report.cls[key]} on ${key}`);
}

for (const width of [360, 1440]) {
  const { context, page } = await open(width);
  for (const route of routes) {
    await page.goto(`${base}${route}`, { waitUntil: "networkidle" });
    await ready(page);
    await audit(page, `${route}@${width}`);
  }
  await context.close();
  const signedOut = await open(width, false);
  await signedOut.page.goto(`${base}/signin`, { waitUntil: "networkidle" });
  await ready(signedOut.page);
  await audit(signedOut.page, `/signin@${width}`);
  await signedOut.context.close();
}

// Keyboard pass on each screen. Every stop must show a focus indicator.
{
  const { context, page } = await open(1440);
  for (const route of routes) {
    await page.goto(`${base}${route}`, { waitUntil: "networkidle" });
    await ready(page);
    const stops = [];
    for (let i = 0; i < 80; i += 1) {
      await page.keyboard.press("Tab");
      const info = await page.evaluate(() => {
        const el = document.activeElement;
        if (!el || el === document.body) return null;
        const visible = (node) => {
          const s = getComputedStyle(node);
          return (
            (s.outlineStyle !== "none" && Number.parseFloat(s.outlineWidth) > 0) ||
            s.boxShadow !== "none"
          );
        };
        // A visually hidden radio shows its ring on the label that wraps it.
        const shown = visible(el) || (el.closest("label") ? visible(el.closest("label")) : false);
        return {
          tag: el.tagName.toLowerCase(),
          label: (el.getAttribute("aria-label") || el.textContent || el.tagName)
            .trim()
            .slice(0, 40),
          visible: shown,
        };
      });
      if (!info) break;
      stops.push(info);
    }
    report.focus[route] = { stops: stops.length, hidden: stops.filter((s) => !s.visible) };
    if (report.focus[route].hidden.length > 0) {
      failures.push(
        `${report.focus[route].hidden.length} focus stops without a visible ring on ${route}`,
      );
    }
  }
  await context.close();
}

await browser.close();
const noisy = report.console.filter((c) => !c.text.includes("Download the React DevTools"));
if (noisy.length > 0) failures.push(`${noisy.length} console errors or warnings`);
report.failures = failures;
writeFileSync(`${out}audit.json`, `${JSON.stringify(report, null, 2)}\n`);
const axeRuns = Object.keys(report.axe).length;
console.warn(`Axe runs ${axeRuns}. Max layout shift ${Math.max(...Object.values(report.cls))}.`);
console.warn(`Focus stops ${Object.values(report.focus).reduce((n, f) => n + f.stops, 0)}.`);
if (failures.length > 0) {
  console.error(`Console audit found ${failures.length} problem(s):\n${failures.join("\n")}`);
  process.exit(1);
}
console.warn("Console audit passed with no problems.");
