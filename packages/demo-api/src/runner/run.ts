import { randomUUID } from "node:crypto";
import { PublicKey } from "@solana/web3.js";
import {
  type Agent,
  PaymentRejectedError,
  PolicyRefusedError,
  TurnstileAgentError,
} from "@turnstile/sdk-agent";
import { formatUnits, hexToBytes, parseUnits } from "@turnstile/shared";
import type { Catalog } from "../catalog.js";
import type { Logger } from "../logger.js";
import type { RunnerMetrics } from "../metrics.js";
import { PASSAGES } from "../passages.js";
import type { Summary } from "../text/summarize.js";
import { type DemoChain, DemoRunError, type Withdrawal } from "./demo-chain.js";
import type { Amount, DemoPolicyView, RunRecord } from "./events.js";
import { RunBusyError, type RunStore } from "./store.js";

/** The demo policy. The numbers are chosen so six calls at 0.005 settle and the seventh does not. */
export const DEMO_POLICY = {
  funding: "0.10",
  perCallCap: "0.01",
  dailyCap: "0.03",
} as const;

/** Upper bound on calls in one run, in case the price is changed so the cap is never reached. */
export const MAX_CALLS = 12;
const SUMMARY_SENTENCES = 2;
const EXCERPT_CHARS = 240;

export interface RunnerDeps {
  store: RunStore;
  chain: DemoChain;
  logger: Logger;
  metrics: RunnerMetrics;
  owner: PublicKey;
  sessionKey: PublicKey;
  mint: PublicKey;
  mintDecimals: number;
  network: string;
  /** Reads the demo API catalog, which names the paid resources and their price. */
  loadCatalog: () => Promise<Catalog>;
  /** Builds the agent that pays from a freshly created agent wallet. */
  makeAgent: (agentWallet: PublicKey) => Agent;
  /** Where the agent sends its paid calls. */
  demoApiUrl: string;
}

function excerpt(text: string): string {
  if (text.length <= EXCERPT_CHARS) return text;
  const cut = text.slice(0, EXCERPT_CHARS);
  const space = cut.lastIndexOf(" ");
  return `${cut.slice(0, space > 0 ? space : EXCERPT_CHARS)}...`;
}

function refusalMessage(index: number, errorName: string, dailyCap: string): string {
  const why: Record<string, string> = {
    DailyCapExceeded: `it would take the last 24 hours past the daily cap of ${dailyCap}`,
    PerCallCapExceeded: "the price is above the per-call cap",
    ResourceNotAllowed: "the resource and recipient are not on the allow-list",
    InsufficientFunds: "the vault does not hold enough",
  };
  const because = why[errorName];
  return `The settlement program refused call ${index} with ${errorName}${because ? ` because ${because}` : ""}. No funds moved.`;
}

function errorMessage(err: unknown): string {
  return err instanceof Error && err.message ? err.message : String(err);
}

/** Runs demo runs one at a time and records every step. */
export class DemoRunner {
  private active: Promise<void> | null = null;

  constructor(private readonly deps: RunnerDeps) {}

  amount(baseUnits: bigint): Amount {
    return {
      baseUnits: baseUnits.toString(),
      display: formatUnits(baseUnits, this.deps.mintDecimals),
    };
  }

  private units(decimal: string): bigint {
    return parseUnits(decimal, this.deps.mintDecimals);
  }

  /** The policy each run sets up, with the allow-list taken from the demo API catalog. */
  async policy(): Promise<DemoPolicyView> {
    const catalog = await this.deps.loadCatalog();
    return this.policyFrom(catalog);
  }

  private policyFrom(catalog: Catalog): DemoPolicyView {
    const summarize = catalog.routes.find((r) => r.path === "/v1/summarize");
    return {
      perCallCap: this.amount(this.units(DEMO_POLICY.perCallCap)),
      dailyCap: this.amount(this.units(DEMO_POLICY.dailyCap)),
      funding: this.amount(this.units(DEMO_POLICY.funding)),
      pricePerCall: this.amount(BigInt(summarize?.priceBaseUnits ?? "0")),
      allowList: catalog.routes.map((r) => ({
        resource: r.resource,
        resourceId: r.resourceId,
        recipient: catalog.payTo,
      })),
      sessionKey: this.deps.sessionKey.toBase58(),
      owner: this.deps.owner.toBase58(),
      mint: this.deps.mint.toBase58(),
      network: this.deps.network,
    };
  }

  get busy(): boolean {
    return this.active !== null;
  }

  /** Marks runs left in progress by a previous process as failed. */
  async recoverInterrupted(): Promise<RunRecord | null> {
    const stale = await this.deps.store.running();
    if (!stale || this.active) return null;
    const message =
      "The demo agent restarted while this run was in progress. Its wallet keeps any unspent balance. Start a new run.";
    await this.deps.store.append(stale.id, "run.failed", { reason: "interrupted", message });
    await this.deps.store.finish(stale.id, "failed", message);
    return stale;
  }

  /** Starts a run in the background. Throws RunBusyError while another run is in progress. */
  async start(): Promise<RunRecord> {
    if (this.active) throw new RunBusyError((await this.deps.store.running())?.id ?? null);
    const run = await this.deps.store.createRun(
      randomUUID(),
      this.deps.owner.toBase58(),
      this.deps.network,
    );
    const started = performance.now();
    this.active = this.execute(run.id)
      .catch((err: unknown) => {
        this.deps.logger.error({ err, runId: run.id }, "demo run crashed while recording");
      })
      .finally(() => {
        this.deps.metrics.runSeconds.observe((performance.now() - started) / 1000);
        this.active = null;
      });
    return run;
  }

  /** Resolves when the current run, if any, has finished. */
  async idle(): Promise<void> {
    await this.active;
  }

  private async execute(runId: string): Promise<void> {
    const { store, chain, logger, metrics } = this.deps;
    const log = logger.child({ runId });
    const started = performance.now();
    let agentWallet: PublicKey | null = null;
    try {
      const catalog = await this.deps.loadCatalog();
      const policy = this.policyFrom(catalog);
      const summarize = catalog.routes.find((r) => r.path === "/v1/summarize");
      if (!summarize) {
        throw new DemoRunError(
          "catalog_incomplete",
          "The demo API catalog does not list POST /v1/summarize. Check that the demo API is up to date.",
        );
      }
      if (catalog.asset !== this.deps.mint.toBase58()) {
        throw new DemoRunError(
          "catalog_mismatch",
          `The demo API charges in ${catalog.asset} but the deployment mint is ${this.deps.mint.toBase58()}. Point both at the same deployment file.`,
        );
      }
      const funding = BigInt(policy.funding.baseUnits);
      await chain.checkOwnerFunds(funding);

      const hint = await store.maxWalletId(this.deps.owner.toBase58());
      const id = await chain.nextWalletId(hint === null ? 0n : hint + 1n);
      const setup = await chain.createWallet({
        id,
        perCallCap: BigInt(policy.perCallCap.baseUnits),
        dailyCap: BigInt(policy.dailyCap.baseUnits),
        funding,
        sessionKey: this.deps.sessionKey,
        allowList: policy.allowList.map((e) => ({
          resourceId: hexToBytes(e.resourceId),
          recipient: new PublicKey(e.recipient),
        })),
      });
      agentWallet = setup.agentWallet;
      await store.setWallet(runId, setup.agentWallet.toBase58(), setup.walletId);
      await store.append(runId, "run.started", {
        runId,
        agentWallet: setup.agentWallet.toBase58(),
        walletId: setup.walletId.toString(),
        vault: setup.vault.toBase58(),
        policy,
        setupTransaction: setup.signature,
      });
      log.info({ agentWallet: setup.agentWallet.toBase58(), tx: setup.signature }, "run started");

      const agent = this.deps.makeAgent(setup.agentWallet);
      const url = `${this.deps.demoApiUrl}/v1/summarize`;
      const receipts: string[] = [];
      let spent = 0n;
      let refused = 0;
      for (let index = 1; index <= MAX_CALLS; index++) {
        const passage = PASSAGES[(index - 1) % PASSAGES.length];
        if (!passage) break;
        const callStarted = performance.now();
        try {
          const res = await agent.fetch(url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ text: passage.text, sentences: SUMMARY_SENTENCES }),
          });
          if (!res.ok || !res.payment) {
            const text = await res.text();
            throw new DemoRunError(
              "demo_api_error",
              `Call ${index} to the demo API answered ${res.status} without a settled payment. ${text.slice(0, 200)}`,
            );
          }
          const body = (await res.json()) as Summary;
          const latencyMs = Math.round(performance.now() - callStarted);
          metrics.settleSeconds.observe(latencyMs / 1000);
          metrics.calls.inc({ result: "settled" });
          const reading = await chain.readWallet(setup.agentWallet);
          const amount = BigInt(res.payment.amount);
          spent += amount;
          receipts.push(res.payment.receipt);
          await store.append(runId, "call.settled", {
            index,
            amount: this.amount(amount),
            receipt: res.payment.receipt,
            transaction: res.payment.transaction,
            rollingSpend: this.amount(reading.rollingSpend),
            dailyCap: this.amount(reading.dailyCap),
            vaultBalance: this.amount(reading.vaultBalance),
            passage: { title: passage.title, author: passage.author, year: passage.year },
            summaryExcerpt: excerpt(body.summary),
            compressionRatio: body.compressionRatio,
            latencyMs,
          });
        } catch (err) {
          if (!(err instanceof PaymentRejectedError)) throw err;
          await this.proveRefusal(runId, index, err, setup.agentWallet);
          refused++;
          break;
        }
      }
      const withdrawal = await chain.withdrawAll(setup.agentWallet);
      await store.append(runId, "run.finished", {
        settledCalls: receipts.length,
        refusedCalls: refused,
        totalSpent: this.amount(spent),
        withdrawn: this.amount(withdrawal.amount),
        withdrawTransaction: withdrawal.signature,
        receipts,
        durationMs: Math.round(performance.now() - started),
      });
      await store.finish(runId, "finished");
      metrics.runs.inc({ result: "finished" });
      log.info(
        { settled: receipts.length, refused, withdrawn: withdrawal.amount.toString() },
        "run finished",
      );
    } catch (err) {
      await this.fail(runId, err, agentWallet, log);
    }
  }

  /**
   * The facilitator refused. Send the same signed authorization straight to the settlement
   * program, bypassing the facilitator, and record what the chain says.
   */
  private async proveRefusal(
    runId: string,
    index: number,
    rejection: PaymentRejectedError,
    agentWallet: PublicKey,
  ): Promise<void> {
    const { chain, store, metrics } = this.deps;
    const direct = await chain.settleDirect(rejection.authorization, rejection.signature);
    if (!direct.refused) {
      throw new DemoRunError(
        "limit_not_enforced",
        `The facilitator refused call ${index} with ${rejection.reason}, but the settlement program accepted it in ${direct.signature}. The on-chain limit did not hold.`,
      );
    }
    metrics.calls.inc({ result: "refused" });
    const reading = await chain.readWallet(agentWallet);
    await store.append(runId, "call.refused", {
      index,
      amount: this.amount(rejection.authorization.amount),
      reason: direct.errorName,
      message: refusalMessage(
        index,
        direct.errorName,
        formatUnits(reading.dailyCap, this.deps.mintDecimals),
      ),
      facilitatorReason: rejection.reason,
      failedTransaction: direct.signature,
      programLogs: direct.logs,
      rollingSpend: this.amount(reading.rollingSpend),
      dailyCap: this.amount(reading.dailyCap),
    });
  }

  private async fail(
    runId: string,
    err: unknown,
    agentWallet: PublicKey | null,
    log: Logger,
  ): Promise<void> {
    const { chain, store, metrics } = this.deps;
    let reason = "run_error";
    if (err instanceof DemoRunError) reason = err.reason;
    else if (err instanceof PolicyRefusedError) reason = err.reason;
    else if (err instanceof TurnstileAgentError) reason = err.code;
    const message = errorMessage(err);
    log.error({ err, reason }, "run failed");
    metrics.runs.inc({ result: "failed" });
    let withdrawal: Withdrawal | null = null;
    let withdrawError: string | null = null;
    if (agentWallet) {
      try {
        withdrawal = await chain.withdrawAll(agentWallet);
      } catch (wErr) {
        withdrawError = errorMessage(wErr);
        log.error({ err: wErr }, "could not withdraw after a failed run");
      }
    }
    const fullMessage = withdrawError
      ? `${message} The unspent balance is still in agent wallet ${agentWallet?.toBase58()} because the withdrawal failed with ${withdrawError}.`
      : message;
    await store.append(runId, "run.failed", {
      reason,
      message: fullMessage,
      ...(withdrawal
        ? { withdrawn: this.amount(withdrawal.amount), withdrawTransaction: withdrawal.signature }
        : {}),
    });
    await store.finish(runId, "failed", fullMessage);
  }
}
