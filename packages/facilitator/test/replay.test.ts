import type { SettlementResponse } from "@turnstile/shared";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { createLogger } from "../src/logger.js";
import { replayDeadLetters } from "../src/replay.js";
import {
  addWallet,
  buildPayload,
  closePool,
  type Harness,
  harness,
  issue,
  jsonPost,
  resetDb,
  testPool,
} from "./helpers.js";

let h: Harness;

beforeEach(async () => {
  await resetDb(await testPool());
  h = await harness();
});

afterAll(async () => {
  await closePool();
});

const deps = () => ({
  facilitator: h.services.facilitator,
  store: h.store,
  logger: createLogger("silent"),
  metrics: h.metrics,
});

async function deadLetter(policy: Parameters<typeof addWallet>[1] = {}) {
  const agent = addWallet(h.chain, policy);
  const req = await issue(h, agent);
  const built = buildPayload(req, agent);
  h.chain.submitHook = () => ({ ok: false, kind: "unknown", detail: "socket hang up" });
  const res = await h.app.request(
    "/settle",
    jsonPost({ paymentPayload: built.payload, paymentRequirements: req }),
  );
  const body = (await res.json()) as SettlementResponse;
  expect(body.errorReason).toBe("settlement_failed");
  h.chain.submitHook = null;
  return { agent, req, ...built };
}

async function rows() {
  const r = await h.pool.query(
    "SELECT id::text AS id, status, attempts, error FROM settlement_dead_letters ORDER BY id",
  );
  return r.rows as { id: string; status: string; attempts: number; error: string }[];
}

describe("replayDeadLetters", () => {
  it("settles a pending dead letter once the chain answers", async () => {
    const { agent } = await deadLetter();
    const summary = await replayDeadLetters(deps());
    expect(summary).toMatchObject({ replayed: 1, abandoned: 0, pending: 0 });
    const [row] = await rows();
    expect(row?.status).toBe("replayed");
    expect(row?.error).toMatch(/^socket hang up\nreplay: settled in \w+/);
    expect(h.chain.wallets.get(agent.wallet.toBase58())?.policy.vaultBalance).toBe(49_995_000n);
  });

  it("marks a letter replayed without a second debit when the first send had landed", async () => {
    const { agent, auth } = await deadLetter();
    h.chain.land(auth);
    const summary = await replayDeadLetters(deps());
    expect(summary.replayed).toBe(1);
    expect(summary.results[0]?.note).toMatch(/already settled/);
    expect(h.chain.submits).toBe(1);
    expect(h.chain.wallets.get(agent.wallet.toBase58())?.policy.vaultBalance).toBe(49_995_000n);
  });

  it("abandons a letter the program now refuses, with the reason", async () => {
    const { agent } = await deadLetter();
    const wallet = h.chain.wallets.get(agent.wallet.toBase58());
    if (!wallet) throw new Error("fixture missing");
    wallet.policy.allowList = [];
    const summary = await replayDeadLetters(deps());
    expect(summary.abandoned).toBe(1);
    const [row] = await rows();
    expect(row?.status).toBe("abandoned");
    expect(row?.error).toContain("replay: ResourceNotAllowed");
  });

  it("abandons an expired authorization", async () => {
    await deadLetter();
    h.clock.now = new Date(h.clock.now.getTime() + 120_000);
    const summary = await replayDeadLetters(deps());
    expect(summary.results[0]?.note).toContain("authorization_expired");
    expect((await rows())[0]?.status).toBe("abandoned");
  });

  it("keeps a still failing letter pending, then gives up after the attempt limit", async () => {
    await deadLetter();
    h.chain.submitHook = () => ({ ok: false, kind: "unknown", detail: "socket hang up" });
    const first = await replayDeadLetters(deps(), { maxAttempts: 3 });
    expect(first.pending).toBe(1);
    expect((await rows())[0]).toMatchObject({ status: "pending", attempts: 2 });
    const second = await replayDeadLetters(deps(), { maxAttempts: 3 });
    expect(second.abandoned).toBe(1);
    expect((await rows())[0]).toMatchObject({ status: "abandoned", attempts: 3 });
    expect((await replayDeadLetters(deps())).results).toHaveLength(0);
  });
});
