import { describe, expect, it } from "vitest";
import { MemoryRunStore, RunBusyError } from "../src/runner/store.js";

describe("MemoryRunStore", () => {
  it("runs one run at a time and numbers its events from 1", async () => {
    const store = new MemoryRunStore();
    const run = await store.createRun(
      "00000000-0000-4000-8000-000000000001",
      "owner",
      "solana:devnet",
    );
    await expect(
      store.createRun("00000000-0000-4000-8000-000000000002", "owner", "solana:devnet"),
    ).rejects.toBeInstanceOf(RunBusyError);
    const seen: number[] = [];
    const stop = store.subscribe(run.id, (e) => seen.push(e.seq));
    await store.setWallet(run.id, "wallet", 7n);
    await store.append(run.id, "run.failed", { reason: "x", message: "y" } as never);
    await store.finish(run.id, "failed", "y");
    stop();
    expect(seen).toEqual([1]);
    expect((await store.get(run.id))?.status).toBe("failed");
    expect((await store.events(run.id)).map((e) => e.seq)).toEqual([1]);
    expect(await store.events(run.id, 1)).toEqual([]);
    expect(await store.maxWalletId("owner")).toBe(7n);
    expect((await store.latest())?.id).toBe(run.id);
    expect(await store.running()).toBeNull();
  });

  it("keeps only the most recent runs", async () => {
    const store = new MemoryRunStore(2);
    for (let i = 1; i <= 3; i += 1) {
      const id = `00000000-0000-4000-8000-00000000000${i}`;
      await store.createRun(id, "owner", "solana:devnet");
      await store.finish(id, "finished");
    }
    expect(await store.get("00000000-0000-4000-8000-000000000001")).toBeNull();
    expect((await store.latest())?.id).toBe("00000000-0000-4000-8000-000000000003");
  });
});
