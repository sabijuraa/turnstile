import {
  type AccountInfo,
  type Commitment,
  Connection,
  type Keypair,
  type PublicKey,
  type TransactionError,
  type TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import type { PaymentAuthorization } from "@turnstile/shared";
import bs58 from "bs58";
import { ChainUnavailableError } from "../errors.js";
import type { Logger } from "../logger.js";
import type {
  ReceiptSnapshot,
  SettlementChain,
  SimulateOutcome,
  SubmitOutcome,
  WalletSnapshot,
} from "./types.js";

/** Program specific encoding. Kept apart so the transport logic stays generic. */
export interface ProgramCodec {
  /** The Ed25519 check followed by settle, in that order. */
  settleInstructions(
    auth: PaymentAuthorization,
    signature: Uint8Array,
    feePayer: PublicKey,
  ): TransactionInstruction[];
  /** Decodes an agent wallet account. Vault balance is filled in by the adapter. */
  decodeWallet(address: PublicKey, data: Buffer): WalletSnapshot;
  decodeReceipt(data: Buffer): ReceiptSnapshot;
  /** Name of a custom program error code, for either program. */
  errorName(code: number): string | undefined;
}

export interface SolanaChainOptions {
  rpcUrl: string;
  wsUrl?: string;
  feePayer: Keypair;
  codec: ProgramCodec;
  agentWalletProgram: PublicKey;
  settlementProgram: PublicKey;
  logger: Logger;
  /** Give up waiting for confirmation after this long. Default 45 seconds. */
  confirmTimeoutMs?: number;
  /** Blockhashes are reused for this long. Default 5 seconds. */
  blockhashTtlMs?: number;
  connection?: Connection;
}

const COMMITMENT: Commitment = "confirmed";
const POLL_MS = 150;
const RESEND_MS = 2000;

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

type Named = { kind: "named"; reason: string; detail: string } | { kind: "other"; detail: string };

/**
 * Turns a transaction error into a program error name. The Ed25519 instruction sits at
 * index 0, so a failure there means the signature did not verify.
 */
export function classifyError(
  err: TransactionError,
  logs: string[] | null | undefined,
  errorName: (code: number) => string | undefined,
): Named {
  const detail = JSON.stringify(err);
  if (typeof err === "object" && err !== null && "InstructionError" in err) {
    const ie = (err as { InstructionError: [number, unknown] }).InstructionError;
    const [index, inner] = ie;
    if (index === 0) return { kind: "named", reason: "invalid_signature", detail };
    if (typeof inner === "object" && inner !== null && "Custom" in inner) {
      const code = (inner as { Custom: number }).Custom;
      const name = errorName(code) ?? fromLogs(logs);
      if (name) return { kind: "named", reason: name, detail };
    }
    const logged = fromLogs(logs);
    if (logged) return { kind: "named", reason: logged, detail };
    return { kind: "named", reason: "settlement_simulation_failed", detail };
  }
  return { kind: "other", detail };
}

/** Anchor logs `Error Code: <Name>` for every program error, including ones from a CPI. */
function fromLogs(logs: string[] | null | undefined): string | undefined {
  if (!logs) return undefined;
  for (let i = logs.length - 1; i >= 0; i--) {
    const m = /Error Code: (\w+)/.exec(logs[i] ?? "");
    if (m?.[1]) return m[1];
  }
  return undefined;
}

/** Reads the amount of an SPL token account without pulling in the full layout. */
function tokenAmount(info: AccountInfo<Buffer>): bigint {
  if (info.data.length < 72) return 0n;
  return info.data.readBigUInt64LE(64);
}

/**
 * The real chain. The fee payer key signs as fee payer and nothing else. It is never logged.
 */
export function createSolanaChain(opts: SolanaChainOptions): SettlementChain {
  const connection =
    opts.connection ??
    new Connection(opts.rpcUrl, {
      commitment: COMMITMENT,
      ...(opts.wsUrl ? { wsEndpoint: opts.wsUrl } : {}),
    });
  const feePayer = opts.feePayer;
  const confirmTimeoutMs = opts.confirmTimeoutMs ?? 45_000;
  const blockhashTtlMs = opts.blockhashTtlMs ?? 5_000;

  let cached: {
    at: number;
    value: Promise<{ blockhash: string; lastValidBlockHeight: number }>;
  } | null = null;

  /** One shared fetch per TTL window. Concurrent callers never block each other. */
  function latestBlockhash(): Promise<{ blockhash: string; lastValidBlockHeight: number }> {
    const now = Date.now();
    if (!cached || now - cached.at > blockhashTtlMs) {
      const value = connection.getLatestBlockhash(COMMITMENT);
      cached = { at: now, value };
      value.catch(() => {
        if (cached?.value === value) cached = null;
      });
    }
    return cached.value;
  }

  async function rpc<T>(what: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw new ChainUnavailableError(`${what} failed, ${describe(err)}`);
    }
  }

  function buildTx(
    auth: PaymentAuthorization,
    signature: Uint8Array,
    blockhash: string,
  ): VersionedTransaction {
    const message = new TransactionMessage({
      payerKey: feePayer.publicKey,
      recentBlockhash: blockhash,
      instructions: opts.codec.settleInstructions(auth, signature, feePayer.publicKey),
    }).compileToLegacyMessage();
    return new VersionedTransaction(message);
  }

  return {
    feePayer: feePayer.publicKey,

    async ping() {
      await rpc("getSlot", () => connection.getSlot(COMMITMENT));
    },

    async loadWallet(address) {
      const info = await rpc("getAccountInfo", () =>
        connection.getAccountInfo(address, COMMITMENT),
      );
      if (!info || !info.owner.equals(opts.agentWalletProgram)) return null;
      let decoded: WalletSnapshot;
      try {
        decoded = opts.codec.decodeWallet(address, info.data);
      } catch {
        return null;
      }
      const vault = await rpc("getAccountInfo", () =>
        connection.getAccountInfo(decoded.vault, COMMITMENT),
      );
      return {
        ...decoded,
        policy: { ...decoded.policy, vaultBalance: vault ? tokenAmount(vault) : 0n },
      };
    },

    async loadReceipt(address) {
      const info = await rpc("getAccountInfo", () =>
        connection.getAccountInfo(address, COMMITMENT),
      );
      if (!info || !info.owner.equals(opts.settlementProgram) || info.data.length === 0) {
        return null;
      }
      return opts.codec.decodeReceipt(info.data);
    },

    async receiptSignature(address) {
      const sigs = await rpc("getSignaturesForAddress", () =>
        connection.getSignaturesForAddress(address, { limit: 1000 }, "confirmed"),
      );
      // Newest first. The receipt is created by the oldest successful transaction.
      for (let i = sigs.length - 1; i >= 0; i--) {
        const s = sigs[i];
        if (s && s.err === null) return s.signature;
      }
      return null;
    },

    async simulateSettle(auth, signature): Promise<SimulateOutcome> {
      const { blockhash } = await rpc("getLatestBlockhash", latestBlockhash);
      const tx = buildTx(auth, signature, blockhash);
      const sim = await rpc("simulateTransaction", () =>
        connection.simulateTransaction(tx, {
          sigVerify: false,
          replaceRecentBlockhash: true,
          commitment: COMMITMENT,
        }),
      );
      if (!sim.value.err) return { ok: true };
      const named = classifyError(sim.value.err, sim.value.logs, opts.codec.errorName);
      if (named.kind === "named") {
        return { ok: false, reason: named.reason, detail: named.detail };
      }
      // A transaction level error, for example an unfunded fee payer. Not the payer's fault.
      throw new ChainUnavailableError(`simulation failed with ${named.detail}`);
    },

    async submitSettle(auth, signature): Promise<SubmitOutcome> {
      let bh: { blockhash: string; lastValidBlockHeight: number };
      try {
        bh = await latestBlockhash();
      } catch (err) {
        return {
          ok: false,
          kind: "unknown",
          detail: `getLatestBlockhash failed, ${describe(err)}`,
        };
      }
      const tx = buildTx(auth, signature, bh.blockhash);
      tx.sign([feePayer]);
      const first = tx.signatures[0];
      if (!first) return { ok: false, kind: "unknown", detail: "transaction was not signed" };
      const txSig = bs58.encode(first);
      const raw = tx.serialize();
      const send = () => connection.sendRawTransaction(raw, { skipPreflight: true, maxRetries: 0 });

      let sendError: string | null = null;
      try {
        await send();
      } catch (err) {
        // The node may still have it. Keep polling, the signature is known.
        sendError = describe(err);
        opts.logger.warn({ signature: txSig, err: sendError }, "send failed, polling anyway");
      }

      const deadline = Date.now() + confirmTimeoutMs;
      let lastResend = Date.now();
      while (Date.now() < deadline) {
        await sleep(POLL_MS);
        let status: Awaited<ReturnType<Connection["getSignatureStatuses"]>>["value"][number];
        try {
          status = (await connection.getSignatureStatuses([txSig])).value[0] ?? null;
        } catch (err) {
          sendError = describe(err);
          continue;
        }
        if (status) {
          if (status.err) {
            const named = classifyError(status.err, null, opts.codec.errorName);
            if (named.kind === "named") {
              return {
                ok: false,
                kind: "rejected",
                reason: named.reason,
                detail: named.detail,
                signature: txSig,
              };
            }
            return { ok: false, kind: "unknown", detail: named.detail, signature: txSig };
          }
          if (
            status.confirmationStatus === "confirmed" ||
            status.confirmationStatus === "finalized"
          ) {
            return { ok: true, signature: txSig };
          }
        }
        if (Date.now() - lastResend > RESEND_MS) {
          lastResend = Date.now();
          try {
            const height = await connection.getBlockHeight(COMMITMENT);
            if (height > bh.lastValidBlockHeight) {
              return {
                ok: false,
                kind: "unknown",
                detail: `blockhash expired before confirmation${sendError ? `, last error ${sendError}` : ""}`,
                signature: txSig,
              };
            }
            await send();
          } catch (err) {
            sendError = describe(err);
          }
        }
      }
      return {
        ok: false,
        kind: "unknown",
        detail: `not confirmed within ${confirmTimeoutMs} ms${sendError ? `, last error ${sendError}` : ""}`,
        signature: txSig,
      };
    },
  };
}
