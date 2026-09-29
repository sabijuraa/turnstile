import {
  type Commitment,
  Connection,
  type Keypair,
  type PublicKey,
  SYSVAR_CLOCK_PUBKEY,
  TransactionMessage,
  VersionedTransaction,
} from "@solana/web3.js";
import {
  closeReceiptInstruction,
  decodeReceipt,
  parseProgramError,
  RECEIPT_ACCOUNT_SIZE,
  RECEIPT_FEE_PAYER_OFFSET,
} from "@turnstile/shared/programs";
import bs58 from "bs58";
import { ChainUnavailableError } from "../errors.js";
import type { Logger } from "../logger.js";
import type { CloseOutcome, FeePayerReceipt, ReclaimChain } from "./types.js";

export interface SolanaReclaimChainOptions {
  rpcUrl: string;
  feePayer: Keypair;
  settlementProgram: PublicKey;
  logger: Logger;
  connection?: Connection;
}

const COMMITMENT: Commitment = "confirmed";
/** `unix_timestamp` in the Clock sysvar follows slot, epoch_start_timestamp, epoch and leader_schedule_epoch. */
const CLOCK_UNIX_TIMESTAMP_OFFSET = 32;

function describe(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Leads with the program error name when the failure carries one. */
function failure(err: unknown, detail: string): string {
  const named = parseProgramError(err);
  return named ? `${named.name}, ${detail}` : detail;
}

/** The real chain for the reclaim job. The fee payer signs as fee payer and receives the rent. */
export function createSolanaReclaimChain(opts: SolanaReclaimChainOptions): ReclaimChain {
  const connection = opts.connection ?? new Connection(opts.rpcUrl, { commitment: COMMITMENT });
  const feePayer = opts.feePayer;

  async function rpc<T>(what: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      throw new ChainUnavailableError(`${what} failed, ${describe(err)}`);
    }
  }

  return {
    feePayer: feePayer.publicKey,

    async chainTime() {
      const info = await rpc("getAccountInfo", () =>
        connection.getAccountInfo(SYSVAR_CLOCK_PUBKEY, COMMITMENT),
      );
      if (!info || info.data.length < CLOCK_UNIX_TIMESTAMP_OFFSET + 8) {
        throw new ChainUnavailableError("the Clock sysvar could not be read");
      }
      return info.data.readBigInt64LE(CLOCK_UNIX_TIMESTAMP_OFFSET);
    },

    async listFeePayerReceipts() {
      const accounts = await rpc("getProgramAccounts", () =>
        connection.getProgramAccounts(opts.settlementProgram, {
          commitment: COMMITMENT,
          filters: [
            { dataSize: RECEIPT_ACCOUNT_SIZE },
            {
              memcmp: { offset: RECEIPT_FEE_PAYER_OFFSET, bytes: feePayer.publicKey.toBase58() },
            },
          ],
        }),
      );
      const out: FeePayerReceipt[] = [];
      for (const { pubkey, account } of accounts) {
        let expiresAt: bigint;
        try {
          const r = decodeReceipt(account.data);
          if (!r.feePayer.equals(feePayer.publicKey)) continue;
          expiresAt = r.expiresAt;
        } catch (err) {
          opts.logger.warn(
            { account: pubkey.toBase58(), err: describe(err) },
            "skipped a settlement account that is not a receipt",
          );
          continue;
        }
        out.push({ address: pubkey, expiresAt, lamports: BigInt(account.lamports) });
      }
      return out;
    },

    async closeReceipts(receipts): Promise<CloseOutcome> {
      let bh: { blockhash: string; lastValidBlockHeight: number };
      try {
        bh = await connection.getLatestBlockhash(COMMITMENT);
      } catch (err) {
        return { ok: false, detail: `getLatestBlockhash failed, ${describe(err)}` };
      }
      const message = new TransactionMessage({
        payerKey: feePayer.publicKey,
        recentBlockhash: bh.blockhash,
        instructions: receipts.map((receipt) =>
          closeReceiptInstruction({ receipt, feePayer: feePayer.publicKey }),
        ),
      }).compileToLegacyMessage();
      const tx = new VersionedTransaction(message);
      tx.sign([feePayer]);
      const first = tx.signatures[0];
      if (!first) return { ok: false, detail: "transaction was not signed" };
      const signature = bs58.encode(first);
      try {
        await connection.sendRawTransaction(tx.serialize(), { preflightCommitment: COMMITMENT });
        const res = await connection.confirmTransaction(
          { signature, blockhash: bh.blockhash, lastValidBlockHeight: bh.lastValidBlockHeight },
          COMMITMENT,
        );
        if (res.value.err) {
          return {
            ok: false,
            detail: failure(res.value.err, JSON.stringify(res.value.err)),
            signature,
          };
        }
        return { ok: true, signature };
      } catch (err) {
        return { ok: false, detail: failure(err, describe(err)), signature };
      }
    },
  };
}
