/**
 * The console API inside this web app, for a host with no console database.
 *
 * Agents and every owner transaction go through the backend's own routes, unchanged. What the
 * backend keeps in Postgres is answered differently here:
 *
 * - Sign-in has no session table. The challenge and the session are signed with
 *   CONSOLE_SESSION_SECRET, so any server instance can check them.
 * - Receipts, spend and the summary are read from the Receipt accounts on chain, which carry the
 *   owner. The chain is the source of truth anyway; the indexer only makes it faster.
 * - Labels and API keys need the database, so they answer that this host does not keep them.
 */

import "server-only";

import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { ed25519 } from "@noble/curves/ed25519.js";
import { Connection, PublicKey } from "@solana/web3.js";
import {
  ApiError,
  type AppEnv,
  agentRoutes,
  buildSignInMessage,
  type Config,
  createAgentDirectory,
  createMetrics,
  errorBody,
  explorerNetwork,
  type Range,
  type ReceiptView,
  rangeSchema,
  type Services,
  type SpendSeries,
  txRoutes,
  windowFor,
} from "@turnstile/backend";
import { bytesToHex, explorerTxUrl, formatUnits, NETWORKS } from "@turnstile/shared";
import { decodeReceipt } from "@turnstile/shared/programs";
import bs58 from "bs58";
import { Hono, type MiddlewareHandler } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { liveDeployment } from "./runtime";

const SESSION_COOKIE = "turnstile_session";
const CHALLENGE_TTL_S = 300;
const SESSION_TTL_S = 7 * 24 * 60 * 60;
/** The Receipt account starts with its discriminator, then agent_wallet, then owner. */
const RECEIPT_OWNER_OFFSET = 8 + 32;

function secret(): Buffer {
  const value = process.env.CONSOLE_SESSION_SECRET;
  if (!value || value.length < 32) {
    throw new Error("CONSOLE_SESSION_SECRET must be set to at least 32 random characters.");
  }
  return Buffer.from(value);
}

function mac(text: string): string {
  return createHmac("sha256", secret()).update(text).digest("base64url");
}

function sameMac(a: string, b: string): boolean {
  const x = Buffer.from(a);
  const y = Buffer.from(b);
  return x.length === y.length && timingSafeEqual(x, y);
}

/** A session is the owner and its expiry, signed. Nothing about it is stored. */
function issueSession(owner: string, expiresAt: number): string {
  const body = `${owner}.${expiresAt}`;
  return `${body}.${mac(`session:${body}`)}`;
}

function readSession(token: string): { owner: string; expired: boolean } | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [owner, expires, signature] = parts as [string, string, string];
  if (!sameMac(signature, mac(`session:${owner}.${expires}`))) return null;
  return { owner, expired: Number(expires) * 1000 <= Date.now() };
}

/** The nonce is the challenge's own signature, so verify needs no stored challenge. */
function challengeNonce(pubkey: string, issuedAt: number, expiresAt: number): string {
  return `${issuedAt}.${expiresAt}.${mac(`challenge:${pubkey}.${issuedAt}.${expiresAt}`)}`;
}

let cached: Hono<AppEnv> | null = null;

/** The console API, built once per server instance. */
export function consoleApi(origin: string): Hono<AppEnv> {
  if (cached) return cached;
  const deployment = liveDeployment();
  const network = deployment.network;
  const rpcUrl = process.env.SOLANA_RPC_URL ?? NETWORKS[network].rpcUrl;
  const rpc = new Connection(rpcUrl, "confirmed");
  const url = new URL(origin);
  const config: Config = {
    port: 0,
    databaseUrl: "",
    network,
    rpcUrl,
    deployment: { ...deployment, network } as Config["deployment"],
    webOrigin: url.origin,
    domain: url.host,
    cookieSecure: url.protocol === "https:",
    logLevel: "warn",
    challengeTtlSeconds: CHALLENGE_TTL_S,
    sessionTtlSeconds: SESSION_TTL_S,
    confirmTimeoutMs: 30_000,
  };
  // The backend routes read labels and readable resource names from Postgres. Here there are
  // none, so every such read is empty and every such write is dropped.
  const noDatabase = {
    query: async () => ({ rows: [], rowCount: 0 }),
  } as unknown as Services["pool"];

  const authorize =
    (opts: { apiKey: boolean }): MiddlewareHandler<AppEnv> =>
    async (c, next) => {
      if (c.req.header("authorization")) {
        throw new ApiError(
          opts.apiKey ? 401 : 403,
          "api_keys_not_available",
          "This console does not issue API keys. Sign in with your wallet instead.",
        );
      }
      const token = getCookie(c, SESSION_COOKIE);
      const session = token ? readSession(token) : null;
      if (!session) {
        throw new ApiError(401, "unauthenticated", "Sign in with your wallet to use the console.");
      }
      if (session.expired) {
        throw new ApiError(401, "session_expired", "Your console session expired. Sign in again.");
      }
      if (!["GET", "HEAD", "OPTIONS"].includes(c.req.method)) {
        const from = c.req.header("origin");
        if (from !== undefined && from !== config.webOrigin) {
          throw new ApiError(
            403,
            "origin_not_allowed",
            "Requests must come from the console itself.",
          );
        }
      }
      c.set("owner", session.owner);
      c.set("authMethod", "session");
      await next();
    };

  const metrics = createMetrics(false);
  const silent = {
    child: () => silent,
    info: () => {},
    warn: () => {},
    error: (...args: unknown[]) => console.error(...args),
    debug: () => {},
  } as unknown as Services["logger"];
  const s: Services = {
    pool: noDatabase,
    rpc,
    config,
    clock: () => new Date(),
    logger: silent,
    metrics,
    directory: createAgentDirectory(noDatabase, rpc),
    authorize,
  };
  const explorer = explorerNetwork(config);

  /** Every receipt this owner's agents have settled, newest first. */
  async function receiptsOf(owner: string): Promise<ReceiptView[]> {
    const accounts = await rpc.getProgramAccounts(new PublicKey(deployment.programs.settlement), {
      commitment: "confirmed",
      filters: [{ memcmp: { offset: RECEIPT_OWNER_OFFSET, bytes: owner } }],
    });
    const views: ReceiptView[] = [];
    for (const { pubkey, account } of accounts) {
      let r: ReturnType<typeof decodeReceipt>;
      try {
        r = decodeReceipt(account.data);
      } catch {
        continue;
      }
      views.push({
        receiptAddress: pubkey.toBase58(),
        signature: "",
        slot: r.slot.toString(),
        blockTime: new Date(Number(r.unixTimestamp) * 1000).toISOString(),
        agentWallet: r.agentWallet.toBase58(),
        agentLabel: null,
        owner: r.owner.toBase58(),
        sessionKey: r.sessionKey.toBase58(),
        recipient: r.recipient.toBase58(),
        recipientToken: r.recipientToken.toBase58(),
        mint: r.mint.toBase58(),
        amount: r.amount.toString(),
        displayAmount: formatUnits(r.amount),
        resourceId: bytesToHex(r.resourceId),
        resource: null,
        nonce: bytesToHex(r.nonce),
        feePayer: r.feePayer.toBase58(),
        network: deployment.caip2 ?? NETWORKS[network].caip2,
        status: "settled",
        explorerUrl: explorerTxUrl(explorer, pubkey.toBase58()).replace("/tx/", "/address/"),
      });
    }
    return views.sort(
      (a, b) =>
        b.blockTime.localeCompare(a.blockTime) || a.receiptAddress.localeCompare(b.receiptAddress),
    );
  }

  /** The transaction that wrote each receipt, for its explorer link. Best effort. */
  async function withSignatures(views: ReceiptView[]): Promise<ReceiptView[]> {
    return Promise.all(
      views.map(async (v) => {
        try {
          const [first] = await rpc.getSignaturesForAddress(
            new PublicKey(v.receiptAddress),
            { limit: 1 },
            "confirmed",
          );
          if (!first) return v;
          return {
            ...v,
            signature: first.signature,
            explorerUrl: explorerTxUrl(explorer, first.signature),
          };
        } catch {
          return v;
        }
      }),
    );
  }

  function filtered(all: ReceiptView[], q: URLSearchParams): ReceiptView[] {
    const agent = q.get("agent");
    const from = q.get("from");
    const to = q.get("to");
    const search = q.get("search")?.toLowerCase();
    let out = all.filter(
      (r) =>
        (!agent || r.agentWallet === agent) &&
        (!from || r.blockTime >= new Date(from).toISOString()) &&
        (!to || r.blockTime < new Date(to).toISOString()) &&
        (!search || r.receiptAddress.toLowerCase().includes(search) || r.nonce.includes(search)),
    );
    const sort = q.get("sort") ?? "newest";
    if (sort === "oldest") out = [...out].reverse();
    if (sort === "amount_desc")
      out = [...out].sort((a, b) => Number(BigInt(b.amount) - BigInt(a.amount)));
    if (sort === "amount_asc")
      out = [...out].sort((a, b) => Number(BigInt(a.amount) - BigInt(b.amount)));
    return out;
  }

  function rangeOf(q: URLSearchParams): Range {
    const parsed = rangeSchema.safeParse(q.get("range") ?? "7d");
    if (!parsed.success)
      throw new ApiError(400, "invalid_request", "range must be one of 24h, 7d or 30d.");
    return parsed.data;
  }

  function spend(all: ReceiptView[], range: Range, agent: string | null): SpendSeries {
    const w = windowFor(range, new Date());
    const buckets = Array.from({ length: w.bucketCount }, (_, i) => ({
      start: new Date(w.from.getTime() + i * w.stepMs),
      amount: 0n,
      count: 0,
    }));
    for (const r of all) {
      if (agent && r.agentWallet !== agent) continue;
      const t = new Date(r.blockTime).getTime();
      const i = Math.floor((t - w.from.getTime()) / w.stepMs);
      const b = buckets[i];
      if (b && t < w.to.getTime()) {
        b.amount += BigInt(r.amount);
        b.count += 1;
      }
    }
    const total = buckets.reduce((sum, b) => sum + b.amount, 0n);
    return {
      range: w.range,
      bucket: w.bucket,
      from: w.from.toISOString(),
      to: w.to.toISOString(),
      series: buckets.map((b) => ({
        start: b.start.toISOString(),
        amount: b.amount.toString(),
        displayAmount: formatUnits(b.amount),
        count: b.count,
      })),
      totals: {
        amount: total.toString(),
        displayAmount: formatUnits(total),
        count: buckets.reduce((n, b) => n + b.count, 0),
      },
    };
  }

  const app = new Hono<AppEnv>();
  app.use("*", async (c, next) => {
    c.set("requestId", randomBytes(8).toString("hex"));
    c.set("log", silent);
    await next();
  });
  app.onError((err, c) => {
    if (err instanceof ApiError) return c.json(errorBody(err.code, err.message), err.status);
    console.error("console API error", err);
    return c.json(
      errorBody("internal_error", "The console hit an unexpected error. Try again."),
      500,
    );
  });

  app.post("/v1/auth/challenge", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as { pubkey?: unknown };
    const pubkey = typeof body.pubkey === "string" ? body.pubkey : "";
    try {
      new PublicKey(pubkey);
    } catch {
      throw new ApiError(400, "invalid_request", "pubkey must be a base58 Solana address.");
    }
    const issuedAt = Date.now();
    const expiresAt = issuedAt + CHALLENGE_TTL_S * 1000;
    const nonce = challengeNonce(pubkey, issuedAt, expiresAt);
    const message = buildSignInMessage({
      domain: config.domain,
      uri: config.webOrigin,
      pubkey,
      network,
      nonce,
      issuedAt: new Date(issuedAt),
      expiresAt: new Date(expiresAt),
    });
    return c.json({
      pubkey,
      nonce,
      message,
      issuedAt: new Date(issuedAt).toISOString(),
      expiresAt: new Date(expiresAt).toISOString(),
    });
  });

  app.post("/v1/auth/verify", async (c) => {
    const body = (await c.req.json().catch(() => ({}))) as {
      pubkey?: string;
      nonce?: string;
      signature?: string;
    };
    const { pubkey = "", nonce = "", signature = "" } = body;
    const [issued, expires, tag] = nonce.split(".");
    if (
      !issued ||
      !expires ||
      !tag ||
      !sameMac(tag, mac(`challenge:${pubkey}.${issued}.${expires}`))
    ) {
      throw new ApiError(
        401,
        "unknown_challenge",
        "This sign-in request was not issued for this wallet. Start sign-in again.",
      );
    }
    if (Number(expires) <= Date.now()) {
      throw new ApiError(
        401,
        "challenge_expired",
        "This sign-in request expired. Start sign-in again and approve it within 5 minutes.",
      );
    }
    const message = buildSignInMessage({
      domain: config.domain,
      uri: config.webOrigin,
      pubkey,
      network,
      nonce,
      issuedAt: new Date(Number(issued)),
      expiresAt: new Date(Number(expires)),
    });
    let valid = false;
    try {
      const sig = /^[0-9a-fA-F]{128}$/.test(signature)
        ? Buffer.from(signature, "hex")
        : bs58.decode(signature);
      valid = ed25519.verify(
        sig,
        new TextEncoder().encode(message),
        new PublicKey(pubkey).toBytes(),
      );
    } catch {
      valid = false;
    }
    if (!valid) {
      throw new ApiError(
        401,
        "bad_signature",
        "The signature does not match the sign-in message for this wallet.",
      );
    }
    const sessionExpires = Math.floor(Date.now() / 1000) + SESSION_TTL_S;
    setCookie(c, SESSION_COOKIE, issueSession(pubkey, sessionExpires), {
      httpOnly: true,
      sameSite: "Lax",
      secure: config.cookieSecure,
      path: "/",
      maxAge: SESSION_TTL_S,
    });
    return c.json({ owner: pubkey, expiresAt: new Date(sessionExpires * 1000).toISOString() });
  });

  app.post("/v1/auth/signout", (c) => {
    deleteCookie(c, SESSION_COOKIE, { path: "/", secure: config.cookieSecure });
    return c.json({ signedOut: true });
  });

  app.get("/v1/me", authorize({ apiKey: true }), (c) =>
    c.json({
      owner: c.get("owner"),
      authMethod: "session",
      network,
      createdAt: null,
      lastSeenAt: null,
    }),
  );

  const notKept = (c: { json: (b: unknown, s: 501) => Response }) =>
    c.json(
      errorBody(
        "not_available",
        "This console keeps no database, so labels and API keys are not available here.",
      ),
      501,
    );
  app.put("/v1/agents/:address/label", authorize({ apiKey: false }), (c) => notKept(c));
  app.route("/v1/agents", agentRoutes(s));
  app.route("/v1/tx", txRoutes(s));

  app.get("/v1/receipts", authorize({ apiKey: true }), async (c) => {
    const q = new URL(c.req.url).searchParams;
    const limit = Math.min(200, Math.max(1, Number(q.get("limit") ?? 50) || 50));
    const offset = Number(q.get("cursor") ?? 0) || 0;
    const all = filtered(await receiptsOf(c.get("owner")), q);
    const page = await withSignatures(all.slice(offset, offset + limit));
    return c.json({
      receipts: page,
      nextCursor: offset + limit < all.length ? String(offset + limit) : null,
    });
  });

  app.get("/v1/summary", authorize({ apiKey: true }), async (c) => {
    const q = new URL(c.req.url).searchParams;
    const range = rangeOf(q);
    const all = await receiptsOf(c.get("owner"));
    const series = spend(all, range, null);
    const inWindow = all.filter((r) => r.blockTime >= series.from && r.blockTime < series.to);
    return c.json({
      range,
      notices: [],
      from: series.from,
      to: series.to,
      totalSpend: { amount: series.totals.amount, displayAmount: series.totals.displayAmount },
      settlementCount: series.totals.count,
      activeAgents: new Set(inWindow.map((r) => r.agentWallet)).size,
      recentReceipts: await withSignatures(all.slice(0, 8)),
      failures: { pendingCount: 0, items: [] },
    });
  });

  app.get("/v1/spend", authorize({ apiKey: true }), async (c) => {
    const q = new URL(c.req.url).searchParams;
    return c.json(spend(await receiptsOf(c.get("owner")), rangeOf(q), q.get("agent")));
  });

  app.get("/v1/receipts.csv", authorize({ apiKey: true }), async (c) => {
    const q = new URL(c.req.url).searchParams;
    const rows = await withSignatures(filtered(await receiptsOf(c.get("owner")), q));
    const head = "block_time,receipt,signature,agent_wallet,amount,recipient,resource_id,nonce\n";
    const body = rows
      .map((r) =>
        [
          r.blockTime,
          r.receiptAddress,
          r.signature,
          r.agentWallet,
          r.displayAmount,
          r.recipient,
          r.resourceId,
          r.nonce,
        ].join(","),
      )
      .join("\n");
    return c.body(`${head}${body}\n`, 200, {
      "content-type": "text/csv; charset=utf-8",
      "content-disposition": `attachment; filename="turnstile-receipts-${new Date().toISOString().slice(0, 10)}.csv"`,
    });
  });

  app.get("/v1/api-keys", authorize({ apiKey: false }), (c) => c.json({ keys: [] }));
  app.post("/v1/api-keys", authorize({ apiKey: false }), (c) => notKept(c));
  app.delete("/v1/api-keys/:id", authorize({ apiKey: false }), (c) => notKept(c));

  app.notFound((c) =>
    c.json(errorBody("not_found", `The console API has no route at ${c.req.path}.`), 404),
  );
  cached = app;
  return app;
}
