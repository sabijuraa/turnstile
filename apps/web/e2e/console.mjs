// End-to-end run of the console in a real browser against the real backend and a local validator.
// A fresh owner signs in with a test-only Wallet Standard wallet, creates and funds an agent,
// lets the agent pay the metered demo API, edits the policy, rotates session keys, moves funds,
// reads and exports receipts, and creates and revokes an API key. Every screen is captured at
// 360 and 1440 wide into e2e/output/console.
//
//   E2E_BASE_URL=http://localhost:3300 BACKEND_URL=http://127.0.0.1:4022 \
//   SOLANA_RPC_URL=http://127.0.0.1:8899 DEPLOYMENT_FILE=... KEYS_DIR=keys/localnet \
//   DEMO_API_URL=http://127.0.0.1:4021 node e2e/console.mjs
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium } from "playwright";
import { installWallet, readKeypair, repoRoot, splToken, web3 } from "./console-wallet.mjs";

const base = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const backend = process.env.BACKEND_URL ?? "http://127.0.0.1:4022";
const rpcUrl = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
const demoApi = process.env.DEMO_API_URL ?? "http://127.0.0.1:4021";
const deploymentFile = resolve(
  repoRoot,
  process.env.DEPLOYMENT_FILE ?? "deployments/localnet.json",
);
const keysDir = resolve(repoRoot, process.env.KEYS_DIR ?? "keys/localnet");
const out = fileURLToPath(new URL("./output/console/", import.meta.url));
const runKeys = resolve(repoRoot, "keys/console-e2e/run");
mkdirSync(out, { recursive: true });
mkdirSync(runKeys, { recursive: true });

const deployment = JSON.parse(readFileSync(deploymentFile, "utf8"));
const connection = new web3.Connection(rpcUrl, "confirmed");
const log = (...args) => console.warn("·", ...args);
const failures = [];
const evidence = { base, steps: [], screenshots: [], console: [] };
function check(ok, what) {
  evidence.steps.push({ ok: Boolean(ok), what });
  if (!ok) failures.push(what);
  log(ok ? "ok  " : "FAIL", what);
}

// A fresh owner for every run, funded with SOL and tUSDC from the local mint authority.
const stamp = Date.now();
const owner = web3.Keypair.generate();
writeFileSync(`${runKeys}/owner-${stamp}.json`, JSON.stringify(Array.from(owner.secretKey)), {
  mode: 0o600,
});
{
  const sig = await connection.requestAirdrop(owner.publicKey, 5 * web3.LAMPORTS_PER_SOL);
  await connection.confirmTransaction(sig, "confirmed");
  const mintAuthority = readKeypair(`${keysDir}/mint-authority.json`);
  const mint = new web3.PublicKey(deployment.mint);
  const ata = await splToken.getOrCreateAssociatedTokenAccount(
    connection,
    mintAuthority,
    mint,
    owner.publicKey,
  );
  await splToken.mintTo(connection, mintAuthority, mint, ata.address, mintAuthority, 100_000_000n);
  log(`owner ${owner.publicKey.toBase58()} funded with 5 SOL and 100 tUSDC`);
}

function keygen(name) {
  const file = `${runKeys}/${name}-${stamp}.json`;
  const printed = execFileSync(
    "node",
    [`${repoRoot}packages/sdk-agent/dist/cli.js`, "keygen", "--out", file],
    { encoding: "utf8" },
  );
  const key = printed
    .trim()
    .split(/\s+/)
    .find((w) => /^[1-9A-HJ-NP-Za-km-z]{32,44}$/.test(w));
  if (!key) throw new Error(`keygen printed no public key: ${printed}`);
  return { file, key };
}

const browser = await chromium.launch();
const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const wallet = await installWallet(context, owner);
const page = await context.newPage();
page.on("console", (m) => {
  if (m.type() === "error" || m.type() === "warning") {
    evidence.console.push({ url: page.url(), type: m.type(), text: m.text() });
  }
});
page.on("pageerror", (e) =>
  evidence.console.push({ url: page.url(), type: "pageerror", text: String(e) }),
);

async function shot(name, options = {}) {
  const widths = options.widths ?? [1440, 360];
  for (const width of widths) {
    await page.setViewportSize({ width, height: 900 });
    await page.waitForTimeout(250);
    const path = `${out}${name}-${width}.png`;
    await page.screenshot({ path, fullPage: true });
    evidence.screenshots.push(path);
  }
  await page.setViewportSize({ width: 1440, height: 900 });
}

async function settle() {
  await page.waitForLoadState("networkidle");
  await page.waitForFunction(
    () => document.querySelectorAll('[aria-busy="true"]').length === 0,
    null,
    {
      timeout: 20_000,
    },
  );
}

// 1. No wallet in the browser. The sign-in page says how to get one.
{
  const bare = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await bare.newPage();
  await p.goto(`${base}/signin`, { waitUntil: "networkidle" });
  await p.waitForTimeout(800);
  const text = await p.locator("main").innerText();
  check(text.includes("No Solana wallet found"), "sign in without a wallet names the problem");
  for (const width of [1440, 360]) {
    await p.setViewportSize({ width, height: 900 });
    const path = `${out}signin-no-wallet-${width}.png`;
    await p.screenshot({ path, fullPage: true });
    evidence.screenshots.push(path);
  }
  await bare.close();
}

// 2. Signed out, the console sends you to sign in.
await page.goto(`${base}/console/receipts`, { waitUntil: "networkidle" });
await page.waitForURL(/\/signin/, { timeout: 15_000 });
check(
  page.url().includes("/signin?next=%2Fconsole%2Freceipts"),
  "console redirects to sign in and keeps the path",
);
await page.waitForSelector("text=Turnstile Test Wallet");
await shot("signin");

// 3. Declined signature, then a real sign in.
wallet.rejectNextMessage = true;
await page.getByRole("button", { name: "Sign in with Turnstile Test Wallet" }).click();
await page.waitForSelector("text=Signature declined");
check(true, "declined signature shows Signature declined");
await shot("signin-declined", { widths: [360] });
await page.getByRole("button", { name: "Sign in with Turnstile Test Wallet" }).click();
await page.waitForURL(`${base}/console/receipts`, { timeout: 20_000 });
check(
  wallet.signed.some(
    (s) => s.kind === "signMessage" && s.text.includes("Sign in to the Turnstile console"),
  ),
  "wallet signed the sign-in message from the backend",
);
await settle();

// 4. Empty states for a new owner.
for (const [route, name, words] of [
  ["/console", "dashboard-empty", "No agents yet"],
  ["/console/agents", "agents-empty", "No agents yet"],
  ["/console/receipts", "receipts-empty", "No receipts yet"],
  ["/console/settings", "settings-empty", "No API keys yet"],
]) {
  await page.goto(`${base}${route}`, { waitUntil: "networkidle" });
  await settle();
  check((await page.locator("main").innerText()).includes(words), `${route} shows its empty state`);
  await shot(name);
}

// 5. Create an agent with inline validation along the way.
const session1 = keygen("session-1");
const catalog = await (await fetch(`${demoApi}/v1/catalog`)).json();
const summarize = catalog.routes.find((r) => r.path === "/v1/summarize");
const keywords = catalog.routes.find((r) => r.path === "/v1/keywords");
await page.goto(`${base}/console/agents/new`, { waitUntil: "networkidle" });
await settle();
check(
  (await page.locator("main").innerText()).includes(owner.publicKey.toBase58()),
  "create flow shows the owner authority",
);
await page.getByLabel("Agent name").fill("Research agent");
await shot("create-1-owner", { widths: [1440] });
await page.getByRole("button", { name: "Continue" }).click();
await page.getByLabel("Session public key").fill("not-a-key");
await page.waitForSelector("text=This is not a valid session public key");
check(true, "invalid session key is flagged inline");
await page.getByLabel("Session public key").fill(owner.publicKey.toBase58());
await page.waitForSelector("text=Use a separate key for the agent");
check(true, "owner key as session key is refused inline");
await page.getByLabel("Session public key").fill(session1.key);
await shot("create-2-session-key");
await page.getByRole("button", { name: "Continue" }).click();
await page.getByLabel("Initial deposit").fill("1.1234567");
await page.waitForSelector("text=Use at most 6 decimal places");
check(true, "seven decimal places are refused inline");
await page.getByLabel("Initial deposit").fill("25");
await page.getByRole("button", { name: "Continue" }).click();
await page.getByLabel("Per-call cap").fill("0.5");
await page.getByLabel("Daily cap").fill("0.04");
await page.waitForSelector("text=The per-call cap cannot be above the daily cap");
check(true, "per-call above daily is refused inline");
await page.getByLabel("Per-call cap").fill("0.01");
await page.getByRole("button", { name: "Add service" }).click();
await page.getByLabel("Resource URL 1").fill(`${summarize.resource}/?utm=x`);
await page.waitForSelector(`text=${summarize.resource}`);
check(true, "resource URL shows its canonical form");
await page.getByLabel("Resource URL 1").fill(summarize.resource);
await page.getByLabel("Recipient address 1").fill(catalog.payTo);
await shot("create-4-limits");
await page.getByRole("button", { name: "Continue" }).click();
await shot("create-5-review");
await page.getByRole("button", { name: "Create agent" }).click();
await page.waitForSelector("text=Confirmed on chain", { timeout: 90_000 });
const createdStatus = await page
  .locator('[role="status"]:has-text("Agent created")')
  .first()
  .innerText();
check(
  createdStatus.includes("View on Solana Explorer"),
  "create agent confirms with an explorer link",
);
await shot("create-done", { widths: [1440] });
await page.getByRole("link", { name: "Open agent" }).click();
await page.waitForURL(/\/console\/agents\/[1-9A-HJ-NP-Za-km-z]{32,44}$/);
const agentAddress = page.url().split("/").pop();
await settle();
const detailText = await page.locator("main").innerText();
check(detailText.includes("Research agent"), "agent detail shows the saved name");
check(detailText.includes("25"), "agent detail shows the 25 tUSDC vault balance");
log(`agent ${agentAddress}`);

// 6. The agent pays the metered API seven times with its session key. Receipts are real.
const sdk = await import(pathToFileURL(`${repoRoot}packages/sdk-agent/dist/index.js`).href);
const agent = sdk.createAgent({
  rpcUrl,
  agentWallet: agentAddress,
  sessionKey: readKeypair(session1.file),
  policyTtlMs: 0,
});
let settled = 0;
for (let i = 0; i < 7; i += 1) {
  const res = await agent.fetch(`${demoApi}/v1/summarize`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      text: `Turnstile settles one payment per request. Run ${i} checks the console. The owner sets limits once. The chain enforces them on every call.`,
    }),
  });
  if (res.ok && res.payment) settled += 1;
}
check(settled === 7, `agent settled ${settled} of 7 paid requests`);
// Wait for the indexer to store them.
for (let i = 0; i < 30; i += 1) {
  await page.goto(`${base}/console/receipts`, { waitUntil: "networkidle" });
  await settle();
  const rows = await page.locator("tbody tr").count();
  if (rows >= 7) break;
  await page.waitForTimeout(1000);
}
check((await page.locator("tbody tr").count()) === 7, "receipts page lists the 7 indexed receipts");
await shot("receipts");

// 7. Dashboard with data, and the agents list with a near-cap agent.
await page.goto(`${base}/console`, { waitUntil: "networkidle" });
await settle();
const dash = await page.locator("main").innerText();
check(dash.includes("0.035"), "dashboard total spend is 0.035 tUSDC");
check(dash.includes("Near daily cap"), "dashboard marks the agent near its cap with a pill");
await page.locator("svg[role=img]").focus();
await page.keyboard.press("End");
await shot("dashboard");
await page.getByRole("radio", { name: "Last 24 hours" }).check();
await settle();
await shot("dashboard-24h", { widths: [1440] });
await page.goto(`${base}/console/agents`, { waitUntil: "networkidle" });
await settle();
await shot("agents");

// 8. Receipts filters, sort and CSV export.
await page.goto(`${base}/console/receipts`, { waitUntil: "networkidle" });
await settle();
await page.getByRole("button", { name: /Amount/ }).click();
await settle();
check(page.url().includes("sort=amount"), "sorting by amount goes to the backend");
await page.getByLabel("Agent").selectOption(agentAddress);
await page.getByLabel("Search").fill("summarize");
await page.getByRole("button", { name: "Apply filters" }).click();
await page.waitForURL(/search=summarize/);
await settle();
check(
  (await page.locator("tbody tr").count()) === 7,
  "filter by agent and search keeps the 7 receipts",
);
await page.getByLabel("Search").fill("no-such-thing");
await page.getByRole("button", { name: "Apply filters" }).click();
await page.waitForURL(/search=no-such-thing/);
await settle();
check(
  (await page.locator("main").innerText()).includes("No receipts match these filters"),
  "no match names the filters",
);
await shot("receipts-no-match", { widths: [1440] });
await page.getByRole("button", { name: "Clear filters" }).first().click();
await page.waitForURL((url) => !url.search.includes("search="));
await settle();
const [download] = await Promise.all([
  page.waitForEvent("download"),
  page.getByRole("link", { name: "Export CSV" }).click(),
]);
const csvPath = `${out}receipts.csv`;
await download.saveAs(csvPath);
const csv = readFileSync(csvPath, "utf8").trim().split("\n");
check(
  csv[0].startsWith("block_time,receipt_address") && csv.length === 8,
  `CSV export has a header and ${csv.length - 1} rows`,
);

// 9. Edit the policy. Raise the daily cap and allow the keywords route.
await page.goto(`${base}/console/agents/${agentAddress}/policy`, { waitUntil: "networkidle" });
await settle();
await page.getByLabel("Daily cap").fill("0.1");
await page.getByRole("button", { name: "Add service" }).click();
await page.getByLabel("Resource URL 2").fill(keywords.resource);
await page.getByLabel("Recipient address 2").fill(catalog.payTo);
await shot("policy");
await page.getByRole("button", { name: "Save policy" }).click();
await page.waitForSelector('[role="status"]:has-text("Policy saved")', { timeout: 90_000 });
check(true, "policy change confirms with Policy saved");
await page.goto(`${base}/console/agents/${agentAddress}`, { waitUntil: "networkidle" });
await settle();
const afterPolicy = await page.locator("main").innerText();
check(
  afterPolicy.includes("0.1") && afterPolicy.includes(keywords.resource),
  "agent detail reads the new cap and allow-list from chain",
);

// 10. Add a second session key, then revoke it.
const session2 = keygen("session-2");
await page.getByLabel("Session public key").fill(session2.key);
await page.getByRole("button", { name: "Add session key" }).click();
await page.waitForSelector('[role="status"]:has-text("Session key added")', { timeout: 90_000 });
await settle();
check(
  (await page.locator("main").innerText()).includes(session2.key),
  "second session key is listed",
);
const row = page.locator("li", { hasText: session2.key });
await row.getByRole("button", { name: /^Revoke/ }).click();
await row.getByRole("button", { name: "Revoke key" }).click();
await page.waitForSelector('[role="status"]:has-text("Session key revoked")', { timeout: 90_000 });
await settle();
check(
  (await page.locator("li", { hasText: session2.key }).innerText()).includes("Revoked"),
  "revoked key reads Revoked from chain",
);

// 11. Deposit and withdraw.
const forms = page.locator("form");
await forms.filter({ hasText: "Amount to deposit" }).getByLabel("Amount to deposit").fill("5");
await forms
  .filter({ hasText: "Amount to deposit" })
  .getByRole("button", { name: "Deposit" })
  .click();
await page.waitForSelector('[role="status"]:has-text("Deposit confirmed")', { timeout: 90_000 });
await forms.filter({ hasText: "Amount to withdraw" }).getByLabel("Amount to withdraw").fill("2");
await forms
  .filter({ hasText: "Amount to withdraw" })
  .getByRole("button", { name: "Withdraw" })
  .click();
await page.waitForSelector('[role="status"]:has-text("Withdrawal confirmed")', { timeout: 90_000 });
await settle();
const vault = await page.locator("dt:has-text('Vault balance') + dd").innerText();
check(
  vault.includes("27.965"),
  `vault reads ${vault.replace(/\s+/g, " ")} after 25 + 5 - 2 - 0.035`,
);
await shot("agent-detail");

// 12. API keys. Create, use, revoke.
await page.goto(`${base}/console/settings`, { waitUntil: "networkidle" });
await settle();
await page.getByLabel("Key name").fill("reporting job");
await page.getByRole("button", { name: "Create API key" }).click();
await page.waitForSelector("text=Copy this key now");
const rawKey = (await page.locator("pre code").innerText()).trim();
check(/^tsk_/.test(rawKey), "raw API key is shown once");
await shot("settings-key-created");
const withKey = await fetch(`${backend}/v1/receipts?limit=1`, {
  headers: { authorization: `Bearer ${rawKey}` },
});
check(withKey.status === 200, `new API key reads receipts, status ${withKey.status}`);
await page.getByRole("button", { name: "I saved the key" }).click();
await page.getByRole("button", { name: "Revoke reporting job" }).click();
await page.getByRole("button", { name: "Revoke key" }).click();
await page.waitForSelector("text=Revoked", { timeout: 20_000 });
const revoked = await fetch(`${backend}/v1/me`, { headers: { authorization: `Bearer ${rawKey}` } });
check(revoked.status === 401, `revoked API key is refused, status ${revoked.status}`);
await shot("settings");

// A second browser signs in as the same owner and keeps its session for the audit script.
{
  const second = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  await installWallet(second, owner);
  const p = await second.newPage();
  await p.goto(`${base}/signin`, { waitUntil: "networkidle" });
  await p.getByRole("button", { name: "Sign in with Turnstile Test Wallet" }).click();
  await p.waitForURL(`${base}/console`, { timeout: 20_000 });
  await second.storageState({ path: `${out}state.json` });
  await second.close();
}

// Sign out ends this session, and the console sends the next visit back to sign in.
await page.goto(`${base}/console`, { waitUntil: "networkidle" });
await settle();
await page.getByRole("button", { name: "Sign out" }).click();
await page.waitForURL(/\/signin\?signedOut=1/);
await page.waitForSelector("text=Signed out");
await page.goto(`${base}/console/settings`);
await page.waitForURL(/\/signin\?next=/, { timeout: 15_000 });
check(true, "sign out ends the session and the console goes back to sign in");
writeFileSync(
  `${out}run.json`,
  JSON.stringify({ agentAddress, owner: owner.publicKey.toBase58() }, null, 2),
);

const noisy = evidence.console.filter((c) => !c.text.includes("Download the React DevTools"));
check(noisy.length === 0, `no console errors or warnings (${noisy.length})`);
evidence.failures = failures;
writeFileSync(`${out}report.json`, `${JSON.stringify(evidence, null, 2)}\n`);
await browser.close();
if (failures.length > 0) {
  console.error(`Console run found ${failures.length} problem(s):\n${failures.join("\n")}`);
  process.exit(1);
}
console.warn(`Console run passed. ${evidence.steps.length} checks. Screenshots in ${out}`);
