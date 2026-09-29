import { bootstrap } from "./bootstrap.js";
import { createMetrics } from "./metrics.js";
import { replayDeadLetters } from "./replay.js";
import { Facilitator } from "./service.js";

/** Replays pending dead letters once and prints a summary. Exit code 1 when any stay pending. */
async function main(): Promise<void> {
  const rt = await bootstrap();
  const metrics = createMetrics(false);
  const facilitator = new Facilitator({
    config: rt.config,
    chain: rt.chain,
    store: rt.store,
    metrics,
    logger: rt.logger,
    clock: () => new Date(),
  });
  const limitArg = process.argv.find((a) => a.startsWith("--limit="));
  const limit = limitArg ? Number(limitArg.slice("--limit=".length)) : 100;
  try {
    const summary = await replayDeadLetters(
      { facilitator, store: rt.store, logger: rt.logger, metrics },
      { limit: Number.isInteger(limit) && limit > 0 ? limit : 100 },
    );
    for (const r of summary.results) {
      process.stdout.write(
        `${r.status.padEnd(9)} #${r.id} wallet ${r.agentWallet} nonce ${r.nonce} ${r.note}\n`,
      );
    }
    process.stdout.write(
      `replayed ${summary.replayed}, abandoned ${summary.abandoned}, still pending ${summary.pending}\n`,
    );
    process.exitCode = summary.pending > 0 ? 1 : 0;
  } finally {
    await rt.pool.end();
  }
}

main().catch((err: unknown) => {
  console.error("Replay failed. Check the Solana RPC and Postgres, then run it again.", err);
  process.exit(1);
});
