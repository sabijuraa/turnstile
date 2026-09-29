import { Keypair } from "@solana/web3.js";
import { bytesToHex, resourceId } from "@turnstile/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import type { ReceiptView } from "../src/store/receipts.js";
import {
  address,
  closePool,
  type Harness,
  harness,
  jsonPost,
  resetDb,
  seedReceipt,
  signIn,
} from "./helpers.js";

interface Page {
  receipts: ReceiptView[];
  nextCursor: string | null;
}

const NOW = new Date("2026-09-29T12:30:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);
const SUMMARIZE = "https://demo.turnstile.dev/v1/summarize";
const QUOTE = "https://data.example.com/v1/quote";

describe("receipts, spend and summary", () => {
  let h: Harness;
  let ownerA: Keypair;
  let ownerB: Keypair;
  let cookieA: string;
  let cookieB: string;
  let agent1: string;
  let agent2: string;
  let agentB: string;

  beforeEach(async () => {
    h = await harness({ now: NOW });
    await resetDb(h.pool);
    ownerA = Keypair.generate();
    ownerB = Keypair.generate();
    cookieA = await signIn(h, ownerA);
    cookieB = await signIn(h, ownerB);
    agent1 = address();
    agent2 = address();
    agentB = address();
    const a = ownerA.publicKey.toBase58();
    // Ten receipts for owner A across two agents and two resources, one per 10 minutes.
    for (let i = 0; i < 10; i++) {
      await seedReceipt(h.pool, {
        owner: a,
        agentWallet: i % 2 === 0 ? agent1 : agent2,
        amount: BigInt(1000 + i),
        blockTime: minutesAgo(10 * i + 1),
        resource: i < 6 ? SUMMARIZE : QUOTE,
        resourceInTableOnly: i >= 6,
      });
    }
    await seedReceipt(h.pool, {
      owner: ownerB.publicKey.toBase58(),
      agentWallet: agentB,
      amount: 999_999n,
      blockTime: minutesAgo(5),
    });
  });
  afterAll(closePool);

  async function get(path: string, cookie = cookieA): Promise<Response> {
    return h.app.request(path, { headers: { cookie } });
  }

  it("lists only the signed-in owner's receipts, newest first", async () => {
    const res = await get("/v1/receipts");
    expect(res.status).toBe(200);
    const page = (await res.json()) as Page;
    expect(page.receipts).toHaveLength(10);
    expect(page.nextCursor).toBeNull();
    expect(page.receipts.every((r) => r.owner === ownerA.publicKey.toBase58())).toBe(true);
    expect(page.receipts.map((r) => r.amount)).toEqual([
      "1000",
      "1001",
      "1002",
      "1003",
      "1004",
      "1005",
      "1006",
      "1007",
      "1008",
      "1009",
    ]);
    const first = page.receipts[0];
    expect(first).toMatchObject({
      amount: "1000",
      displayAmount: "0.001",
      resource: SUMMARIZE,
      status: "settled",
    });
    expect(first?.explorerUrl).toContain("https://explorer.solana.com/tx/");

    const b = (await (await get("/v1/receipts", cookieB)).json()) as Page;
    expect(b.receipts.map((r) => r.agentWallet)).toEqual([agentB]);
  });

  it("never returns another owner's receipts, even when filtering by their agent", async () => {
    const page = (await (await get(`/v1/receipts?agent=${agentB}`)).json()) as Page;
    expect(page.receipts).toEqual([]);
  });

  it("filters by agent", async () => {
    const page = (await (await get(`/v1/receipts?agent=${agent2}`)).json()) as Page;
    expect(page.receipts.map((r) => r.amount)).toEqual(["1001", "1003", "1005", "1007", "1009"]);
  });

  it("filters by resource string and by resource id, and reads names from the resources table", async () => {
    const byString = (await (
      await get(`/v1/receipts?resource=${encodeURIComponent(QUOTE)}`)
    ).json()) as Page;
    expect(byString.receipts.map((r) => r.amount)).toEqual(["1006", "1007", "1008", "1009"]);
    expect(byString.receipts.every((r) => r.resource === QUOTE)).toBe(true);
    const hex = bytesToHex(resourceId(SUMMARIZE));
    const byId = (await (await get(`/v1/receipts?resource=${hex}`)).json()) as Page;
    expect(byId.receipts).toHaveLength(6);
    expect(byId.receipts.every((r) => r.resourceId === hex)).toBe(true);
  });

  it("filters by time range with from inclusive and to exclusive", async () => {
    const from = minutesAgo(31).toISOString();
    const to = minutesAgo(11).toISOString();
    const page = (await (
      await get(`/v1/receipts?from=${from}&to=${encodeURIComponent(to)}`)
    ).json()) as Page;
    expect(page.receipts.map((r) => r.amount)).toEqual(["1002", "1003"]);
  });

  it("searches by resource text and by signature prefix", async () => {
    const byText = (await (await get("/v1/receipts?search=quote")).json()) as Page;
    expect(byText.receipts).toHaveLength(4);
    const all = (await (await get("/v1/receipts")).json()) as Page;
    const target = all.receipts[3];
    const bySig = (await (
      await get(`/v1/receipts?search=${target?.signature.slice(0, 12)}`)
    ).json()) as Page;
    expect(bySig.receipts.map((r) => r.receiptAddress)).toEqual([target?.receiptAddress]);
  });

  it("pages with a keyset cursor without gaps or repeats", async () => {
    const seen: string[] = [];
    let cursor: string | null = null;
    let pages = 0;
    do {
      const qs: string = cursor ? `&cursor=${cursor}` : "";
      const page = (await (await get(`/v1/receipts?limit=3${qs}`)).json()) as Page;
      seen.push(...page.receipts.map((r) => r.amount));
      cursor = page.nextCursor;
      pages++;
    } while (cursor);
    expect(pages).toBe(4);
    expect(seen).toEqual([
      "1000",
      "1001",
      "1002",
      "1003",
      "1004",
      "1005",
      "1006",
      "1007",
      "1008",
      "1009",
    ]);
  });

  it("pages by amount and keeps ties ordered", async () => {
    await seedReceipt(h.pool, {
      owner: ownerA.publicKey.toBase58(),
      agentWallet: agent1,
      amount: 1005n,
      blockTime: minutesAgo(200),
    });
    const seen: string[] = [];
    let cursor: string | null = null;
    do {
      const qs: string = cursor ? `&cursor=${cursor}` : "";
      const page = (await (await get(`/v1/receipts?sort=amount_desc&limit=4${qs}`)).json()) as Page;
      seen.push(...page.receipts.map((r) => r.amount));
      cursor = page.nextCursor;
    } while (cursor);
    expect(seen).toEqual([
      "1009",
      "1008",
      "1007",
      "1006",
      "1005",
      "1005",
      "1004",
      "1003",
      "1002",
      "1001",
      "1000",
    ]);
  });

  it("rejects a cursor from a different sort and bad query values with clear errors", async () => {
    const page = (await (await get("/v1/receipts?limit=2")).json()) as Page;
    const bad = await get(`/v1/receipts?sort=amount_asc&cursor=${page.nextCursor}`);
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("invalid_cursor");
    const limit = await get("/v1/receipts?limit=500");
    expect(await limit.json()).toEqual({
      error: { code: "invalid_query", message: "limit must be 200 or less." },
    });
    const agent = await get("/v1/receipts?agent=nope");
    expect(await agent.json()).toEqual({
      error: { code: "invalid_query", message: "agent must be a base58 Solana address." },
    });
  });

  it("exports a CSV statement with exact decimals", async () => {
    const a = ownerA.publicKey.toBase58();
    await resetReceipts(h);
    const amounts = [1n, 10n, 1_000_000n, 1_234_567n, 18_446_744_073_709_551_615n];
    for (const [i, amount] of amounts.entries()) {
      await seedReceipt(h.pool, {
        owner: a,
        agentWallet: agent1,
        amount,
        blockTime: minutesAgo(i + 1),
      });
    }
    const res = await get(`/v1/receipts.csv?agent=${agent1}&sort=oldest`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toBe(
      'attachment; filename="turnstile-receipts-2026-09-29.csv"',
    );
    const lines = (await res.text()).trimEnd().split("\r\n");
    expect(lines[0]).toBe(
      "block_time,receipt_address,signature,agent_wallet,agent_label,resource,resource_id,recipient,mint,amount,amount_base_units,nonce,slot,network,status",
    );
    const cols = lines.slice(1).map((l) => l.split(","));
    expect(cols.map((c) => [c[9], c[10]])).toEqual([
      ["18446744073709.551615", "18446744073709551615"],
      ["1.234567", "1234567"],
      ["1", "1000000"],
      ["0.00001", "10"],
      ["0.000001", "1"],
    ]);
  });

  it("streams a CSV larger than one internal page", async () => {
    const a = ownerA.publicKey.toBase58();
    const values: string[] = [];
    for (let i = 0; i < 1200; i++) {
      values.push(
        `('r${i}', 's${i}', ${i}, $1::timestamptz - make_interval(secs => ${i}), '${agent1}', '${a}', 'k', 'p', 't', 'm', ${i + 1}, 'rid', null, 'n${i}', 'f', 'solana:localnet')`,
      );
    }
    await h.pool.query(
      `INSERT INTO receipts (receipt_address, signature, slot, block_time, agent_wallet, owner,
       session_key, recipient, recipient_token, mint, amount, resource_id, resource, nonce,
       fee_payer, network) VALUES ${values.join(",")}`,
      [minutesAgo(300)],
    );
    const text = await (await get("/v1/receipts.csv")).text();
    const lines = text.trimEnd().split("\r\n");
    expect(lines).toHaveLength(1 + 10 + 1200);
    expect(new Set(lines.slice(1).map((l) => l.split(",")[1])).size).toBe(1210);
  });

  it("returns a zero-filled hourly series for 24h", async () => {
    const res = await get("/v1/spend?range=24h");
    const body = (await res.json()) as {
      bucket: string;
      from: string;
      to: string;
      series: { start: string; amount: string; count: number; displayAmount: string }[];
      totals: { amount: string; displayAmount: string; count: number };
    };
    expect(body.bucket).toBe("hour");
    expect(body.from).toBe("2026-09-28T13:00:00.000Z");
    expect(body.to).toBe("2026-09-29T13:00:00.000Z");
    expect(body.series).toHaveLength(24);
    expect(body.series[0]?.start).toBe("2026-09-28T13:00:00.000Z");
    const nonZero = body.series.filter((p) => p.count > 0);
    // Receipts land at 12:29, 12:19 and 12:09, then 11:59 down to 11:09, then 10:59.
    expect(nonZero.map((p) => [p.start, p.amount, p.count])).toEqual([
      ["2026-09-29T10:00:00.000Z", "1009", 1],
      ["2026-09-29T11:00:00.000Z", "6033", 6],
      ["2026-09-29T12:00:00.000Z", "3003", 3],
    ]);
    expect(body.series.filter((p) => p.count === 0).every((p) => p.amount === "0")).toBe(true);
    expect(body.totals).toEqual({ amount: "10045", displayAmount: "0.010045", count: 10 });
  });

  it("returns a zero-filled daily series for 30d", async () => {
    await seedReceipt(h.pool, {
      owner: ownerA.publicKey.toBase58(),
      agentWallet: agent1,
      amount: 5_000_000n,
      blockTime: new Date("2026-09-10T08:00:00Z"),
    });
    const body = (await (await get("/v1/spend?range=30d")).json()) as {
      bucket: string;
      series: { start: string; amount: string; count: number }[];
    };
    expect(body.bucket).toBe("day");
    expect(body.series).toHaveLength(30);
    expect(body.series[0]?.start).toBe("2026-08-31T00:00:00.000Z");
    expect(body.series[29]?.start).toBe("2026-09-29T00:00:00.000Z");
    expect(body.series.filter((p) => p.count > 0).map((p) => [p.start, p.amount])).toEqual([
      ["2026-09-10T00:00:00.000Z", "5000000"],
      ["2026-09-29T00:00:00.000Z", "10045"],
    ]);
  });

  it("summarizes spend, agents, recent receipts and pending failures for the owner", async () => {
    await h.pool.query(
      `INSERT INTO settlement_dead_letters (agent_wallet, nonce, payload, requirements, error, attempts, status)
       VALUES ($1, 'n1', '{}', $2, 'rpc timeout while confirming', 3, 'pending'),
              ($1, 'n2', '{}', $2, 'already replayed', 1, 'replayed'),
              ($3, 'n3', '{}', $2, 'other owner failure', 1, 'pending')`,
      [agent1, JSON.stringify({ amount: "2500", resource: SUMMARIZE }), agentB],
    );
    const res = await get("/v1/summary?range=24h");
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      totalSpend: { amount: string; displayAmount: string };
      settlementCount: number;
      activeAgents: number;
      recentReceipts: ReceiptView[];
      failures: { pendingCount: number; items: { error: string; displayAmount: string }[] };
    };
    expect(body.totalSpend).toEqual({ amount: "10045", displayAmount: "0.010045" });
    expect(body.settlementCount).toBe(10);
    expect(body.activeAgents).toBe(2);
    expect(body.recentReceipts.map((r) => r.amount)).toEqual([
      "1000",
      "1001",
      "1002",
      "1003",
      "1004",
      "1005",
      "1006",
      "1007",
    ]);
    expect(body.failures.pendingCount).toBe(1);
    expect(body.failures.items).toMatchObject([
      { error: "rpc timeout while confirming", displayAmount: "0.0025", attempts: 3 },
    ]);
  });

  it("labels an owned agent and shows the label on receipts", async () => {
    const res = await h.app.request(`/v1/agents/${agent1}/label`, {
      method: "PUT",
      headers: { cookie: cookieA, "content-type": "application/json" },
      body: JSON.stringify({ label: "research bot" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ agentWallet: agent1, label: "research bot" });
    const page = (await (await get(`/v1/receipts?agent=${agent1}&limit=1`)).json()) as Page;
    expect(page.receipts[0]?.agentLabel).toBe("research bot");
    const search = (await (await get("/v1/receipts?search=research")).json()) as Page;
    expect(search.receipts).toHaveLength(5);
  });

  it("refuses to label an agent the owner does not own", async () => {
    const res = await h.app.request(`/v1/agents/${agentB}/label`, {
      method: "PUT",
      headers: { cookie: cookieA, "content-type": "application/json" },
      body: JSON.stringify({ label: "mine now" }),
    });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("not_agent_owner");
    const bad = await h.app.request(
      "/v1/agents/zzz/label",
      jsonPost({ label: "x" }, { cookie: cookieA }),
    );
    expect(bad.status).toBe(404);
  });
});

async function resetReceipts(h: Harness): Promise<void> {
  await h.pool.query("DELETE FROM receipts");
}
