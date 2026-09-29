// Browser audit for the web app. Run against a started server:
//   pnpm --filter @turnstile/web e2e            (defaults to http://localhost:3000)
//   E2E_BASE_URL=http://localhost:3100 pnpm --filter @turnstile/web e2e
// It screenshots the home page at three widths, runs axe-core on every route, checks for
// horizontal scroll, console errors, layout shift, visible focus and the mobile menu.
import { mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const require = createRequire(import.meta.url);
const axePath = require.resolve("axe-core/axe.min.js");
const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const out = fileURLToPath(new URL("./output/", import.meta.url));
mkdirSync(out, { recursive: true });

const routes = [
  "/",
  "/product",
  "/solutions",
  "/pricing",
  "/docs",
  "/docs/quickstart",
  "/docs/agent-quickstart",
  "/docs/concepts",
  "/docs/reference",
  "/security",
  "/demo",
  "/console",
  "/signin",
  "/about",
  "/legal/terms",
  "/legal/privacy",
];
const widths = [360, 768, 1440];
const failures = [];
const report = {
  base,
  screenshots: [],
  axe: {},
  overflow: {},
  console: [],
  cls: {},
  focus: {},
  menu: {},
};

const browser = await chromium.launch();

async function openPage(width, options = {}) {
  const context = await browser.newContext({
    viewport: { width, height: 900 },
    deviceScaleFactor: 1,
    reducedMotion: options.reducedMotion ?? "no-preference",
  });
  const page = await context.newPage();
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      report.console.push({ width, url: page.url(), type: message.type(), text: message.text() });
    }
  });
  page.on("pageerror", (error) => {
    report.console.push({ width, url: page.url(), type: "pageerror", text: String(error) });
  });
  return { context, page };
}

async function go(page, path) {
  const response = await page.goto(`${base}${path}`, { waitUntil: "networkidle" });
  if (response?.status() !== 200) {
    failures.push(`${path} answered ${response?.status() ?? "nothing"}`);
  }
}

// Screenshots of the home page, first frame and full page, at each width.
for (const width of widths) {
  const { context, page } = await openPage(width);
  await page.addInitScript(() => {
    window.__cls = 0;
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (!entry.hadRecentInput) window.__cls += entry.value;
      }
    }).observe({ type: "layout-shift", buffered: true });
  });
  await go(page, "/");
  const first = `${out}home-${width}-first-frame.png`;
  await page.screenshot({ path: first });
  await page.waitForTimeout(1500);
  const full = `${out}home-${width}-full.png`;
  await page.screenshot({ path: full, fullPage: true });
  report.screenshots.push(first, full);
  report.cls[width] = await page.evaluate(() => window.__cls);
  if (report.cls[width] > 0.01) failures.push(`layout shift ${report.cls[width]} at ${width}px`);
  await context.close();
}

// No script. The gate must still render its complete first frame.
{
  const context = await browser.newContext({
    viewport: { width: 1440, height: 900 },
    javaScriptEnabled: false,
  });
  const page = await context.newPage();
  await go(page, "/");
  const path = `${out}home-1440-no-javascript.png`;
  await page.screenshot({ path });
  report.screenshots.push(path);
  report.noScriptGateText = await page.locator("figure[data-outcome]").first().innerText();
  if (!report.noScriptGateText.includes("Settled"))
    failures.push("gate is incomplete without script");
  await context.close();
}

// Reduced motion end state and the gate mid flight, for visual review.
{
  const { context, page } = await openPage(1440, { reducedMotion: "reduce" });
  await go(page, "/");
  const path = `${out}home-1440-reduced-motion.png`;
  await page.screenshot({ path });
  report.screenshots.push(path);
  await context.close();
}
{
  const { context, page } = await openPage(1440);
  await go(page, "/");
  await page.waitForTimeout(1200 + 7200 * 0.3);
  const path = `${out}home-1440-gate-checking.png`;
  await page.locator("figure").first().screenshot({ path });
  report.screenshots.push(path);
  await context.close();
}

// Overflow and axe on every route at the narrowest and widest widths.
for (const width of [360, 1440]) {
  const { context, page } = await openPage(width, { reducedMotion: "reduce" });
  for (const route of routes) {
    await go(page, route);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    report.overflow[`${route}@${width}`] = overflow;
    if (overflow > 0) failures.push(`${route} scrolls sideways by ${overflow}px at ${width}px`);
    await page.addScriptTag({ path: axePath });
    const result = await page.evaluate(async () =>
      window.axe.run(document, {
        runOnly: {
          type: "tag",
          values: ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "best-practice"],
        },
      }),
    );
    report.axe[`${route}@${width}`] = {
      violations: result.violations.map((v) => ({
        id: v.id,
        impact: v.impact,
        nodes: v.nodes.map((n) => n.target.join(" ")),
      })),
      passes: result.passes.length,
    };
    for (const v of result.violations) failures.push(`axe ${v.id} on ${route} at ${width}px`);
  }
  await context.close();
}

// Keyboard pass. Every stop must show a focus indicator.
{
  const { context, page } = await openPage(1440, { reducedMotion: "reduce" });
  await go(page, "/");
  const stops = [];
  for (let i = 0; i < 60; i += 1) {
    await page.keyboard.press("Tab");
    const info = await page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return null;
      const style = getComputedStyle(el);
      const visible =
        (style.outlineStyle !== "none" && Number.parseFloat(style.outlineWidth) > 0) ||
        style.boxShadow !== "none";
      const label = (el.getAttribute("aria-label") || el.textContent || el.tagName)
        .trim()
        .slice(0, 40);
      return { tag: el.tagName.toLowerCase(), label, visible };
    });
    if (!info) break;
    stops.push(info);
  }
  report.focus.stops = stops;
  const hidden = stops.filter((s) => !s.visible);
  if (hidden.length > 0) failures.push(`${hidden.length} focus stops without a visible indicator`);
  await context.close();
}

// Mobile menu. Opens, exposes state, closes on Escape and returns focus.
{
  const { context, page } = await openPage(360, { reducedMotion: "reduce" });
  await go(page, "/");
  const toggle = page.getByRole("button", { name: "Open menu" });
  await toggle.focus();
  await page.keyboard.press("Enter");
  const expanded = await page
    .getByRole("button", { name: "Close menu" })
    .getAttribute("aria-expanded");
  const linkVisible = await page
    .getByRole("navigation", { name: "Mobile" })
    .getByRole("link", { name: "Pricing" })
    .isVisible();
  await page.waitForTimeout(400);
  const path = `${out}menu-360-open.png`;
  await page.screenshot({ path });
  report.screenshots.push(path);
  await page.addScriptTag({ path: axePath });
  const axeOpen = await page.evaluate(async () =>
    (await window.axe.run(document)).violations.map((v) => v.id),
  );
  await page.keyboard.press("Escape");
  const closed = await page
    .getByRole("button", { name: "Open menu" })
    .getAttribute("aria-expanded");
  const focusReturned = await page.evaluate(
    () => document.activeElement?.getAttribute("aria-controls") !== null,
  );
  report.menu = { expanded, linkVisible, closed, focusReturned, axeOpen };
  if (
    expanded !== "true" ||
    !linkVisible ||
    closed !== "false" ||
    !focusReturned ||
    axeOpen.length
  ) {
    failures.push(`mobile menu check failed ${JSON.stringify(report.menu)}`);
  }
  await context.close();
}

await browser.close();

const noisy = report.console.filter((c) => !c.text.includes("Download the React DevTools"));
if (noisy.length > 0) failures.push(`${noisy.length} console errors or warnings`);
report.failures = failures;
writeFileSync(`${out}report.json`, `${JSON.stringify(report, null, 2)}\n`);

console.warn(`Screenshots and report in ${out}`);
console.warn(`Routes checked ${routes.length}. Axe runs ${Object.keys(report.axe).length}.`);
console.warn(`Layout shift ${JSON.stringify(report.cls)}`);
console.warn(
  `Focus stops ${report.focus.stops.length}, all visible ${report.focus.stops.every((s) => s.visible)}`,
);
if (failures.length > 0) {
  console.error(`Audit found ${failures.length} problem(s):\n${failures.join("\n")}`);
  process.exit(1);
}
console.warn("Audit passed with no problems.");
