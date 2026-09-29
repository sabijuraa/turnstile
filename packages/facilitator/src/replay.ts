import type { Logger } from "./logger.js";
import type { Metrics } from "./metrics.js";
import type { Facilitator } from "./service.js";
import type { DeadLetter, FacilitatorStore } from "./store/store.js";
import { paymentRequirementsSchema } from "./validation.js";

export interface ReplayOptions {
  /** Dead letters handled per run. */
  limit?: number;
  /** A dead letter still failing after this many attempts is abandoned. */
  maxAttempts?: number;
}

export interface ReplayResult {
  id: string;
  agentWallet: string;
  nonce: string;
  status: "replayed" | "abandoned" | "pending";
  note: string;
}

export interface ReplaySummary {
  replayed: number;
  abandoned: number;
  pending: number;
  results: ReplayResult[];
}

/**
 * Re-submits pending dead letters through the normal settle path, so a letter whose payment
 * already landed resolves as replayed without a second debit.
 */
export async function replayDeadLetters(
  deps: { facilitator: Facilitator; store: FacilitatorStore; logger: Logger; metrics: Metrics },
  opts: ReplayOptions = {},
): Promise<ReplaySummary> {
  const limit = opts.limit ?? 100;
  const maxAttempts = opts.maxAttempts ?? 5;
  const letters = await deps.store.pendingDeadLetters(limit);
  const results: ReplayResult[] = [];
  for (const letter of letters) {
    results.push(await replayOne(deps, letter, maxAttempts));
  }
  const count = (s: ReplayResult["status"]) => results.filter((r) => r.status === s).length;
  return {
    replayed: count("replayed"),
    abandoned: count("abandoned"),
    pending: count("pending"),
    results,
  };
}

async function replayOne(
  deps: { facilitator: Facilitator; store: FacilitatorStore; logger: Logger; metrics: Metrics },
  letter: DeadLetter,
  maxAttempts: number,
): Promise<ReplayResult> {
  const log = deps.logger.child({
    deadLetterId: letter.id,
    agentWallet: letter.agentWallet,
    nonce: letter.nonce,
  });
  const base = { id: letter.id, agentWallet: letter.agentWallet, nonce: letter.nonce };
  const close = async (status: "replayed" | "abandoned", note: string): Promise<ReplayResult> => {
    await deps.store.markDeadLetter(letter.id, status, `replay: ${note}`);
    log.info({ status, note }, "dead letter closed");
    return { ...base, status, note };
  };

  const requirements = paymentRequirementsSchema.safeParse(letter.requirements);
  if (!requirements.success) {
    return close("abandoned", "the stored payment requirements are malformed and cannot be sent");
  }
  const result = await deps.facilitator.settle(letter.payload, requirements.data, log);
  if (result.success) {
    return close(
      "replayed",
      result.alreadySettled
        ? `the payment had already settled in ${result.transaction}`
        : `settled in ${result.transaction}`,
    );
  }
  if (result.errorReason === "settlement_failed") {
    // settle already bumped the attempt count on the same row.
    const attempts = letter.attempts + 1;
    if (attempts >= maxAttempts) {
      return close("abandoned", `still unconfirmed after ${attempts} attempts`);
    }
    deps.metrics.deadLetters.inc({ stage: "replay" });
    log.warn({ attempts }, "dead letter still unconfirmed, left pending");
    return { ...base, status: "pending", note: `still unconfirmed after ${attempts} attempts` };
  }
  return close(
    "abandoned",
    `${result.errorReason ?? "rejected"}, ${result.errorMessage ?? "the payment was refused"}`,
  );
}
