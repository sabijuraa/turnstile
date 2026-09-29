import { createSolanaReclaimChain } from "./chain/reclaim-solana.js";
import { ConfigError, type LoadedConfig, loadConfig } from "./config.js";
import { createLogger } from "./logger.js";
import { DEFAULT_RECLAIM_BATCH, reclaimReceipts } from "./reclaim.js";

const LAMPORTS_PER_SOL = 1_000_000_000n;

function intArg(name: string): number | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  if (!arg) return undefined;
  const value = Number(arg.slice(name.length + 3));
  if (!Number.isInteger(value) || value < 1) {
    throw new ConfigError(`--${name} must be a whole number of at least 1.`);
  }
  return value;
}

function sol(lamports: bigint): string {
  const whole = lamports / LAMPORTS_PER_SOL;
  const frac = (lamports % LAMPORTS_PER_SOL).toString().padStart(9, "0");
  return `${whole}.${frac}`;
}

/**
 * Closes the receipts this facilitator paid rent for once their retention period has passed.
 * Exit code 1 when any close failed.
 */
async function main(): Promise<void> {
  let loaded: LoadedConfig;
  let batchSize: number;
  let limit: number | undefined;
  try {
    loaded = loadConfig();
    batchSize = intArg("batch") ?? DEFAULT_RECLAIM_BATCH;
    limit = intArg("limit");
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
  const dryRun = process.argv.includes("--dry-run");
  const { config, feePayer } = loaded;
  const logger = createLogger(config.logLevel);
  const chain = createSolanaReclaimChain({
    rpcUrl: config.rpcUrl,
    feePayer,
    settlementProgram: config.settlementProgram,
    logger,
  });
  const summary = await reclaimReceipts(
    { chain, logger },
    { batchSize, ...(limit !== undefined ? { limit } : {}), dryRun },
  );
  for (const b of summary.batches) {
    const status = b.ok ? "closed" : "failed";
    const tail = b.ok ? `${b.lamports} lamports` : (b.detail ?? "");
    process.stdout.write(
      `${status.padEnd(6)} ${b.receipts.length} receipts ${b.signature ?? "no signature"} ${tail}\n`,
    );
  }
  const next =
    summary.nextReclaimableAt === null
      ? "none waiting"
      : `next one closable at unix ${summary.nextReclaimableAt}`;
  process.stdout.write(
    `found ${summary.found}, past retention ${summary.eligible}, retained ${summary.retained} (${next})\n`,
  );
  process.stdout.write(
    dryRun
      ? "dry run, nothing sent\n"
      : `closed ${summary.closed}, failed ${summary.failed}, reclaimed ${summary.lamportsReclaimed} lamports (${sol(summary.lamportsReclaimed)} SOL)\n`,
  );
  process.exitCode = summary.failed > 0 ? 1 : 0;
}

main().catch((err: unknown) => {
  console.error(
    "Receipt reclaim failed. Check SOLANA_RPC_URL and the fee payer balance, then run it again.",
    err,
  );
  process.exit(1);
});
