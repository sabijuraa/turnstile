import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  AGENT_WALLET_PROGRAM_ID,
  authorizationToWire,
  bucketIndex,
  decodeHeader,
  encodeHeader,
  evaluatePayment,
  formatUnits,
  HEADER_PAYMENT_REQUIRED,
  HEADER_PAYMENT_SIGNATURE,
  hexToBytes,
  type PaymentAuthorization,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  type PolicyState,
  parseUnits,
  SETTLEMENT_PROGRAM_ID,
  type SettlementResponse,
  STABLECOIN_DECIMALS,
  signAuthorization,
  X402_VERSION,
} from "@turnstile/shared";
import bs58 from "bs58";
import { chainWalletStateSource } from "./chain.js";
import {
  PaymentRejectedError,
  PolicyRefusedError,
  type RefusalReason,
  TurnstileAgentError,
} from "./errors.js";
import { readPaymentRequired, readSettlementResponse, selectRequirement } from "./requirements.js";
import type { WalletSnapshot, WalletStateSource } from "./state.js";
import type { Agent, AgentOptions, PaidResponse, PaymentEvent, PaymentInfo } from "./types.js";

const DEFAULT_POLICY_TTL_MS = 15_000;

interface LocalSpend {
  unix: bigint;
  amount: bigint;
}

function toPublicKey(value: string | PublicKey, name: string): PublicKey {
  if (value instanceof PublicKey) return value;
  try {
    return new PublicKey(value);
  } catch (err) {
    throw new TurnstileAgentError("invalid_option", `${name} is not a valid Solana address.`, {
      cause: err,
    });
  }
}

function toKeypair(value: Keypair | Uint8Array): Keypair {
  if (value instanceof Keypair) return value;
  if (value.length !== 64) {
    throw new TurnstileAgentError(
      "invalid_option",
      "sessionKey must be a Keypair or a 64 byte Solana secret key.",
    );
  }
  try {
    return Keypair.fromSecretKey(value);
  } catch (err) {
    throw new TurnstileAgentError(
      "invalid_option",
      "sessionKey is not a valid Solana secret key. Its public half does not match its seed.",
      { cause: err },
    );
  }
}

/**
 * Why a paid retry was refused. A Turnstile paywall puts `reason` and `message` next to the
 * fresh requirements in the 402 body. PAYMENT-RESPONSE carries `errorReason` when present.
 */
async function rejectionReason(
  res: Response,
  settlement: SettlementResponse | null,
): Promise<{ reason: string; message?: string }> {
  let body: unknown = null;
  const header = res.headers.get(HEADER_PAYMENT_REQUIRED);
  try {
    body = header ? decodeHeader<unknown>(header) : await res.clone().json();
  } catch {
    // A refusal without a readable body still counts as a refusal. The reason falls back below.
    body = null;
  }
  const record = typeof body === "object" && body !== null ? (body as Record<string, unknown>) : {};
  const reason =
    (typeof record.reason === "string" && record.reason) ||
    settlement?.errorReason ||
    (typeof record.error === "string" && record.error) ||
    "payment_rejected";
  const message = typeof record.message === "string" ? record.message : undefined;
  return message ? { reason, message } : { reason };
}

function attachPayment(res: Response, payment: PaymentInfo | undefined): PaidResponse {
  if (payment) Object.defineProperty(res, "payment", { value: payment, enumerable: true });
  return res as PaidResponse;
}

/**
 * Creates an agent that pays x402 `turnstile-policy` 402s from an agent wallet with a session
 * key. Every payment is checked against the wallet policy before the key signs anything.
 */
export function createAgent(options: AgentOptions): Agent {
  const agentWallet = toPublicKey(options.agentWallet, "agentWallet");
  const session = toKeypair(options.sessionKey);
  const settlementProgram = options.settlementProgram
    ? toPublicKey(options.settlementProgram, "settlementProgram")
    : SETTLEMENT_PROGRAM_ID;
  const agentWalletProgram = options.agentWalletProgram
    ? toPublicKey(options.agentWalletProgram, "agentWalletProgram")
    : AGENT_WALLET_PROGRAM_ID;
  const decimals = options.mintDecimals ?? STABLECOIN_DECIMALS;
  let maxPerCall: bigint | null = null;
  if (options.maxPerCall !== undefined) {
    try {
      maxPerCall = parseUnits(options.maxPerCall, decimals);
    } catch (err) {
      throw new TurnstileAgentError(
        "invalid_option",
        `maxPerCall must be a decimal token amount such as "0.01". ${(err as Error).message}.`,
        { cause: err },
      );
    }
  }
  const localPolicyCheck = options.localPolicyCheck ?? true;
  const ttlMs = options.policyTtlMs ?? DEFAULT_POLICY_TTL_MS;
  const now = options.now ?? Date.now;
  const doFetch = options.fetch ?? globalThis.fetch.bind(globalThis);

  let source: WalletStateSource | undefined = options.stateSource;
  const stateSource = (): WalletStateSource => {
    if (source) return source;
    const connection =
      options.connection ??
      (options.rpcUrl ? new Connection(options.rpcUrl, "confirmed") : undefined);
    if (!connection) {
      throw new TurnstileAgentError(
        "invalid_option",
        "Pass rpcUrl or connection so the agent can read its wallet from the chain.",
      );
    }
    source = chainWalletStateSource(connection, agentWallet, agentWalletProgram);
    return source;
  };
  // Fail at construction, not at the first payment, when no chain reader can be built.
  stateSource();

  let cached: { snapshot: WalletSnapshot; at: number } | null = null;
  let inflight: Promise<WalletSnapshot> | null = null;
  /** Payments this process settled since the last chain read. */
  let localSpends: LocalSpend[] = [];
  /** Payments signed and not yet answered. Counted so concurrent calls cannot overspend. */
  const reserved = new Map<symbol, LocalSpend>();

  async function wallet(opts: { refresh?: boolean } = {}): Promise<WalletSnapshot> {
    if (!opts.refresh && cached && now() - cached.at < ttlMs) return cached.snapshot;
    if (inflight) return inflight;
    inflight = stateSource()
      .load()
      .then((snapshot) => {
        cached = { snapshot, at: now() };
        localSpends = [];
        return snapshot;
      })
      .finally(() => {
        inflight = null;
      });
    return inflight;
  }

  function invalidate(): void {
    cached = null;
  }

  /** The chain policy plus what this process spent or reserved since reading it. */
  function effectivePolicy(snapshot: WalletSnapshot): PolicyState {
    const extra = [...localSpends, ...reserved.values()];
    let spent = 0n;
    for (const s of extra) spent += s.amount;
    const balance = snapshot.policy.vaultBalance - spent;
    return {
      ...snapshot.policy,
      spendBuckets: [
        ...snapshot.policy.spendBuckets,
        ...extra.map((s) => ({ index: bucketIndex(s.unix), amount: s.amount })),
      ],
      vaultBalance: balance > 0n ? balance : 0n,
    };
  }

  function emit(event: PaymentEvent): void {
    options.onPayment?.(event);
  }

  function refuse(reason: RefusalReason, message: string, resource: string, amount: bigint): never {
    emit({ type: "refused", reason, message, resource, amount: amount.toString() });
    throw new PolicyRefusedError(reason, message, resource, amount);
  }

  function buildAuthorization(
    requirement: PaymentRequirements,
    snapshot: WalletSnapshot,
  ): PaymentAuthorization {
    return {
      agentWallet,
      sessionKey: session.publicKey,
      recipient: toPublicKey(requirement.payTo, "payTo"),
      mint: snapshot.mint,
      amount: BigInt(requirement.amount),
      resourceId: hexToBytes(requirement.extra.resourceId),
      nonce: hexToBytes(requirement.extra.nonce),
      expiresAt: BigInt(requirement.extra.expiresAt),
    };
  }

  /** Every check that happens before the session key is used. Throws PolicyRefusedError. */
  function checkBeforeSigning(auth: PaymentAuthorization, resource: string, snap: WalletSnapshot) {
    const nowUnix = BigInt(Math.floor(now() / 1000));
    if (maxPerCall !== null && auth.amount > maxPerCall) {
      refuse(
        "LocalCapExceeded",
        `The price ${formatUnits(auth.amount, decimals)} is above this agent's local cap of ${formatUnits(maxPerCall, decimals)} per call.`,
        resource,
        auth.amount,
      );
    }
    if (auth.expiresAt <= nowUnix) {
      refuse(
        "AuthorizationExpired",
        "The payment requirements expired before the agent could sign. Request the resource again.",
        resource,
        auth.amount,
      );
    }
    if (!localPolicyCheck) return;
    const decision = evaluatePayment(
      effectivePolicy(snap),
      {
        sessionKey: auth.sessionKey,
        amount: auth.amount,
        resourceId: auth.resourceId,
        recipient: auth.recipient,
      },
      nowUnix,
    );
    if (!decision.ok) refuse(decision.reason, decision.message, resource, auth.amount);
  }

  async function pay(
    request: Request,
    required: PaymentRequired,
    snap: WalletSnapshot,
  ): Promise<PaidResponse> {
    const requirement = selectRequirement(required, snap.mint, settlementProgram);
    const auth = buildAuthorization(requirement, snap);
    checkBeforeSigning(auth, requirement.resource, snap);

    const signature = signAuthorization(auth, session.secretKey, settlementProgram);
    const payload: PaymentPayload = {
      x402Version: X402_VERSION,
      resource: required.resource,
      accepted: requirement,
      payload: { authorization: authorizationToWire(auth), signature: bs58.encode(signature) },
    };
    const headers = new Headers(request.headers);
    headers.set(HEADER_PAYMENT_SIGNATURE, encodeHeader(payload));
    const retry = new Request(request, { headers });

    const token = Symbol("payment");
    reserved.set(token, { unix: BigInt(Math.floor(now() / 1000)), amount: auth.amount });
    let res: Response;
    try {
      res = await doFetch(retry);
    } catch (err) {
      // The payment may or may not have settled. Read the chain again before the next one.
      invalidate();
      throw err;
    } finally {
      reserved.delete(token);
    }

    const settlement = readSettlementResponse(res);
    const nonceHex = requirement.extra.nonce;
    if (res.status === 402 || (settlement && !settlement.success)) {
      invalidate();
      const why = await rejectionReason(res, settlement);
      const reason = why.reason;
      const message =
        why.message ??
        `The server refused the signed payment for ${requirement.resource} with ${reason}.`;
      emit({
        type: "rejected",
        reason,
        message,
        resource: requirement.resource,
        amount: auth.amount.toString(),
        status: res.status,
      });
      throw new PaymentRejectedError(reason, message, res.status, auth, signature, payload);
    }
    if (!settlement) {
      // Answered without saying whether it settled. Trust the chain on the next call.
      invalidate();
      return attachPayment(res, undefined);
    }
    localSpends.push({ unix: BigInt(Math.floor(now() / 1000)), amount: auth.amount });
    const payment: PaymentInfo = {
      receipt: settlement.receipt ?? "",
      transaction: settlement.transaction,
      amount: auth.amount.toString(),
      resource: requirement.resource,
      network: settlement.network,
      payer: settlement.payer,
      nonce: nonceHex,
      alreadySettled: settlement.alreadySettled === true,
    };
    emit({ type: "settled", payment });
    return attachPayment(res, payment);
  }

  async function agentFetch(
    input: string | URL | Request,
    init?: RequestInit,
  ): Promise<PaidResponse> {
    const template = new Request(input, init);
    const first = await doFetch(template.clone());
    if (first.status !== 402) return attachPayment(first, undefined);
    const required = await readPaymentRequired(first);
    const snap = await wallet();
    // The first response is replaced by the paid one. Free its body.
    await first.body?.cancel();
    return pay(template, required, snap);
  }

  return {
    fetch: agentFetch,
    agentWallet,
    sessionPublicKey: session.publicKey,
    wallet,
  };
}
