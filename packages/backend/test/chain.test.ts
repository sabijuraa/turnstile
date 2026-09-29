import { Keypair, PublicKey, Transaction } from "@solana/web3.js";
import bs58 from "bs58";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { AgentDetailView, AgentSummaryView } from "../src/chain/agents.js";
import type { BuiltTransaction } from "../src/routes/tx.js";
import { closePool, type Harness, harness, jsonPost, resetDb, signIn } from "./helpers.js";
import {
  airdrop,
  createMint,
  type LocalValidator,
  mintTo,
  startValidator,
  tokenBalance,
} from "./validator.js";

const started = await startValidator();
const skipReason = "skip" in started ? started.skip : null;
if (skipReason) console.warn(`Skipping chain tests. ${skipReason}.`);
const validator = "skip" in started ? null : (started as LocalValidator);

interface TxResponse {
  agentWallet: string;
  feePayer: string;
  transactions: BuiltTransaction[];
}

interface ErrorResponse {
  error: { code: string; message: string };
}

const SUMMARIZE = "https://demo.turnstile.dev/v1/summarize";
const QUOTE = "https://data.example.com/v1/quote/";

describe.skipIf(validator === null)("chain operations against a local validator", () => {
  const v = validator as LocalValidator;
  let h: Harness;
  let other: Harness;
  const owner = Keypair.generate();
  const stranger = Keypair.generate();
  const mint = Keypair.generate();
  const recipient = Keypair.generate().publicKey.toBase58();
  let cookie: string;
  let strangerCookie: string;
  let agent: string;

  beforeAll(async () => {
    await airdrop(v.connection, owner.publicKey);
    await airdrop(v.connection, stranger.publicKey);
    await createMint(v.connection, owner, mint);
    await mintTo(v.connection, owner, mint.publicKey, owner.publicKey, 100_000_000n);
    const config = {
      rpcUrl: v.url,
      deployment: { mint: mint.publicKey.toBase58(), mintDecimals: 6 },
      confirmTimeoutMs: 20_000,
    };
    h = await harness({ realTime: true, rpc: v.connection, config });
    other = h;
    await resetDb(h.pool);
    cookie = await signIn(h, owner);
    strangerCookie = await signIn(other, stranger);
  }, 120_000);

  afterAll(async () => {
    await closePool();
    v.stop();
  });

  async function post(path: string, body: unknown, as = cookie): Promise<Response> {
    return h.app.request(path, jsonPost(body, { cookie: as }));
  }

  /** Signs every built transaction as the owner wallet would, sends it and confirms through the API. */
  async function signSendConfirm(res: Response, signer: Keypair = owner): Promise<string[]> {
    expect(res.status).toBe(200);
    const body = (await res.json()) as TxResponse;
    expect(body.feePayer).toBe(signer.publicKey.toBase58());
    const sigs: string[] = [];
    for (const built of body.transactions) {
      const tx = Transaction.from(Buffer.from(built.transaction, "base64"));
      expect(tx.signatures.every((s) => s.signature === null)).toBe(true);
      tx.partialSign(signer);
      const sig = await v.connection.sendRawTransaction(tx.serialize());
      const confirmed = await post("/v1/tx/confirm", { signature: sig });
      const status = (await confirmed.json()) as { status: string; error: unknown };
      expect(status).toMatchObject({ status: "confirmed", error: null });
      sigs.push(sig);
    }
    return sigs;
  }

  async function detail(address: string): Promise<AgentDetailView> {
    const res = await h.app.request(`/v1/agents/${address}`, { headers: { cookie } });
    expect(res.status).toBe(200);
    return ((await res.json()) as { agent: AgentDetailView }).agent;
  }

  it("creates, funds and sets the allow-list of an agent in one transaction", async () => {
    const session = Keypair.generate().publicKey.toBase58();
    const res = await post("/v1/tx/create-agent", {
      sessionKey: session,
      perCallCap: "0.05",
      dailyCap: "2",
      deposit: "5",
      allowList: [
        { resource: SUMMARIZE, recipient },
        { resource: QUOTE, recipient },
      ],
    });
    const body = (await res.clone().json()) as TxResponse;
    expect(body.transactions).toHaveLength(1);
    expect(body.transactions[0]?.instructions).toEqual([
      "create_wallet",
      "deposit",
      "update_policy",
    ]);
    agent = body.agentWallet;
    await signSendConfirm(res);

    const list = await h.app.request("/v1/agents", { headers: { cookie } });
    const agents = ((await list.json()) as { agents: AgentSummaryView[] }).agents;
    expect(agents).toHaveLength(1);
    expect(agents[0]).toMatchObject({
      address: agent,
      id: "0",
      vaultBalance: { amount: "5000000", displayAmount: "5" },
      perCallCap: { amount: "50000", displayAmount: "0.05" },
      dailyCap: { amount: "2000000", displayAmount: "2" },
      rollingSpend: { amount: "0" },
      todaySpend: { amount: "0" },
      status: "active",
      attention: [],
      sessionKeys: { active: 1, total: 1 },
      allowListCount: 2,
    });
    const d = await detail(agent);
    expect(d.owner).toBe(owner.publicKey.toBase58());
    expect(d.allowList.map((e) => [e.resource, e.recipient])).toEqual([
      [SUMMARIZE, recipient],
      ["https://data.example.com/v1/quote", recipient],
    ]);
    expect(d.sessionKeyList).toEqual([
      { key: session, expiresAt: null, active: true, status: "active" },
    ]);
    expect(await tokenBalance(v.connection, owner.publicKey, mint.publicKey)).toBe(95_000_000n);
  });

  it("rejects bad policy input with precise messages", async () => {
    const session = Keypair.generate().publicKey.toBase58();
    const over = await post("/v1/tx/create-agent", {
      sessionKey: session,
      perCallCap: "3",
      dailyCap: "2",
    });
    expect(over.status).toBe(400);
    expect(await over.json()).toEqual({
      error: {
        code: "invalid_request",
        message:
          "perCallCap must not be above dailyCap. Lower the per-call cap or raise the daily cap.",
      },
    });
    const precise = await post("/v1/tx/deposit", { agentWallet: agent, amount: "1.0000001" });
    expect(await precise.json()).toEqual({
      error: {
        code: "invalid_request",
        message: "amount has more than 6 decimal places. The stablecoin has 6 decimals.",
      },
    });
    const tooMany = await post("/v1/tx/update-policy", {
      agentWallet: agent,
      perCallCap: "1",
      dailyCap: "2",
      allowList: Array.from({ length: 16 }, (_, i) => ({
        resource: `${SUMMARIZE}/${i}`,
        recipient,
      })),
    });
    expect(await tooMany.json()).toEqual({
      error: {
        code: "invalid_request",
        message:
          "allowList can hold at most 15 entries per policy update. Remove some entries and try again.",
      },
    });
    const broke = await post("/v1/tx/deposit", { agentWallet: agent, amount: "1000" });
    expect(await broke.json()).toEqual({
      error: {
        code: "insufficient_owner_balance",
        message:
          "Your wallet holds 95, less than the 1000 you want to deposit. Deposit less or fund your wallet first.",
      },
    });
    const self = await post("/v1/tx/add-session-key", {
      agentWallet: agent,
      sessionKey: owner.publicKey.toBase58(),
    });
    expect(((await self.json()) as ErrorResponse).error.message).toBe(
      "sessionKey must be a separate key from your owner wallet. Generate a new key for the agent.",
    );
  });

  it("deposits and withdraws exact amounts", async () => {
    await signSendConfirm(await post("/v1/tx/deposit", { agentWallet: agent, amount: "2.5" }));
    await signSendConfirm(await post("/v1/tx/withdraw", { agentWallet: agent, amount: "1.25" }));
    expect((await detail(agent)).vaultBalance).toEqual({
      amount: "6250000",
      displayAmount: "6.25",
    });
    expect(await tokenBalance(v.connection, owner.publicKey, mint.publicKey)).toBe(93_750_000n);
    const tooMuch = await post("/v1/tx/withdraw", { agentWallet: agent, amount: "7" });
    expect(((await tooMuch.json()) as ErrorResponse).error.code).toBe("insufficient_vault_balance");
  });

  it("replaces the policy", async () => {
    await signSendConfirm(
      await post("/v1/tx/update-policy", {
        agentWallet: agent,
        perCallCap: "0.1",
        dailyCap: "10",
        allowList: [{ resource: SUMMARIZE, recipient }],
      }),
    );
    const d = await detail(agent);
    expect(d.perCallCap.displayAmount).toBe("0.1");
    expect(d.dailyCap.displayAmount).toBe("10");
    expect(d.allowList.map((e) => e.resource)).toEqual([SUMMARIZE]);
  });

  it("adds and revokes session keys", async () => {
    const extra = Keypair.generate().publicKey.toBase58();
    const expiresAt = new Date(Date.now() + 7 * 86_400_000).toISOString();
    await signSendConfirm(
      await post("/v1/tx/add-session-key", { agentWallet: agent, sessionKey: extra, expiresAt }),
    );
    let d = await detail(agent);
    expect(d.sessionKeyList.find((k) => k.key === extra)).toMatchObject({
      status: "active",
      expiresAt: `${expiresAt.slice(0, 19)}.000Z`,
    });
    const dup = await post("/v1/tx/add-session-key", { agentWallet: agent, sessionKey: extra });
    expect(((await dup.json()) as ErrorResponse).error.code).toBe("duplicate_session_key");

    await signSendConfirm(
      await post("/v1/tx/revoke-session-key", { agentWallet: agent, sessionKey: extra }),
    );
    d = await detail(agent);
    expect(d.sessionKeyList.find((k) => k.key === extra)?.status).toBe("revoked");
    expect(d.sessionKeys).toEqual({ active: 1, total: 2 });
    const again = await post("/v1/tx/revoke-session-key", {
      agentWallet: agent,
      sessionKey: extra,
    });
    expect(((await again.json()) as ErrorResponse).error.code).toBe("session_key_revoked");
  });

  it("keeps other owners out", async () => {
    const view = await h.app.request(`/v1/agents/${agent}`, {
      headers: { cookie: strangerCookie },
    });
    expect(view.status).toBe(403);
    const dep = await post("/v1/tx/deposit", { agentWallet: agent, amount: "1" }, strangerCookie);
    expect(dep.status).toBe(403);
    expect(((await dep.json()) as ErrorResponse).error.code).toBe("not_agent_owner");
    const list = await h.app.request("/v1/agents", { headers: { cookie: strangerCookie } });
    expect(await list.json()).toEqual({ agents: [] });
    const missing = await h.app.request(`/v1/agents/${Keypair.generate().publicKey.toBase58()}`, {
      headers: { cookie },
    });
    expect(missing.status).toBe(404);
  });

  it("reports a transaction the program rejects as failed with the program error", async () => {
    const all = (await (
      await post("/v1/tx/withdraw", { agentWallet: agent, amount: "6.25" })
    ).json()) as TxResponse;
    const some = (await (
      await post("/v1/tx/withdraw", { agentWallet: agent, amount: "6" })
    ).json()) as TxResponse;
    const first = Transaction.from(Buffer.from(all.transactions[0]?.transaction ?? "", "base64"));
    first.partialSign(owner);
    const s1 = await v.connection.sendRawTransaction(first.serialize());
    expect(await (await post("/v1/tx/confirm", { signature: s1 })).json()).toMatchObject({
      status: "confirmed",
    });
    const second = Transaction.from(Buffer.from(some.transactions[0]?.transaction ?? "", "base64"));
    second.partialSign(owner);
    const s2 = await v.connection.sendRawTransaction(second.serialize(), { skipPreflight: true });
    const res = await post("/v1/tx/confirm", { signature: s2 });
    expect(await res.json()).toMatchObject({
      signature: s2,
      status: "failed",
      error: {
        code: 6007,
        name: "InsufficientFunds",
        message: "The vault does not hold enough tokens. Deposit more before paying or withdrawing",
      },
    });
  });

  it("answers pending for a signature the network has not seen", async () => {
    const unseen = bs58.encode(crypto.getRandomValues(new Uint8Array(64)));
    const res = await post("/v1/tx/confirm", { signature: unseen, timeoutMs: 300 });
    expect(await res.json()).toMatchObject({ status: "pending", slot: null, error: null });
  });

  it("shows pending dead letters for a chain-only agent in the summary", async () => {
    await h.pool.query(
      `INSERT INTO settlement_dead_letters (agent_wallet, nonce, payload, requirements, error)
       VALUES ($1, 'n', '{}', '{"amount":"1000"}', 'blockhash expired')`,
      [agent],
    );
    const res = await h.app.request("/v1/summary", { headers: { cookie } });
    expect(await res.json()).toMatchObject({
      notices: [],
      failures: { pendingCount: 1, items: [{ agentWallet: agent, error: "blockhash expired" }] },
    });
  });

  it("closes a funded wallet only when told to withdraw the rest", async () => {
    await signSendConfirm(await post("/v1/tx/deposit", { agentWallet: agent, amount: "3" }));
    const refused = await post("/v1/tx/close-wallet", { agentWallet: agent });
    expect(await refused.json()).toEqual({
      error: {
        code: "vault_not_empty",
        message:
          "The agent vault still holds 3. Withdraw it first or send withdrawRemaining true to do both in one transaction.",
      },
    });
    const before = await tokenBalance(v.connection, owner.publicKey, mint.publicKey);
    await signSendConfirm(
      await post("/v1/tx/close-wallet", { agentWallet: agent, withdrawRemaining: true }),
    );
    expect(await tokenBalance(v.connection, owner.publicKey, mint.publicKey)).toBe(
      before + 3_000_000n,
    );
    expect(await v.connection.getAccountInfo(new PublicKey(agent))).toBeNull();
    const list = await h.app.request("/v1/agents", { headers: { cookie } });
    expect(await list.json()).toEqual({ agents: [] });
  });

  it("splits a create with a full allow-list into two transactions when it does not fit", async () => {
    const res = await post("/v1/tx/create-agent", {
      sessionKey: Keypair.generate().publicKey.toBase58(),
      perCallCap: "1",
      dailyCap: "5",
      deposit: "1",
      allowList: Array.from({ length: 15 }, (_, i) => ({
        resource: `${SUMMARIZE}/${i}`,
        recipient: Keypair.generate().publicKey.toBase58(),
      })),
    });
    const body = (await res.clone().json()) as TxResponse & { id: string };
    // Wallet 0 was closed above, so its id is free again.
    expect(body.id).toBe("0");
    expect(body.transactions.map((t) => t.instructions)).toEqual([
      ["create_wallet", "deposit"],
      ["update_policy"],
    ]);
    await signSendConfirm(res);
    const d = await detail(body.agentWallet);
    expect(d.allowList).toHaveLength(15);
    expect(d.allowList[14]?.resource).toBe(`${SUMMARIZE}/14`);
    expect(d.vaultBalance.displayAmount).toBe("1");
  });
});
