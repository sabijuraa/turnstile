import { PublicKey, Transaction, type TransactionInstruction } from "@solana/web3.js";
import {
  agentWalletAddress,
  canonicalResource,
  explorerTxUrl,
  formatUnits,
  hexToBytes,
  MAX_SESSION_KEYS,
} from "@turnstile/shared";
import {
  addSessionKeyInstruction,
  closeWalletInstruction,
  createWalletInstruction,
  depositInstruction,
  MAX_ALLOW_LIST_PER_UPDATE,
  parseProgramError,
  revokeSessionKeyInstruction,
  updatePolicyInstruction,
  withdrawInstruction,
} from "@turnstile/shared/programs";
import bs58 from "bs58";
import { Hono } from "hono";
import { z } from "zod";
import { requireOwner } from "../auth/middleware.js";
import {
  listOwnerWalletAccounts,
  loadOwnedWallet,
  type OwnedWallet,
  vaultBalances,
} from "../chain/agents.js";
import { amountSchema, mintDecimals } from "../chain/amounts.js";
import {
  associatedTokenAddress,
  createAssociatedTokenIdempotentInstruction,
  decodeTokenAccount,
} from "../chain/token.js";
import { explorerNetwork } from "../config.js";
import type { AppEnv, Services } from "../context.js";
import { ApiError } from "../errors.js";
import { resolveResourceId } from "../store/receipts.js";
import { pubkeySchema, readJson } from "../validation.js";

/** Solana packet limit for one serialized transaction. */
const MAX_TX_BYTES = 1232;

export interface BuiltTransaction {
  /** Base64 of an unsigned legacy transaction. The owner signs it as fee payer. */
  transaction: string;
  description: string;
  instructions: string[];
}

interface NamedIx {
  name: string;
  ix: TransactionInstruction;
}

const expirySchema = z.iso
  .datetime({ offset: true, error: "must be an ISO 8601 timestamp such as 2026-12-31T00:00:00Z" })
  .nullable()
  .optional();

const allowListSchema = z
  .array(
    z.object({
      resource: z.string({ error: "is required" }).trim().min(1, "is required").max(2048),
      recipient: pubkeySchema,
    }),
    { error: "must be a list of { resource, recipient } entries" },
  )
  .max(
    MAX_ALLOW_LIST_PER_UPDATE,
    `can hold at most ${MAX_ALLOW_LIST_PER_UPDATE} entries per policy update. Remove some entries and try again`,
  );

type AllowListInput = z.infer<typeof allowListSchema>;

function capsRefine<T extends { perCallCap: bigint; dailyCap: bigint }>(
  v: T,
  ctx: z.RefinementCtx,
) {
  if (v.perCallCap > v.dailyCap) {
    ctx.addIssue({
      code: "custom",
      path: ["perCallCap"],
      message: "must not be above dailyCap. Lower the per-call cap or raise the daily cap",
    });
  }
}

/** Turns console allow-list input into on-chain entries and remembers readable resource names. */
async function resolveAllowList(s: Services, input: AllowListInput) {
  const seen = new Set<string>();
  const entries = input.map((e, i) => {
    const id = resolveResourceId(e.resource);
    const pair = `${id}:${e.recipient}`;
    if (seen.has(pair)) {
      throw new ApiError(
        400,
        "invalid_request",
        `allowList.${i} repeats a resource and recipient pair already on the list. Remove the duplicate.`,
      );
    }
    seen.add(pair);
    const readable = /^[0-9a-fA-F]{64}$/.test(e.resource) ? null : canonicalOrRaw(e.resource);
    return { id, readable, recipient: new PublicKey(e.recipient) };
  });
  for (const e of entries) {
    if (e.readable) {
      await s.pool.query(
        "INSERT INTO resources (resource_id, resource) VALUES ($1, $2) ON CONFLICT (resource_id) DO NOTHING",
        [e.id, e.readable],
      );
    }
  }
  return entries.map((e) => ({ resourceId: hexToBytes(e.id), recipient: e.recipient }));
}

function canonicalOrRaw(resource: string): string {
  if (!/^https?:\/\//i.test(resource)) return resource;
  try {
    return canonicalResource(resource);
  } catch {
    return resource;
  }
}

function expiryToUnix(value: string | null | undefined, now: Date, field: string): bigint {
  if (value === null || value === undefined) return 0n;
  const ms = Date.parse(value);
  if (ms <= now.getTime()) {
    throw new ApiError(
      400,
      "invalid_request",
      `${field} is in the past. Pick a future time or leave it empty for a key that does not expire.`,
    );
  }
  return BigInt(Math.floor(ms / 1000));
}

function requireMint(s: Services): PublicKey {
  const mint = s.config.deployment?.mint;
  if (!mint) {
    throw new ApiError(
      503,
      "mint_not_configured",
      "The backend has no stablecoin mint configured. Set DEPLOYMENT_FILE to the deployment JSON and restart the backend.",
    );
  }
  return new PublicKey(mint);
}

async function ownerTokenBalance(
  s: Services,
  owner: PublicKey,
  mint: PublicKey,
): Promise<bigint | null> {
  const info = await s.rpc.getAccountInfo(associatedTokenAddress(owner, mint), "confirmed");
  if (!info) return null;
  return decodeTokenAccount(info.data, info.owner)?.amount ?? null;
}

async function requireOwnerFunds(
  s: Services,
  owner: PublicKey,
  mint: PublicKey,
  amount: bigint,
  decimals: number,
): Promise<PublicKey> {
  const balance = await ownerTokenBalance(s, owner, mint);
  if (balance === null) {
    throw new ApiError(
      400,
      "owner_token_account_missing",
      `Your wallet has no token account for the stablecoin ${mint.toBase58()}. Receive some of it first, then deposit.`,
    );
  }
  if (balance < amount) {
    throw new ApiError(
      400,
      "insufficient_owner_balance",
      `Your wallet holds ${formatUnits(balance, decimals)}, less than the ${formatUnits(amount, decimals)} you want to deposit. Deposit less or fund your wallet first.`,
    );
  }
  return associatedTokenAddress(owner, mint);
}

function serialize(tx: Transaction): string | null {
  try {
    const bytes = tx.serialize({ requireAllSignatures: false, verifySignatures: false });
    return bytes.length <= MAX_TX_BYTES ? bytes.toString("base64") : null;
  } catch (err) {
    if (err instanceof Error && /too large/i.test(err.message)) return null;
    throw err;
  }
}

interface Blockhash {
  blockhash: string;
  lastValidBlockHeight: number;
}

function buildOne(
  owner: PublicKey,
  bh: Blockhash,
  ixs: NamedIx[],
  description: string,
): BuiltTransaction | null {
  const tx = new Transaction({
    feePayer: owner,
    blockhash: bh.blockhash,
    lastValidBlockHeight: bh.lastValidBlockHeight,
  });
  for (const i of ixs) tx.add(i.ix);
  const b64 = serialize(tx);
  return b64 ? { transaction: b64, description, instructions: ixs.map((i) => i.name) } : null;
}

function mustBuild(
  owner: PublicKey,
  bh: Blockhash,
  ixs: NamedIx[],
  description: string,
): BuiltTransaction {
  const built = buildOne(owner, bh, ixs, description);
  if (!built) {
    throw new ApiError(
      400,
      "transaction_too_large",
      "This change does not fit in one Solana transaction. Make it in smaller steps, for example fewer allow-list entries at once.",
    );
  }
  return built;
}

const signatureSchema = z
  .string({ error: "is required" })
  .trim()
  .refine((v) => {
    try {
      return bs58.decode(v).length === 64;
    } catch {
      return false;
    }
  }, "must be a base58 transaction signature");

export function txRoutes(s: Services): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  const decimals = mintDecimals(s.config);
  const network = explorerNetwork(s.config);
  const amount = amountSchema(decimals);
  const cap = amountSchema(decimals, { allowZero: true });
  app.use("*", requireOwner(s, { apiKey: false }));

  const respond = async (
    owner: PublicKey,
    action: string,
    agentWallet: PublicKey,
    groups: { ixs: NamedIx[]; description: string }[],
    extra: Record<string, unknown> = {},
  ) => {
    const bh = await s.rpc.getLatestBlockhash("confirmed");
    return {
      action,
      network: s.config.network,
      agentWallet: agentWallet.toBase58(),
      feePayer: owner.toBase58(),
      recentBlockhash: bh.blockhash,
      lastValidBlockHeight: bh.lastValidBlockHeight,
      transactions: groups.map((g) => mustBuild(owner, bh, g.ixs, g.description)),
      ...extra,
    };
  };

  const owned = async (ownerKey: PublicKey, address: string): Promise<OwnedWallet> =>
    loadOwnedWallet(s.rpc, address, ownerKey.toBase58());

  const createBody = z
    .object({
      sessionKey: pubkeySchema,
      sessionExpiresAt: expirySchema,
      perCallCap: cap,
      dailyCap: cap,
      deposit: amount.optional(),
      allowList: allowListSchema.default([]),
      id: z
        .string()
        .regex(/^\d{1,20}$/, "must be a whole number as a string")
        .transform((v) => BigInt(v))
        .optional(),
    })
    .superRefine(capsRefine);

  app.post("/create-agent", async (c) => {
    const body = await readJson(c, createBody);
    const owner = new PublicKey(c.get("owner"));
    const mint = requireMint(s);
    if (body.sessionKey === owner.toBase58()) {
      throw new ApiError(
        400,
        "invalid_request",
        "sessionKey must be a separate key from your owner wallet. Generate a new key for the agent.",
      );
    }
    const sessionExpiresAt = expiryToUnix(body.sessionExpiresAt, s.clock(), "sessionExpiresAt");
    let id = body.id;
    if (id === undefined) {
      const existing = await listOwnerWalletAccounts(s.rpc, owner);
      id = existing.reduce((max, w) => (w.account.id >= max ? w.account.id + 1n : max), 0n);
    }
    const [agentWallet] = agentWalletAddress(owner, id);
    if (await s.rpc.getAccountInfo(agentWallet, "confirmed")) {
      throw new ApiError(
        409,
        "agent_exists",
        `An agent wallet with id ${id} already exists for this owner. Leave id empty to use the next free one.`,
      );
    }
    const ixs: NamedIx[] = [
      {
        name: "create_wallet",
        ix: createWalletInstruction({
          owner,
          mint,
          id,
          perCallCap: body.perCallCap,
          dailyCap: body.dailyCap,
          sessionKey: new PublicKey(body.sessionKey),
          sessionExpiresAt,
        }),
      },
    ];
    if (body.deposit !== undefined) {
      const ownerToken = await requireOwnerFunds(s, owner, mint, body.deposit, decimals);
      ixs.push({
        name: "deposit",
        ix: depositInstruction({ owner, agentWallet, ownerToken, amount: body.deposit }),
      });
    }
    const policyIxs: NamedIx[] = [];
    if (body.allowList.length > 0) {
      policyIxs.push({
        name: "update_policy",
        ix: updatePolicyInstruction({
          owner,
          agentWallet,
          perCallCap: body.perCallCap,
          dailyCap: body.dailyCap,
          allowList: await resolveAllowList(s, body.allowList),
        }),
      });
    }
    const bh = await s.rpc.getLatestBlockhash("confirmed");
    const single = buildOne(owner, bh, [...ixs, ...policyIxs], "Create the agent wallet");
    const transactions = single
      ? [single]
      : [
          mustBuild(owner, bh, ixs, "Create the agent wallet"),
          mustBuild(owner, bh, policyIxs, "Set the initial allow-list"),
        ];
    return c.json({
      action: "create-agent",
      network: s.config.network,
      agentWallet: agentWallet.toBase58(),
      id: id.toString(),
      feePayer: owner.toBase58(),
      recentBlockhash: bh.blockhash,
      lastValidBlockHeight: bh.lastValidBlockHeight,
      transactions,
    });
  });

  const moveBody = z.object({ agentWallet: pubkeySchema, amount });

  app.post("/deposit", async (c) => {
    const body = await readJson(c, moveBody);
    const owner = new PublicKey(c.get("owner"));
    const w = await owned(owner, body.agentWallet);
    const ownerToken = await requireOwnerFunds(s, owner, w.account.mint, body.amount, decimals);
    return c.json(
      await respond(owner, "deposit", w.address, [
        {
          description: `Deposit ${formatUnits(body.amount, decimals)} into the agent vault`,
          ixs: [
            {
              name: "deposit",
              ix: depositInstruction({
                owner,
                agentWallet: w.address,
                ownerToken,
                amount: body.amount,
              }),
            },
          ],
        },
      ]),
    );
  });

  app.post("/withdraw", async (c) => {
    const body = await readJson(c, moveBody);
    const owner = new PublicKey(c.get("owner"));
    const w = await owned(owner, body.agentWallet);
    const [balance = 0n] = await vaultBalances(s.rpc, [w.address]);
    if (body.amount > balance) {
      throw new ApiError(
        400,
        "insufficient_vault_balance",
        `The agent vault holds ${formatUnits(balance, decimals)}, less than the ${formatUnits(body.amount, decimals)} you asked for. Withdraw at most ${formatUnits(balance, decimals)}.`,
      );
    }
    const ownerToken = associatedTokenAddress(owner, w.account.mint);
    return c.json(
      await respond(owner, "withdraw", w.address, [
        {
          description: `Withdraw ${formatUnits(body.amount, decimals)} to your wallet`,
          ixs: [
            {
              name: "create_owner_token_account",
              ix: createAssociatedTokenIdempotentInstruction(owner, owner, w.account.mint),
            },
            {
              name: "withdraw",
              ix: withdrawInstruction({
                owner,
                agentWallet: w.address,
                ownerToken,
                amount: body.amount,
              }),
            },
          ],
        },
      ]),
    );
  });

  const policyBody = z
    .object({
      agentWallet: pubkeySchema,
      perCallCap: cap,
      dailyCap: cap,
      allowList: allowListSchema,
    })
    .superRefine(capsRefine);

  app.post("/update-policy", async (c) => {
    const body = await readJson(c, policyBody);
    const owner = new PublicKey(c.get("owner"));
    const w = await owned(owner, body.agentWallet);
    const allowList = await resolveAllowList(s, body.allowList);
    return c.json(
      await respond(owner, "update-policy", w.address, [
        {
          description: "Replace the caps and the allow-list",
          ixs: [
            {
              name: "update_policy",
              ix: updatePolicyInstruction({
                owner,
                agentWallet: w.address,
                perCallCap: body.perCallCap,
                dailyCap: body.dailyCap,
                allowList,
              }),
            },
          ],
        },
      ]),
    );
  });

  const addKeyBody = z.object({
    agentWallet: pubkeySchema,
    sessionKey: pubkeySchema,
    expiresAt: expirySchema,
  });

  app.post("/add-session-key", async (c) => {
    const body = await readJson(c, addKeyBody);
    const owner = new PublicKey(c.get("owner"));
    const w = await owned(owner, body.agentWallet);
    if (body.sessionKey === owner.toBase58()) {
      throw new ApiError(
        400,
        "invalid_request",
        "sessionKey must be a separate key from your owner wallet. Generate a new key for the agent.",
      );
    }
    const now = s.clock();
    const expiresAt = expiryToUnix(body.expiresAt, now, "expiresAt");
    const keys = w.account.policy.sessionKeys;
    if (keys.some((k) => k.key.toBase58() === body.sessionKey)) {
      throw new ApiError(
        409,
        "duplicate_session_key",
        "This session key is already registered on the agent wallet. Use a new key.",
      );
    }
    const nowUnix = BigInt(Math.floor(now.getTime() / 1000));
    const freeSlot =
      keys.length < MAX_SESSION_KEYS ||
      keys.some((k) => !k.active || (k.expiresAt !== 0n && nowUnix > k.expiresAt));
    if (!freeSlot) {
      throw new ApiError(
        409,
        "too_many_session_keys",
        `The agent wallet already has ${MAX_SESSION_KEYS} active session keys. Revoke one first.`,
      );
    }
    return c.json(
      await respond(owner, "add-session-key", w.address, [
        {
          description: "Add a session key",
          ixs: [
            {
              name: "add_session_key",
              ix: addSessionKeyInstruction({
                owner,
                agentWallet: w.address,
                sessionKey: new PublicKey(body.sessionKey),
                expiresAt,
              }),
            },
          ],
        },
      ]),
    );
  });

  const revokeBody = z.object({ agentWallet: pubkeySchema, sessionKey: pubkeySchema });

  app.post("/revoke-session-key", async (c) => {
    const body = await readJson(c, revokeBody);
    const owner = new PublicKey(c.get("owner"));
    const w = await owned(owner, body.agentWallet);
    const entry = w.account.policy.sessionKeys.find((k) => k.key.toBase58() === body.sessionKey);
    if (!entry) {
      throw new ApiError(
        404,
        "session_key_not_found",
        "This session key is not registered on the agent wallet. Refresh the agent and pick a listed key.",
      );
    }
    if (!entry.active) {
      throw new ApiError(409, "session_key_revoked", "This session key is already revoked.");
    }
    return c.json(
      await respond(owner, "revoke-session-key", w.address, [
        {
          description: "Revoke a session key",
          ixs: [
            {
              name: "revoke_session_key",
              ix: revokeSessionKeyInstruction({
                owner,
                agentWallet: w.address,
                sessionKey: new PublicKey(body.sessionKey),
              }),
            },
          ],
        },
      ]),
    );
  });

  const closeBody = z.object({
    agentWallet: pubkeySchema,
    withdrawRemaining: z.boolean({ error: "must be true or false" }).default(false),
  });

  app.post("/close-wallet", async (c) => {
    const body = await readJson(c, closeBody);
    const owner = new PublicKey(c.get("owner"));
    const w = await owned(owner, body.agentWallet);
    const [balance = 0n] = await vaultBalances(s.rpc, [w.address]);
    const ixs: NamedIx[] = [];
    if (balance > 0n) {
      if (!body.withdrawRemaining) {
        throw new ApiError(
          409,
          "vault_not_empty",
          `The agent vault still holds ${formatUnits(balance, decimals)}. Withdraw it first or send withdrawRemaining true to do both in one transaction.`,
        );
      }
      ixs.push(
        {
          name: "create_owner_token_account",
          ix: createAssociatedTokenIdempotentInstruction(owner, owner, w.account.mint),
        },
        {
          name: "withdraw",
          ix: withdrawInstruction({
            owner,
            agentWallet: w.address,
            ownerToken: associatedTokenAddress(owner, w.account.mint),
            amount: balance,
          }),
        },
      );
    }
    ixs.push({
      name: "close_wallet",
      ix: closeWalletInstruction({ owner, agentWallet: w.address }),
    });
    return c.json(
      await respond(
        owner,
        "close-wallet",
        w.address,
        [{ description: "Close the agent wallet and return its rent", ixs }],
        {
          withdrawn: { amount: balance.toString(), displayAmount: formatUnits(balance, decimals) },
        },
      ),
    );
  });

  const confirmBody = z.object({
    signature: signatureSchema,
    timeoutMs: z.number().int().min(0).max(60_000).optional(),
  });

  app.post("/confirm", async (c) => {
    const body = await readJson(c, confirmBody);
    const deadline = Date.now() + (body.timeoutMs ?? s.config.confirmTimeoutMs);
    const explorerUrl = explorerTxUrl(network, body.signature);
    for (;;) {
      const { value } = await s.rpc.getSignatureStatuses([body.signature], {
        searchTransactionHistory: true,
      });
      const st = value[0];
      if (st?.err) {
        let programError = parseProgramError(st.err);
        if (!programError) {
          const tx = await s.rpc.getTransaction(body.signature, {
            commitment: "confirmed",
            maxSupportedTransactionVersion: 0,
          });
          programError = parseProgramError(st.err, tx?.meta?.logMessages ?? []);
        }
        return c.json({
          signature: body.signature,
          status: "failed",
          slot: st.slot,
          error: programError
            ? { code: programError.code, name: programError.name, message: programError.message }
            : { code: null, name: "TransactionFailed", message: JSON.stringify(st.err) },
          explorerUrl,
        });
      }
      if (st && (st.confirmationStatus === "confirmed" || st.confirmationStatus === "finalized")) {
        return c.json({
          signature: body.signature,
          status: st.confirmationStatus,
          slot: st.slot,
          error: null,
          explorerUrl,
        });
      }
      if (Date.now() >= deadline) {
        return c.json({
          signature: body.signature,
          status: "pending",
          slot: st?.slot ?? null,
          error: null,
          explorerUrl,
          message: st
            ? "The transaction is processed but not confirmed yet. Ask again in a few seconds."
            : "The network has not seen this transaction yet. Ask again in a few seconds, or rebuild and resend it if the blockhash expired.",
        });
      }
      await new Promise((r) => setTimeout(r, 400));
    }
  });

  return app;
}
