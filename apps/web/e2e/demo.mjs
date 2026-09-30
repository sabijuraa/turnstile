// Browser check of the live demo against a running stack. The web app needs
// TURNSTILE_DEMO_AGENT_URL pointing at a demo agent that can settle real payments.
//   E2E_BASE_URL=http://localhost:3400 node e2e/demo.mjs
// It screenshots /demo idle, mid run and refused at 360 and 1440 wide, runs axe in each state,
// checks sideways scroll, console errors, layout shift during a run, keyboard focus, the busy
// path when another run holds the lock, and reduced motion. It records the real receipts and the
// refused transaction it saw.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");
const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const out = fileURLToPath(new URL("./output/", import.meta.url));
mkdirSync(out, { recursive: true });

const RUN_TIMEOUT = 120_000;
const failures = [];
const report = { base, runs: [], axe: {}, overflow: {}, cls: {}, console: [], focus: {}, busy: {} };
const browser = await chromium.launch();

async function openPage(width, reducedMotion = "no-preference") {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion,
  });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      report.console.push({ width, type: message.type(), text: message.text() });
    }
  });
  page.on("pageerror", (error) =>
    report.console.push({ width, type: "pageerror", text: String(error) }),
  );
  await page.addInitScript(() => {
    window.__cls = 0;
    window.__shifts = [];
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.hadRecentInput) continue;
        window.__cls += entry.value;
        window.__shifts.push({
          value: entry.value,
          sources: entry.sources.map((s) => {
            const n = s.node;
            return n instanceof Element
              ? `${n.tagName}.${n.className}`.slice(0, 80)
              : String(n?.nodeName);
          }),
        });
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  return { context, page };
}

async function audit(page, name) {
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
  );
  report.overflow[name] = overflow;
  if (overflow > 0) failures.push(`${name} scrolls sideways by ${overflow}px`);
  await page.addScriptTag({ path: axePath });
  const result = await page.evaluate(async () =>
    window.axe.run(document, {
      runOnly: {
        type: "tag",
        values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"],
      },
    }),
  );
  report.axe[name] = result.violations.map((v) => ({
    id: v.id,
    nodes: v.nodes.map((n) => n.target.join(" ")),
  }));
  for (const v of result.violations) failures.push(`axe ${v.id} on ${name}`);
}

async function waitIdle(page) {
  await page.getByRole("button", { name: "Run the agent" }).waitFor({ timeout: RUN_TIMEOUT });
}

async function runOnce(width) {
  const { context, page } = await openPage(width);
  await page.goto(`${base}/demo`, { waitUntil: "networkidle" });
  await waitIdle(page);
  await page.screenshot({ path: `${out}demo-${width}-idle.png`, fullPage: true });
  await audit(page, `idle@${width}`);
  await page.evaluate(() => {
    window.__cls = 0;
    window.__shifts = [];
  });

  // Start from the keyboard, the way a keyboard user would.
  await page.getByRole("button", { name: "Run the agent" }).focus();
  await page.keyboard.press("Enter");
  const status = page.getByRole("status").filter({ hasText: /Agent running|Watching live/ });
  await status.waitFor({ timeout: 15_000 });
  const statusFocused = await page.evaluate(() => {
    const el = document.activeElement;
    return el?.getAttribute("role") === "status"
      ? (el.textContent ?? "").trim()
      : `not the status (${el?.tagName})`;
  });
  report.focus[`start@${width}`] = statusFocused;
  if (!/Agent running/.test(statusFocused))
    failures.push(`focus did not move to the run status at ${width}px`);

  // Mid run: the third receipt has landed.
  await page
    .locator("ol[aria-label='Receipts from this run'] > li")
    .nth(2)
    .waitFor({ timeout: RUN_TIMEOUT });
  await page.screenshot({ path: `${out}demo-${width}-mid-run.png`, fullPage: false });
  await page
    .locator("section[aria-labelledby=run-title]")
    .screenshot({ path: `${out}demo-${width}-mid-run-panel.png` });

  // The refusal.
  await page
    .getByRole("heading", { name: "The daily cap held." })
    .waitFor({ timeout: RUN_TIMEOUT });
  await page.waitForTimeout(1200);
  await page
    .locator("section[aria-labelledby=run-title]")
    .screenshot({ path: `${out}demo-${width}-refused-panel.png` });
  await waitIdle(page);
  const focusBack = await page.evaluate(() => {
    const el = document.activeElement;
    return el?.tagName === "BUTTON"
      ? (el.textContent ?? "").trim()
      : `not a button (${el?.tagName})`;
  });
  report.focus[`end@${width}`] = focusBack;
  if (focusBack !== "Run the agent")
    failures.push(`focus did not return to the run button at ${width}px`);
  await page.screenshot({ path: `${out}demo-${width}-refused.png`, fullPage: true });
  report.cls[`run@${width}`] = await page.evaluate(() => window.__cls);
  report.cls[`shifts@${width}`] = await page.evaluate(() => window.__shifts);
  if (report.cls[`run@${width}`] > 0.01)
    failures.push(`layout shift ${report.cls[`run@${width}`]} during the run at ${width}px`);
  await audit(page, `refused@${width}`);

  const links = await page.evaluate(() =>
    [...document.querySelectorAll("ol[aria-label='Receipts from this run'] a")].map((a) =>
      a.getAttribute("href"),
    ),
  );
  const refusedHref = await page
    .getByRole("link", { name: /View the refused transaction/ })
    .getAttribute("href");
  const wallet = await page.locator("dt:text-is('Agent wallet') + dd a").getAttribute("href");
  const rows = await page.locator("ol[aria-label='Receipts from this run'] > li").count();
  const gateOutcome = await page.locator("figure[data-outcome]").getAttribute("data-outcome");
  report.runs.push({
    width,
    rows,
    gateOutcome,
    wallet,
    refusedTransaction: refusedHref,
    receipts: links,
  });
  if (rows !== 7) failures.push(`expected 7 rows after a run at ${width}px, saw ${rows}`);
  if (gateOutcome !== "refused")
    failures.push(`gate outcome ${gateOutcome} after the run at ${width}px`);
  await context.close();
}

await runOnce(1440);
await runOnce(360);

// Busy path. One visitor starts a run, a second presses run, is told and watches.
{
  const first = await openPage(1440);
  const second = await openPage(1440);
  await first.page.goto(`${base}/demo`, { waitUntil: "networkidle" });
  await second.page.goto(`${base}/demo`, { waitUntil: "networkidle" });
  await waitIdle(second.page);
  await first.page.getByRole("button", { name: "Run the agent" }).click();
  await first.page.getByText("Agent running").waitFor();
  await second.page.getByRole("button", { name: "Run the agent" }).click();
  const busy = second.page.getByText("Another visitor's run is in progress");
  await busy.waitFor({ timeout: 15_000 });
  await second.page.screenshot({ path: `${out}demo-1440-busy.png` });
  await second.page.getByRole("button", { name: "Watch that run" }).click();
  await second.page.getByText("Watching live").waitFor({ timeout: 15_000 });
  await second.page
    .getByRole("heading", { name: "The daily cap held." })
    .waitFor({ timeout: RUN_TIMEOUT });
  report.busy = { told: true, watched: true };
  await waitIdle(first.page);
  await waitIdle(second.page);
  await first.context.close();
  await second.context.close();
}

// Reduced motion. State still changes, nothing animates.
{
  const { context, page } = await openPage(1440, "reduce");
  await page.goto(`${base}/demo`, { waitUntil: "networkidle" });
  await waitIdle(page);
  await page.getByRole("button", { name: "Run the agent" }).click();
  // The page opens on the last run, refusal included. Wait for this run to start and to end.
  await page.getByText("Agent running").waitFor({ timeout: 15_000 });
  await waitIdle(page);
  const animation = await page.evaluate(() => {
    const figure = document.querySelector("figure[data-outcome]");
    if (!figure) return "missing";
    const moving = [...figure.querySelectorAll("*")]
      .map((el) => getComputedStyle(el).animationName)
      .filter((name) => name !== "none");
    return moving.length === 0 ? "none" : moving.join(",");
  });
  report.reducedMotion = { tokenAnimation: animation };
  if (animation !== "none") failures.push(`gate animates under reduced motion (${animation})`);
  await page.getByRole("heading", { name: "The daily cap held." }).waitFor();
  await page.screenshot({ path: `${out}demo-1440-reduced-motion.png` });
  await context.close();
}

await browser.close();

// Link prefetch preloads the stylesheet of other routes on every page of the site. That warning is
// not about the demo, so it is reported apart and does not fail this check.
report.siteWide = [
  ...new Set(
    report.console
      .filter((c) => c.text.includes("was preloaded using link preload"))
      .map((c) => c.text),
  ),
];
// The busy check expects one 409 from POST /demo/api/runs, which the browser always logs.
const noisy = report.console.filter(
  (c) =>
    !c.text.includes("Download the React DevTools") &&
    !c.text.includes("status of 409 (Conflict)") &&
    !c.text.includes("was preloaded using link preload"),
);
if (noisy.length > 0) failures.push(`${noisy.length} console errors or warnings`);
report.failures = failures;
writeFileSync(`${out}demo-report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.warn(`Screenshots and report in ${out}`);
if (failures.length > 0) {
  console.error(`Demo check found ${failures.length} problem(s):\n${failures.join("\n")}`);
  process.exit(1);
}
console.warn("Demo check passed with no problems.");
