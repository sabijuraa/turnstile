/**
 * The live demo runner. One run creates a fresh agent wallet for the demo owner, pays the demo
 * API until the daily cap stops it, and proves the refusal on chain.
 */
import { PublicKey } from "@solana/web3.js";
import { bytesToHex } from "@turnstile/shared";
import { fetchReceipt, parseProgramError } from "@turnstile/shared/programs";
import { afterAll, describe, expect, it } from "vitest";
import { createChain, loadCatalog, route } from "../src/chain.js";
import { loadDeployment, loadEnv } from "../src/env.js";
import { readSse } from "../src/sse.js";
import { createPool, waitForReceiptRows } from "../src/store.js";

const env = loadEnv();
const deployment = loadDeployment(env.deploymentFile);
const pool = createPool(env.databaseUrl);

afterAll(async () => {
  await pool.end();
});

interface Event<T> {
  runId: string;
  seq: number;
  type: string;
  data: T;
}
interface Amount {
  baseUnits: string;
  display: string;
}
interface Started {
  agentWallet: string;
  policy: {
    perCallCap: Amount;
    dailyCap: Amount;
    pricePerCall: Amount;
    owner: string;
    sessionKey: string;
  };
}
interface Settled {
  index: number;
  amount: Amount;
  receipt: string;
  transaction: string;
  rollingSpend: Amount;
}
interface Refused {
  index: number;
  amount: Amount;
  reason: string;
  facilitatorReason: string;
  failedTransaction: string;
  programLogs: string[];
}
interface Finished {
  settledCalls: number;
  refusedCalls: number;
  totalSpent: Amount;
  receipts: string[];
}

async function startRun(): Promise<string> {
  const deadline = Date.now() + 120_000;
  for (;;) {
    const res = await fetch(`${env.services.demoAgent}/runs`, { method: "POST" });
    const body = (await res.json()) as { runId?: string; error?: { code: string } };
    if (res.status === 202 && body.runId) return body.runId;
    // Someone else's run is in progress. Wait for it rather than fail.
    if (res.status !== 409 || Date.now() > deadline) {
      throw new Error(`POST /runs answered ${res.status}: ${JSON.stringify(body)}`);
    }
    await new Promise((r) => setTimeout(r, 2_000));
  }
}

describe("demo runner (FR17)", () => {
  it("streams six settled calls then a DailyCapExceeded refusal proven on chain", async () => {
    const chain = createChain(env, deployment);
    const catalog = await loadCatalog(env.services.demoApi);
    const price = BigInt(route(catalog, "/v1/summarize").priceBaseUnits);

    const runId = await startRun();
    const messages = await readSse(
      `${env.services.demoAgent}/runs/${runId}/events`,
      (m) => m.event === "run.finished" || m.event === "run.failed",
      180_000,
    );
    const events = messages.map((m) => JSON.parse(m.data) as Event<unknown>);
    expect(messages.map((m) => m.event)).toEqual([
      "run.started",
      ...Array(6).fill("call.settled"),
      "call.refused",
      "run.finished",
    ]);
    expect(events.map((e) => e.seq)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9]);
    expect(new Set(events.map((e) => e.runId))).toEqual(new Set([runId]));

    const started = events[0]?.data as Started;
    const settled = events.slice(1, 7).map((e) => e.data as Settled);
    const refused = events[7]?.data as Refused;
    const finished = events[8]?.data as Finished;
    const agentWallet = new PublicKey(started.agentWallet);
    expect(started.policy.owner).toBe(deployment.demoOwner);
    expect(started.policy.sessionKey).toBe(deployment.demoSession);
    expect(BigInt(started.policy.pricePerCall.baseUnits)).toBe(price);
    // Six calls fit the daily cap exactly and a seventh does not.
    expect(BigInt(started.policy.dailyCap.baseUnits)).toBe(price * 6n);

    settled.forEach((s, i) => {
      expect(s.index).toBe(i + 1);
      expect(BigInt(s.amount.baseUnits)).toBe(price);
      expect(BigInt(s.rollingSpend.baseUnits)).toBe(price * BigInt(i + 1));
    });

    expect(refused.index).toBe(7);
    expect(refused.reason).toBe("DailyCapExceeded");
    expect(refused.facilitatorReason).toBe("DailyCapExceeded");
    expect(BigInt(refused.amount.baseUnits)).toBe(price);
    const failed = await chain.connection.getTransaction(refused.failedTransaction, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!failed?.meta) throw new Error(`${refused.failedTransaction} is not on chain.`);
    expect(failed.meta.err).not.toBeNull();
    const error = parseProgramError(failed.meta.err, failed.meta.logMessages ?? []);
    expect(error?.name).toBe("DailyCapExceeded");
    expect(error?.code).toBe(6004);

    expect(finished.settledCalls).toBe(6);
    expect(finished.refusedCalls).toBe(1);
    expect(BigInt(finished.totalSpent.baseUnits)).toBe(price * 6n);
    expect(finished.receipts).toEqual(settled.map((s) => s.receipt));

    // All six receipts on chain and in the indexer store, with the same transaction.
    const rows = await waitForReceiptRows(pool, finished.receipts);
    for (const [i, s] of settled.entries()) {
      const receipt = await fetchReceipt(chain.connection, new PublicKey(s.receipt));
      if (!receipt) throw new Error(`Receipt ${s.receipt} is not on chain.`);
      expect(receipt.agentWallet.toBase58()).toBe(agentWallet.toBase58());
      expect(receipt.owner.toBase58()).toBe(deployment.demoOwner);
      expect(receipt.sessionKey.toBase58()).toBe(deployment.demoSession);
      expect(receipt.recipient.toBase58()).toBe(deployment.demoRecipient);
      expect(receipt.amount).toBe(price);
      const row = rows[i];
      expect(row?.signature).toBe(s.transaction);
      expect(row?.agent_wallet).toBe(agentWallet.toBase58());
      expect(row?.amount).toBe(receipt.amount.toString());
      expect(row?.nonce).toBe(bytesToHex(receipt.nonce));
      expect(row?.slot).toBe(receipt.slot.toString());
    }
    process.stdout.write(
      `demo run ${runId} wallet ${agentWallet.toBase58()} refused by chain in ${refused.failedTransaction}\n`,
    );
  });
});
