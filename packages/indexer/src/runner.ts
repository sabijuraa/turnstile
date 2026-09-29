import type { Indexer, TickResult } from "./indexer.js";
import type { Logger } from "./logger.js";

export interface RunnerOptions {
  indexer: Indexer;
  /** Wait between ticks when the stream is caught up. */
  pollMs: number;
  /** Longest wait after repeated failures. */
  maxBackoffMs: number;
  logger: Logger;
  /** Called after every tick. Handy for tests and for exiting after a fixed amount of work. */
  onTick?: (result: TickResult) => void;
}

export interface Runner {
  start(): void;
  /** Stops after the tick in flight, if any. Never interrupts a database transaction. */
  stop(): Promise<void>;
  readonly running: boolean;
}

/** Wait before the next tick. Backlog runs at once, errors back off exponentially. */
export function nextDelay(
  result: TickResult,
  failures: number,
  pollMs: number,
  maxBackoffMs: number,
): number {
  if (result.outcome === "error") {
    return Math.min(maxBackoffMs, pollMs * 2 ** Math.min(Math.max(failures - 1, 0), 20));
  }
  return result.remaining > 0 ? 0 : pollMs;
}

export function createRunner(opts: RunnerOptions): Runner {
  let stopped = true;
  let loop: Promise<void> | null = null;
  let wake: (() => void) | null = null;
  let timer: NodeJS.Timeout | undefined;

  const sleep = (ms: number) =>
    new Promise<void>((resolve) => {
      wake = resolve;
      timer = setTimeout(resolve, ms);
    });

  async function run(): Promise<void> {
    while (!stopped) {
      const result = await opts.indexer.tick();
      opts.onTick?.(result);
      if (stopped) break;
      const delay = nextDelay(
        result,
        opts.indexer.status().consecutiveFailures,
        opts.pollMs,
        opts.maxBackoffMs,
      );
      if (result.outcome === "error") {
        opts.logger.warn(
          { retryInMs: delay, error: result.error },
          "backing off after a failed tick",
        );
      }
      if (delay > 0) await sleep(delay);
    }
  }

  return {
    start() {
      if (!stopped) return;
      stopped = false;
      loop = run().catch((err: unknown) => {
        // tick() reports failures as results, so reaching this is a bug worth crashing on.
        opts.logger.fatal({ err }, "indexer loop crashed. Restart the service.");
        process.exitCode = 1;
        stopped = true;
      });
    },
    async stop() {
      stopped = true;
      clearTimeout(timer);
      wake?.();
      await loop;
    },
    get running() {
      return !stopped;
    },
  };
}
