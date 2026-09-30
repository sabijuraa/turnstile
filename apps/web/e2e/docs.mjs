// Docs checks. Run against a started server:
//   E2E_BASE_URL=http://localhost:3510 node e2e/docs.mjs
// Screenshots every docs page at 360 and 1440 wide, checks the sidebar marks the current page,
// that the narrow docs menu opens, announces and closes with Escape, that every code block has
// a copy button, and that no page scrolls sideways.
import { mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const out = fileURLToPath(new URL("./output/docs/", import.meta.url));
mkdirSync(out, { recursive: true });

const pages = [
  ["/docs", "Overview"],
  ["/docs/quickstart", "Quickstart"],
  ["/docs/agent-quickstart", "Agent quickstart"],
  ["/docs/concepts", "Concepts"],
  ["/docs/reference", "Reference"],
];

const failures = [];
const report = { base, pages: {} };
const browser = await chromium.launch();

for (const width of [360, 1440]) {
  const context = await browser.newContext({ viewport: { width, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (err) => errors.push(err.message));
  for (const [route, label] of pages) {
    await page.goto(`${base}${route}`, { waitUntil: "networkidle" });
    const name = route.replaceAll("/", "-").slice(1);
    await page.screenshot({ path: `${out}${name}-${width}.png`, fullPage: width === 360 });
    const current = await page
      .locator('nav[aria-label="Documentation"] a[aria-current="page"]')
      .allTextContents();
    if (current.length !== 1 || current[0] !== label) {
      failures.push(`${route} at ${width}px marks ${JSON.stringify(current)} as current`);
    }
    const blocks = await page.locator("main pre").count();
    const copies = await page.locator('main button[aria-label^="Copy"]').count();
    if (blocks !== copies)
      failures.push(`${route} has ${blocks} code blocks, ${copies} copy buttons`);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
    );
    if (overflow > 0) failures.push(`${route} scrolls sideways by ${overflow}px at ${width}px`);
    const h1 = await page.locator("main h1").count();
    if (h1 !== 1) failures.push(`${route} has ${h1} h1 elements`);
    report.pages[`${route}@${width}`] = { blocks, copies, overflow, current };
  }

  if (width === 360) {
    await page.goto(`${base}/docs/concepts`, { waitUntil: "networkidle" });
    const toggle = page.locator('nav[aria-label="Documentation"] button[aria-expanded]');
    const list = page.locator('nav[aria-label="Documentation"] > ul');
    if (await list.isVisible()) failures.push("docs menu is open before it is toggled");
    await toggle.focus();
    await page.keyboard.press("Enter");
    if ((await toggle.getAttribute("aria-expanded")) !== "true" || !(await list.isVisible())) {
      failures.push("docs menu did not open from the keyboard");
    }
    await page.screenshot({ path: `${out}menu-360-open.png` });
    await page.keyboard.press("Escape");
    const focused = await page.evaluate(() =>
      document.activeElement?.getAttribute("aria-expanded"),
    );
    if ((await list.isVisible()) || focused !== "false") {
      failures.push("Escape did not close the docs menu and return focus to the toggle");
    }
    await toggle.click();
    await page.locator('nav[aria-label="Documentation"] a', { hasText: "Errors" }).click();
    await page.waitForURL(/\/docs\/reference#errors$/);
    if (await list.isVisible()) failures.push("docs menu stayed open after navigating");
  }
  if (errors.length) failures.push(`page errors at ${width}px ${errors.join(" | ")}`);
  await context.close();
}

await browser.close();
report.failures = failures;
writeFileSync(`${out}report.json`, `${JSON.stringify(report, null, 2)}\n`);
console.warn(`Docs pages checked ${pages.length * 2}. Screenshots in ${out}`);
if (failures.length) {
  console.error(`Docs checks found ${failures.length} problem(s)`);
  for (const f of failures) console.error(f);
  process.exitCode = 1;
} else {
  console.warn("Docs checks passed.");
}
