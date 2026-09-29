import type { PublicKey } from "@solana/web3.js";
import {
  authorizationFromWire,
  bytesEqual,
  bytesToHex,
  canonicalResource,
  evaluatePayment,
  formatUnits,
  type PaymentAuthorization,
  type PaymentPayload,
  type PaymentRequirements,
  parseUnits,
  randomNonce,
  receiptAddress,
  resourceId,
  SCHEME,
  type SettlementResponse,
  type SupportedResponse,
  type VerifyResponse,
  validatePaymentPayloadShape,
  verifyAuthorizationSignature,
  X402_VERSION,
} from "@turnstile/shared";
import bs58 from "bs58";
import type { ReceiptSnapshot, SettlementChain } from "./chain/types.js";
import type { Config } from "./config.js";
import { ApiError } from "./errors.js";
import type { Logger } from "./logger.js";
import type { Metrics } from "./metrics.js";
import { reasonMessage } from "./reasons.js";
import type { FacilitatorStore } from "./store/store.js";

const U64_MAX = (1n << 64n) - 1n;

export interface RequirementsInput {
  resource: string;
  /** Base units as a decimal integer string. Exactly one of amount and price. */
  amount?: string;
  /** Decimal price in whole tokens, for example "0.005". */
  price?: string;
  payTo: string;
  description: string;
  mimeType: string;
  maxTimeoutSeconds?: number;
  /** Optional. When set it must be this facilitator's mint. */
  asset?: string;
}

export interface FacilitatorDeps {
  config: Config;
  chain: SettlementChain;
  store: FacilitatorStore;
  metrics: Metrics;
  logger: Logger;
  clock: () => Date;
}

/** A payment that passed every offline check. */
interface Checked {
  payload: PaymentPayload;
  requirements: PaymentRequirements;
  auth: PaymentAuthorization;
  signature: Uint8Array;
  receipt: PublicKey;
}

type Refusal = { ok: false; reason: string; message: string; payer?: string };
type Step<T> = { ok: true; value: T } | Refusal;

function refuse(reason: string, payer?: string, message?: string): Refusal {
  return { ok: false, reason, message: message ?? reasonMessage(reason), payer };
}

function receiptMatches(r: ReceiptSnapshot, a: PaymentAuthorization): boolean {
  return (
    r.agentWallet.equals(a.agentWallet) &&
    r.sessionKey.equals(a.sessionKey) &&
    r.recipient.equals(a.recipient) &&
    r.mint.equals(a.mint) &&
    r.amount === a.amount &&
    bytesEqual(r.resourceId, a.resourceId) &&
    bytesEqual(r.nonce, a.nonce)
  );
}

/**
 * The facilitator logic, independent of HTTP. Stateless apart from the store, so any number
 * of instances can serve the same traffic.
 */
export class Facilitator {
  constructor(private readonly d: FacilitatorDeps) {}

  private nowUnix(): bigint {
    return BigInt(Math.floor(this.d.clock().getTime() / 1000));
  }

  supported(): SupportedResponse {
    const c = this.d.config;
    return {
      kinds: [
        {
          x402Version: X402_VERSION,
          scheme: SCHEME,
          network: c.caip2,
          extra: {
            settlementProgram: c.settlementProgram.toBase58(),
            agentWalletProgram: c.agentWalletProgram.toBase58(),
            asset: c.mint.toBase58(),
          },
        },
      ],
    };
  }

  async requirements(input: RequirementsInput, log: Logger): Promise<PaymentRequirements> {
    const c = this.d.config;
    if (input.asset !== undefined && input.asset !== c.mint.toBase58()) {
      throw new ApiError(
        400,
        "unsupported_asset",
        `This facilitator settles ${c.mint.toBase58()} only. Drop asset or set it to that mint.`,
      );
    }
    let amount: bigint;
    if (input.amount !== undefined) {
      amount = BigInt(input.amount);
    } else if (input.price !== undefined) {
      try {
        amount = parseUnits(input.price, c.mintDecimals);
      } catch (err) {
        throw new ApiError(400, "invalid_price", `${(err as Error).message}.`);
      }
    } else {
      throw new ApiError(400, "invalid_request", "Send either amount or price.");
    }
    if (amount <= 0n || amount > U64_MAX) {
      throw new ApiError(
        400,
        "invalid_amount",
        "The amount must be above zero and fit in 64 bits. Check the route price.",
      );
    }
    let resource: string;
    try {
      resource = canonicalResource(input.resource);
    } catch {
      throw new ApiError(
        400,
        "invalid_resource",
        "resource must be the absolute URL of the paid route, for example https://api.example.com/v1/summarize.",
      );
    }
    const timeout = input.maxTimeoutSeconds ?? c.defaultTimeoutSeconds;
    const rid = bytesToHex(resourceId(resource));
    const expiresAt = this.nowUnix() + BigInt(timeout);
    const symbol = typeof c.deployment.mintSymbol === "string" ? ` ${c.deployment.mintSymbol}` : "";
    const requirements: PaymentRequirements = {
      scheme: SCHEME,
      network: c.caip2,
      amount: amount.toString(),
      asset: c.mint.toBase58(),
      payTo: input.payTo,
      maxTimeoutSeconds: timeout,
      resource,
      description: input.description,
      mimeType: input.mimeType,
      extra: {
        resourceId: rid,
        nonce: bytesToHex(randomNonce()),
        settlementProgram: c.settlementProgram.toBase58(),
        agentWalletProgram: c.agentWalletProgram.toBase58(),
        facilitator: c.publicUrl,
        expiresAt: expiresAt.toString(),
        displayAmount: `${formatUnits(amount, c.mintDecimals)}${symbol}`,
      },
    };
    try {
      await this.d.store.upsertResource(rid, resource);
    } catch (err) {
      // Receipts fall back to the resource id when the name is missing. Payments must not stop.
      log.warn({ err, resourceId: rid }, "could not record the resource name");
    }
    this.d.metrics.requirementsIssued.inc();
    return requirements;
  }

  /** Checks that need no chain access. Expiry is separate so settle can answer replays. */
  private checkOffline(rawPayload: unknown, req: PaymentRequirements): Step<Checked> {
    const c = this.d.config;
    const shape = validatePaymentPayloadShape(rawPayload);
    if (shape)
      return refuse("invalid_payload", undefined, `${shape} ${reasonMessage("invalid_payload")}`);
    const payload = rawPayload as PaymentPayload;

    let auth: PaymentAuthorization;
    try {
      auth = authorizationFromWire(payload.payload.authorization);
    } catch (err) {
      return refuse(
        "invalid_payload",
        undefined,
        `The authorization is malformed, ${(err as Error).message}. ${reasonMessage("invalid_payload")}`,
      );
    }
    const payer = auth.agentWallet.toBase58();

    let signature: Uint8Array;
    try {
      signature = bs58.decode(payload.payload.signature);
    } catch {
      return refuse("invalid_payload", payer, "payload.signature is not base58. Sign again.");
    }
    if (signature.length !== 64) {
      return refuse("invalid_signature", payer);
    }

    // The requirements must be ones this facilitator could have issued.
    let expectedRid: string;
    try {
      expectedRid = bytesToHex(resourceId(canonicalResource(req.resource)));
    } catch {
      return refuse("unsupported_requirements", payer);
    }
    if (
      req.scheme !== SCHEME ||
      req.network !== c.caip2 ||
      req.asset !== c.mint.toBase58() ||
      req.extra.settlementProgram !== c.settlementProgram.toBase58() ||
      req.extra.agentWalletProgram !== c.agentWalletProgram.toBase58() ||
      req.extra.resourceId !== expectedRid
    ) {
      return refuse("unsupported_requirements", payer);
    }

    // What the client accepted must equal what the server asks for, on every economic field.
    const a = payload.accepted;
    const ax = (a.extra ?? {}) as Partial<PaymentRequirements["extra"]>;
    if (
      a.scheme !== req.scheme ||
      a.network !== req.network ||
      a.amount !== req.amount ||
      a.asset !== req.asset ||
      a.payTo !== req.payTo ||
      a.resource !== req.resource ||
      ax.resourceId !== req.extra.resourceId ||
      ax.nonce !== req.extra.nonce
    ) {
      return refuse("requirements_mismatch", payer);
    }

    // The signed authorization must be for exactly these terms.
    if (
      auth.amount !== BigInt(req.amount) ||
      auth.mint.toBase58() !== req.asset ||
      auth.recipient.toBase58() !== req.payTo ||
      bytesToHex(auth.resourceId) !== req.extra.resourceId ||
      bytesToHex(auth.nonce) !== req.extra.nonce
    ) {
      return refuse("authorization_mismatch", payer);
    }

    if (!verifyAuthorizationSignature(auth, signature, c.settlementProgram)) {
      return refuse("invalid_signature", payer);
    }

    const [receipt] = receiptAddress(auth.agentWallet, auth.nonce, c.settlementProgram);
    return { ok: true, value: { payload, requirements: req, auth, signature, receipt } };
  }

  private checkExpiry(p: Checked): Refusal | null {
    const now = this.nowUnix();
    const reqExpiry = BigInt(p.requirements.extra.expiresAt);
    if (now >= p.auth.expiresAt || now > reqExpiry) {
      return refuse("authorization_expired", p.auth.agentWallet.toBase58());
    }
    return null;
  }

  /** The chain side of verification. Reads the wallet, applies the policy, then simulates. */
  private async checkOnChain(p: Checked, receiptKnownAbsent: boolean): Promise<Refusal | null> {
    const payer = p.auth.agentWallet.toBase58();
    const [existing, wallet] = await Promise.all([
      receiptKnownAbsent ? Promise.resolve(null) : this.d.chain.loadReceipt(p.receipt),
      this.d.chain.loadWallet(p.auth.agentWallet),
    ]);
    if (existing) return refuse("NonceAlreadyUsed", payer);
    if (!wallet) return refuse("wallet_not_found", payer);
    if (!wallet.mint.equals(p.auth.mint)) return refuse("AccountMismatch", payer);
    const decision = evaluatePayment(
      wallet.policy,
      {
        sessionKey: p.auth.sessionKey,
        amount: p.auth.amount,
        resourceId: p.auth.resourceId,
        recipient: p.auth.recipient,
      },
      this.nowUnix(),
    );
    if (!decision.ok) return refuse(decision.reason, payer);
    const sim = await this.d.chain.simulateSettle(p.auth, p.signature);
    if (!sim.ok) return refuse(sim.reason, payer);
    return null;
  }

  async verify(
    rawPayload: unknown,
    req: PaymentRequirements,
    log: Logger,
  ): Promise<VerifyResponse> {
    const result = await this.runVerify(rawPayload, req, log);
    this.d.metrics.verifyResults.inc({
      result: result.isValid ? "valid" : (result.invalidReason ?? "unknown"),
    });
    return result;
  }

  private async runVerify(
    rawPayload: unknown,
    req: PaymentRequirements,
    log: Logger,
  ): Promise<VerifyResponse> {
    const offline = this.checkOffline(rawPayload, req);
    if (!offline.ok) return this.invalid(offline, log);
    const p = offline.value;
    const plog = this.paymentLog(log, p);
    const expired = this.checkExpiry(p);
    if (expired) return this.invalid(expired, plog);
    const refusal = await this.checkOnChain(p, false);
    if (refusal) return this.invalid(refusal, plog);
    plog.info("payment verified");
    return { isValid: true, payer: p.auth.agentWallet.toBase58() };
  }

  private invalid(r: Refusal, log: Logger): VerifyResponse {
    log.info({ reason: r.reason }, "payment invalid");
    return {
      isValid: false,
      invalidReason: r.reason,
      invalidMessage: r.message,
      ...(r.payer ? { payer: r.payer } : {}),
    };
  }

  private paymentLog(log: Logger, p: Checked): Logger {
    return log.child({
      nonce: bytesToHex(p.auth.nonce),
      agentWallet: p.auth.agentWallet.toBase58(),
      receipt: p.receipt.toBase58(),
    });
  }

  async settle(
    rawPayload: unknown,
    req: PaymentRequirements,
    log: Logger,
  ): Promise<SettlementResponse> {
    const started = performance.now();
    const { response, outcome } = await this.runSettle(rawPayload, req, log);
    this.d.metrics.settlements.inc({ outcome });
    this.d.metrics.settleLatency.observe({ outcome }, (performance.now() - started) / 1000);
    return response;
  }

  private failure(r: Refusal, log: Logger): { response: SettlementResponse; outcome: string } {
    log.info({ reason: r.reason }, "settlement refused");
    return {
      outcome: "rejected",
      response: {
        success: false,
        transaction: "",
        network: this.d.config.caip2,
        payer: r.payer ?? "",
        errorReason: r.reason,
        errorMessage: r.message,
      },
    };
  }

  private async alreadySettled(
    p: Checked,
    receipt: ReceiptSnapshot,
    log: Logger,
    knownSignature?: string,
  ): Promise<{ response: SettlementResponse; outcome: string }> {
    const payer = p.auth.agentWallet.toBase58();
    if (!receiptMatches(receipt, p.auth)) {
      return this.failure(refuse("NonceAlreadyUsed", payer), log);
    }
    const signature = knownSignature ?? (await this.d.chain.receiptSignature(p.receipt)) ?? "";
    log.info({ signature }, "payment was already settled");
    return {
      outcome: "already_settled",
      response: {
        success: true,
        transaction: signature,
        network: this.d.config.caip2,
        payer,
        receipt: p.receipt.toBase58(),
        alreadySettled: true,
      },
    };
  }

  private async runSettle(
    rawPayload: unknown,
    req: PaymentRequirements,
    log: Logger,
  ): Promise<{ response: SettlementResponse; outcome: string }> {
    const offline = this.checkOffline(rawPayload, req);
    if (!offline.ok) return this.failure(offline, log);
    const p = offline.value;
    const plog = this.paymentLog(log, p);
    const payer = p.auth.agentWallet.toBase58();

    // Idempotency. A settled nonce answers with its original receipt, even after expiry.
    const existing = await this.d.chain.loadReceipt(p.receipt);
    if (existing) return this.alreadySettled(p, existing, plog);

    const expired = this.checkExpiry(p);
    if (expired) return this.failure(expired, plog);
    const refusal = await this.checkOnChain(p, true);
    if (refusal) return this.failure(refusal, plog);

    const sent = await this.d.chain.submitSettle(p.auth, p.signature);
    if (sent.ok) {
      plog.info({ signature: sent.signature }, "payment settled");
      return {
        outcome: "settled",
        response: {
          success: true,
          transaction: sent.signature,
          network: this.d.config.caip2,
          payer,
          receipt: p.receipt.toBase58(),
        },
      };
    }

    // A concurrent settle of the same nonce may have won, or a timed out send may have landed.
    const landed = await this.d.chain.loadReceipt(p.receipt).catch((err: unknown) => {
      plog.warn({ err }, "could not re-read the receipt after a failed send");
      return null;
    });
    if (landed) {
      return this.alreadySettled(
        p,
        landed,
        plog,
        sent.kind === "unknown" ? sent.signature : undefined,
      );
    }
    if (sent.kind === "rejected") {
      plog.info({ detail: sent.detail }, "program rejected the settlement");
      return this.failure(refuse(sent.reason, payer), plog);
    }

    let recorded: { id: string; attempts: number };
    try {
      recorded = await this.d.store.recordDeadLetter({
        agentWallet: payer,
        nonce: bytesToHex(p.auth.nonce),
        payload: p.payload,
        requirements: p.requirements,
        error: sent.detail,
      });
    } catch (err) {
      // Keep everything needed to replay by hand in the log, since the table is out of reach.
      plog.error(
        { err, detail: sent.detail, payload: p.payload, requirements: p.requirements },
        "settlement outcome unknown and the dead-letter write failed",
      );
      throw new ApiError(
        503,
        "dead_letter_unavailable",
        "The settlement could not be confirmed and the replay queue is unreachable. Retry the same payment later, it will not be charged twice.",
      );
    }
    const { id, attempts } = recorded;
    this.d.metrics.deadLetters.inc({ stage: "settle" });
    plog.error(
      { deadLetterId: id, attempts, detail: sent.detail, signature: sent.signature },
      "settlement outcome unknown, written to dead letters",
    );
    return {
      outcome: "dead_lettered",
      response: {
        success: false,
        transaction: sent.signature ?? "",
        network: this.d.config.caip2,
        payer,
        errorReason: "settlement_failed",
        errorMessage: reasonMessage("settlement_failed"),
      },
    };
  }
}
