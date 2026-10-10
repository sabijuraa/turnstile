/**
 * Lighthouse over every route, mobile emulation, against a running production
 * server (NFR8). Fails when any route scores under the budget on performance,
 * accessibility or best practices.
 *
 *   pnpm --filter @turnstile/web build && pnpm --filter @turnstile/web start
 *   node scripts/lighthouse.mjs
 *
 * BASE_URL points it elsewhere, LH_BUDGET changes the 0 to 100 budget and
 * LH_ROUTES limits the run to a comma separated subset. Results land in
 * output/lighthouse.json. Uses the Playwright Chromium, so no system Chrome
 * is needed.
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import lighthouse from "lighthouse";
import { chromium } from "playwright";

const baseUrl = (process.env.BASE_URL ?? "http://localhost:3000").replace(/\/+$/, "");
const budget = Number(process.env.LH_BUDGET ?? 90);
const webRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

// Every route that renders without route parameters. The agent detail and the
// policy editor need an on-chain address, so the console browser audit covers
// them instead (e2e/console.mjs).
const allRoutes = [
  "/",
  "/product",
  "/solutions",
  "/pricing",
  "/security",
  "/about",
  "/signin",
  "/demo",
  "/docs",
  "/docs/quickstart",
  "/docs/agent-quickstart",
  "/docs/concepts",
  "/docs/reference",
  "/legal/privacy",
  "/legal/terms",
  "/console",
  "/console/agents",
  "/console/agents/new",
  "/console/receipts",
  "/console/settings",
];
const routes = process.env.LH_ROUTES
  ? process.env.LH_ROUTES.split(",").map((r) => r.trim())
  : allRoutes;

const categories = ["performance", "accessibility", "best-practices"];

// Lighthouse drives the browser over the DevTools protocol, so launch the
// Playwright Chromium with a known debugging port instead of chrome-launcher.
const port = 9333;
const browser = await chromium.launch({
  args: [`--remote-debugging-port=${port}`, "--no-first-run"],
});

const results = [];
let failed = false;
try {
  for (const route of routes) {
    const url = `${baseUrl}${route}`;
    const run = await lighthouse(url, {
      port,
      output: "json",
      logLevel: "error",
      onlyCategories: categories,
      // Mobile emulation and simulated mid tier throttling are the defaults.
    });
    if (!run?.lhr) throw new Error(`Lighthouse returned nothing for ${url}`);
    const scores = Object.fromEntries(
      categories.map((c) => [c, Math.round((run.lhr.categories[c]?.score ?? 0) * 100)]),
    );
    const below = categories.filter((c) => scores[c] < budget);
    if (below.length > 0) failed = true;
    results.push({ route, scores, below });
    const mark = below.length > 0 ? "FAIL" : "ok  ";
    process.stdout.write(
      `${mark} ${route.padEnd(24)} perf ${String(scores.performance).padStart(3)}  a11y ${String(
        scores.accessibility,
      ).padStart(3)}  bp ${String(scores["best-practices"]).padStart(3)}\n`,
    );
  }
} finally {
  await browser.close();
}

const outDir = join(webRoot, "output");
mkdirSync(outDir, { recursive: true });
const summary = {
  measuredAt: new Date().toISOString(),
  requirement: `NFR8 Lighthouse mobile performance, accessibility and best practices at ${budget} or above`,
  baseUrl,
  formFactor: "mobile, simulated throttling, Lighthouse defaults",
  budget,
  routes: results,
};
writeFileSync(join(outDir, "lighthouse.json"), `${JSON.stringify(summary, null, 2)}\n`);
process.stdout.write(`\nwrote output/lighthouse.json for ${results.length} routes\n`);

if (failed) {
  console.error(`\nRoutes under the budget of ${budget}:`);
  for (const r of results.filter((r) => r.below.length > 0)) {
    console.error(`  ${r.route} is below on ${r.below.join(", ")}`);
  }
  process.exit(1);
}
process.stdout.write(`every route is at ${budget} or above on ${categories.join(", ")}\n`);
