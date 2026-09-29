import { EventEmitter } from "node:events";
import type { Pool } from "@turnstile/shared/db";
import type { RunEvent, RunEventMap, RunEventType, RunRecord, RunStatus } from "./events.js";

/** Thrown when a run is already in progress. */
export class RunBusyError extends Error {
  override name = "RunBusyError";
  constructor(readonly runningId: string | null) {
    super("A demo run is already in progress.");
  }
}

interface RunRow {
  id: string;
  status: RunStatus;
  agent_wallet: string | null;
  wallet_id: string | null;
  owner: string;
  network: string;
  started_at: Date;
  finished_at: Date | null;
  error: string | null;
}

interface EventRow {
  run_id: string;
  seq: number;
  type: RunEventType;
  data: RunEventMap[RunEventType];
  created_at: Date;
}

function toRun(r: RunRow): RunRecord {
  return {
    id: r.id,
    status: r.status,
    agentWallet: r.agent_wallet,
    walletId: r.wallet_id,
    owner: r.owner,
    network: r.network,
    startedAt: r.started_at.toISOString(),
    finishedAt: r.finished_at ? r.finished_at.toISOString() : null,
    error: r.error,
  };
}

function toEvent(r: EventRow): RunEvent {
  return {
    runId: r.run_id,
    seq: r.seq,
    type: r.type,
    data: r.data,
    at: r.created_at.toISOString(),
  };
}

const RUN_COLUMNS =
  "id, status, agent_wallet, wallet_id::text AS wallet_id, owner, network, started_at, finished_at, error";

/** Postgres backed run history plus an in-process feed of new events for live streams. */
export class RunStore {
  private readonly feed = new EventEmitter();

  constructor(private readonly pool: Pool) {
    this.feed.setMaxListeners(1000);
  }

  async createRun(id: string, owner: string, network: string): Promise<RunRecord> {
    try {
      const { rows } = await this.pool.query<RunRow>(
        `INSERT INTO demo_runs (id, status, owner, network) VALUES ($1, 'running', $2, $3) RETURNING ${RUN_COLUMNS}`,
        [id, owner, network],
      );
      const row = rows[0];
      if (!row) throw new Error("Postgres returned no row for the new demo run.");
      return toRun(row);
    } catch (err) {
      // The partial unique index allows one running row. A second insert means we are busy.
      if ((err as { code?: string }).code === "23505") {
        const running = await this.running();
        throw new RunBusyError(running?.id ?? null);
      }
      throw err;
    }
  }

  async setWallet(id: string, agentWallet: string, walletId: bigint): Promise<void> {
    await this.pool.query("UPDATE demo_runs SET agent_wallet = $2, wallet_id = $3 WHERE id = $1", [
      id,
      agentWallet,
      walletId.toString(),
    ]);
  }

  async append<T extends RunEventType>(
    runId: string,
    type: T,
    data: RunEventMap[T],
  ): Promise<RunEvent<T>> {
    const { rows } = await this.pool.query<EventRow>(
      `INSERT INTO demo_run_events (run_id, seq, type, data)
       SELECT $1, COALESCE(MAX(seq), 0) + 1, $2, $3::jsonb FROM demo_run_events WHERE run_id = $1
       RETURNING run_id, seq, type, data, created_at`,
      [runId, type, JSON.stringify(data)],
    );
    const row = rows[0];
    if (!row) throw new Error(`Postgres returned no row for event ${type} of run ${runId}.`);
    const event = toEvent(row) as RunEvent<T>;
    this.feed.emit(runId, event);
    return event;
  }

  async finish(id: string, status: Exclude<RunStatus, "running">, error?: string): Promise<void> {
    await this.pool.query(
      "UPDATE demo_runs SET status = $2, finished_at = now(), error = $3 WHERE id = $1",
      [id, status, error ?? null],
    );
  }

  async get(id: string): Promise<RunRecord | null> {
    const { rows } = await this.pool.query<RunRow>(
      `SELECT ${RUN_COLUMNS} FROM demo_runs WHERE id = $1`,
      [id],
    );
    return rows[0] ? toRun(rows[0]) : null;
  }

  async latest(): Promise<RunRecord | null> {
    const { rows } = await this.pool.query<RunRow>(
      `SELECT ${RUN_COLUMNS} FROM demo_runs ORDER BY started_at DESC, id DESC LIMIT 1`,
    );
    return rows[0] ? toRun(rows[0]) : null;
  }

  async running(): Promise<RunRecord | null> {
    const { rows } = await this.pool.query<RunRow>(
      `SELECT ${RUN_COLUMNS} FROM demo_runs WHERE status = 'running' LIMIT 1`,
    );
    return rows[0] ? toRun(rows[0]) : null;
  }

  async events(runId: string, afterSeq = 0): Promise<RunEvent[]> {
    const { rows } = await this.pool.query<EventRow>(
      "SELECT run_id, seq, type, data, created_at FROM demo_run_events WHERE run_id = $1 AND seq > $2 ORDER BY seq",
      [runId, afterSeq],
    );
    return rows.map(toEvent);
  }

  /** Highest wallet id a past run used for this owner, a hint for finding the next free one. */
  async maxWalletId(owner: string): Promise<bigint | null> {
    const { rows } = await this.pool.query<{ max: string | null }>(
      "SELECT MAX(wallet_id)::text AS max FROM demo_runs WHERE owner = $1",
      [owner],
    );
    const max = rows[0]?.max;
    return max ? BigInt(max) : null;
  }

  /** Listens for new events of one run. Returns the function that stops listening. */
  subscribe(runId: string, listener: (event: RunEvent) => void): () => void {
    this.feed.on(runId, listener);
    return () => this.feed.off(runId, listener);
  }
}
