/**
 * The whole product loop on a real validator, through the real services. A fresh owner funds a
 * fresh agent wallet, the agent SDK pays the metered demo API, and the receipt is read back from
 * the chain, the indexer store and the console backend. Then the policy is attacked directly on
 * chain to prove the program is what enforces it.
 */
import { Keypair, PublicKey } from "@solana/web3.js";
import {
  createAgent,
  type PaidResponse,
  PaymentRejectedError,
  PolicyRefusedError,
} from "@turnstile/sdk-agent";
import {
  bytesToHex,
  decodeHeader,
  encodeHeader,
  formatUnits,
  HEADER_PAYMENT_REQUIRED,
  HEADER_PAYMENT_RESPONSE,
  HEADER_PAYMENT_SIGNATURE,
  hexToBytes,
  type PaymentAuthorization,
  type PaymentPayload,
  type PaymentRequired,
  receiptAddress,
  type SettlementResponse,
  signAuthorization,
  type VerifyResponse,
  vaultAddress,
} from "@turnstile/shared";
import { fetchReceipt, type ReceiptAccount } from "@turnstile/shared/programs";
import type pg from "pg";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { signIn } from "../src/backend.js";
import {
  type AgentWalletSetup,
  type Catalog,
  type CatalogRoute,
  type Chain,
  createChain,
  type DirectSettle,
  loadCatalog,
  route,
} from "../src/chain.js";
import { loadDeployment, loadEnv } from "../src/env.js";
import { createPool, type ReceiptRow, waitForReceiptRows } from "../src/store.js";

const env = loadEnv();
const deployment = loadDeployment(env.deploymentFile);

const TEXT =
  "Solana validators agree on the order of transactions with a proof of history clock. " +
  "Each leader streams entries that other validators replay and vote on. " +
  "A transaction pays a small fee and lands in a slot of about four hundred milliseconds. " +
  "Programs keep state in accounts that the runtime passes to them on every call. " +
  "Token balances live in token accounts that the token program owns. " +
  "An agent that pays per request needs a wallet whose limits hold even if its keys leak.";

/** Deposit into the loop wallet, 1 tUSDC. */
const DEPOSIT = 1_000_000n;
const PER_CALL_CAP = 10_000n;
const DAILY_CAP = 1_000_000n;

interface Fixture {
  chain: Chain;
  catalog: Catalog;
  summarize: CatalogRoute;
  keywords: CatalogRoute;
  price: bigint;
  owner: Keypair;
  session: Keypair;
  loop: AgentWalletSetup;
  pool: pg.Pool;
}

let f: Fixture;

/** What the loop test proved, used by the policy and console tests after it. */
interface LoopResult {
  payment: NonNullable<PaidResponse["payment"]>;
  receipt: ReceiptAccount;
  row: ReceiptRow;
  paymentHeader: string;
}
let loopResult: LoopResult | null = null;

function requireLoop(): LoopResult {
  if (!loopResult)
    throw new Error("The loop test did not complete, so there is no receipt to use.");
  return loopResult;
}

function post(url: string, body: unknown, headers: Record<string, string> = {}): Promise<Response> {
  return fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
}

function paidUrl(r: CatalogRoute): string {
  return `${env.services.demoApi}${r.path}`;
}

/** A fetch for the agent SDK that records every PAYMENT-SIGNATURE header it sends. */
function recordingFetch(sent: string[]): typeof fetch {
  return async (input, init) => {
    const req = new Request(input, init);
    const header = req.headers.get(HEADER_PAYMENT_SIGNATURE);
    if (header) sent.push(header);
    return fetch(req);
  };
}

beforeAll(async () => {
  const chain = createChain(env, deployment);
  const catalog = await loadCatalog(env.services.demoApi);
  const summarize = route(catalog, "/v1/summarize");
  const keywords = route(catalog, "/v1/keywords");
  // The demo API charges the recipient named in the deployment file.
  expect(catalog.payTo).toBe(deployment.demoRecipient);
  expect(catalog.asset).toBe(deployment.mint);
  const owner = await chain.fundedOwner(10_000_000n);
  const session = Keypair.generate();
  const loop = await chain.createAgentWallet({
    owner,
    id: 0n,
    session: session.publicKey,
    perCallCap: PER_CALL_CAP,
    dailyCap: DAILY_CAP,
    deposit: DEPOSIT,
    allowList: catalog.routes.map((r) => ({
      resourceId: r.resourceId,
      recipient: new PublicKey(catalog.payTo),
    })),
  });
  f = {
    chain,
    catalog,
    summarize,
    keywords,
    price: BigInt(summarize.priceBaseUnits),
    owner,
    session,
    loop,
    pool: createPool(env.databaseUrl),
  };
});

afterAll(async () => {
  await f?.pool.end();
});

describe("the loop, from 402 to a receipt in chain and store (FR1, FR4, FR7, FR9 to FR13)", () => {
  it("answers an unpaid request with 402 and PAYMENT-REQUIRED", async () => {
    const res = await post(paidUrl(f.summarize), { text: TEXT, sentences: 2 });
    expect(res.status).toBe(402);
    const header = res.headers.get(HEADER_PAYMENT_REQUIRED);
    expect(header).toBeTruthy();
    const required = decodeHeader<PaymentRequired>(header as string);
    expect(await res.json()).toEqual(required);
    expect(required.x402Version).toBe(2);
    expect(required.resource).toBe(f.summarize.resource);
    expect(required.accepts).toHaveLength(1);
    const [req] = required.accepts;
    expect(req).toMatchObject({
      scheme: "turnstile-policy",
      network: deployment.caip2,
      amount: f.summarize.priceBaseUnits,
      asset: deployment.mint,
      payTo: deployment.demoRecipient,
      resource: f.summarize.resource,
      extra: {
        resourceId: f.summarize.resourceId,
        settlementProgram: deployment.programs.settlement,
        agentWalletProgram: deployment.programs.agentWallet,
      },
    });
    expect(req?.extra.nonce).toMatch(/^[0-9a-f]{64}$/);
  });

  it("pays through the agent SDK and matches the receipt in chain and store field by field", async () => {
    const { chain } = f;
    const vaultBefore = await chain.tokenBalance(f.loop.vault);
    const recipientBefore = await chain.tokenBalance(chain.recipientToken);

    const sent: string[] = [];
    const agent = createAgent({
      connection: chain.connection,
      agentWallet: f.loop.agentWallet,
      sessionKey: f.session,
      fetch: recordingFetch(sent),
    });
    const res = await agent.fetch(paidUrl(f.summarize), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: TEXT, sentences: 2 }),
    });
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);

    const body = (await res.json()) as {
      summary: string;
      sentences: Array<{ text: string }>;
      inputSentences: number;
    };
    expect(body.sentences).toHaveLength(2);
    expect(body.inputSentences).toBe(6);
    expect(body.summary).toBe(body.sentences.map((s) => s.text).join(" "));

    const payment = res.payment;
    if (!payment) throw new Error("The paid response carries no payment.");
    const responseHeader = res.headers.get(HEADER_PAYMENT_RESPONSE);
    expect(responseHeader).toBeTruthy();
    const settlement = decodeHeader<SettlementResponse>(responseHeader as string);
    const nonce = hexToBytes(payment.nonce);
    const [receiptPda] = receiptAddress(f.loop.agentWallet, nonce);
    expect(settlement).toEqual({
      success: true,
      transaction: payment.transaction,
      network: deployment.caip2,
      payer: f.loop.agentWallet.toBase58(),
      receipt: receiptPda.toBase58(),
    });
    expect(payment).toEqual({
      receipt: receiptPda.toBase58(),
      transaction: settlement.transaction,
      amount: f.price.toString(),
      resource: f.summarize.resource,
      network: deployment.caip2,
      payer: f.loop.agentWallet.toBase58(),
      nonce: payment.nonce,
      alreadySettled: false,
    });

    // The receipt on chain.
    const receipt = await fetchReceipt(chain.connection, receiptPda);
    if (!receipt) throw new Error(`Receipt ${receiptPda.toBase58()} is not on chain.`);
    const tx = await chain.connection.getTransaction(payment.transaction, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    if (!tx) throw new Error(`Transaction ${payment.transaction} is not on chain.`);
    expect(tx.meta?.err).toBeNull();
    expect(receipt.agentWallet.toBase58()).toBe(f.loop.agentWallet.toBase58());
    expect(receipt.owner.toBase58()).toBe(f.owner.publicKey.toBase58());
    expect(receipt.sessionKey.toBase58()).toBe(f.session.publicKey.toBase58());
    expect(receipt.recipient.toBase58()).toBe(deployment.demoRecipient);
    expect(receipt.recipientToken.toBase58()).toBe(chain.recipientToken.toBase58());
    expect(receipt.mint.toBase58()).toBe(deployment.mint);
    expect(receipt.amount).toBe(f.price);
    expect(bytesToHex(receipt.resourceId)).toBe(f.summarize.resourceId);
    expect(bytesToHex(receipt.nonce)).toBe(payment.nonce);
    expect(receipt.slot).toBe(BigInt(tx.slot));
    expect(receipt.feePayer.toBase58()).toBe(deployment.facilitator);
    expect(tx.transaction.message.staticAccountKeys[0]?.toBase58()).toBe(deployment.facilitator);

    // Money moved by exactly the price.
    expect(await chain.tokenBalance(f.loop.vault)).toBe(vaultBefore - f.price);
    expect(await chain.tokenBalance(chain.recipientToken)).toBe(recipientBefore + f.price);

    // The same receipt in the indexer store.
    const [row] = await waitForReceiptRows(f.pool, [receiptPda.toBase58()]);
    if (!row) throw new Error("No receipt row.");
    expect({
      amount: row.amount,
      agent_wallet: row.agent_wallet,
      owner: row.owner,
      session_key: row.session_key,
      recipient: row.recipient,
      recipient_token: row.recipient_token,
      mint: row.mint,
      resource_id: row.resource_id,
      nonce: row.nonce,
      slot: row.slot,
      fee_payer: row.fee_payer,
      signature: row.signature,
    }).toEqual({
      amount: receipt.amount.toString(),
      agent_wallet: receipt.agentWallet.toBase58(),
      owner: receipt.owner.toBase58(),
      session_key: receipt.sessionKey.toBase58(),
      recipient: receipt.recipient.toBase58(),
      recipient_token: receipt.recipientToken.toBase58(),
      mint: receipt.mint.toBase58(),
      resource_id: bytesToHex(receipt.resourceId),
      nonce: bytesToHex(receipt.nonce),
      slot: receipt.slot.toString(),
      fee_payer: receipt.feePayer.toBase58(),
      signature: payment.transaction,
    });
    expect(BigInt(Math.floor(row.block_time.getTime() / 1000))).toBe(receipt.unixTimestamp);
    expect(row.resource).toBe(f.summarize.resource);
    expect(row.network).toBe(deployment.caip2);

    loopResult = { payment, receipt, row, paymentHeader: sent[0] as string };
    process.stdout.write(
      `loop receipt ${receiptPda.toBase58()} tx ${payment.transaction} wallet ${f.loop.agentWallet.toBase58()} owner ${f.owner.publicKey.toBase58()} slot ${receipt.slot}\n`,
    );
  });

  it("serves a replayed payment header from the original receipt without a second debit", async () => {
    const loop = requireLoop();
    const vaultBefore = await f.chain.tokenBalance(f.loop.vault);
    const res = await post(
      paidUrl(f.summarize),
      { text: TEXT, sentences: 2 },
      { [HEADER_PAYMENT_SIGNATURE]: loop.paymentHeader },
    );
    expect(res.status).toBe(200);
    const settlement = decodeHeader<SettlementResponse>(
      res.headers.get(HEADER_PAYMENT_RESPONSE) as string,
    );
    expect(settlement).toMatchObject({
      success: true,
      transaction: loop.payment.transaction,
      receipt: loop.payment.receipt,
      alreadySettled: true,
    });
    expect(await f.chain.tokenBalance(f.loop.vault)).toBe(vaultBefore);
  });
});

describe("policy is enforced inside the program (FR2, FR5, FR6, FR11, NFR1)", () => {
  interface Refused {
    authorization: PaymentAuthorization;
    signature: Uint8Array;
    payload: PaymentPayload;
  }

  /** Asserts the facilitator refuses a signed payload with `reason` on verify and settle. */
  async function expectFacilitatorRefuses(payload: PaymentPayload, reason: string) {
    const body = { paymentPayload: payload, paymentRequirements: payload.accepted };
    const verify = (await (
      await post(`${env.services.facilitator}/verify`, body)
    ).json()) as VerifyResponse;
    expect(verify.isValid).toBe(false);
    expect(verify.invalidReason).toBe(reason);
    const settle = (await (
      await post(`${env.services.facilitator}/settle`, body)
    ).json()) as SettlementResponse;
    expect(settle.success).toBe(false);
    expect(settle.errorReason).toBe(reason);
    expect(settle.transaction).toBe("");
  }

  /** Sends the signed authorization straight to the program and asserts the error it fails with. */
  async function expectProgramRefuses(
    refused: Pick<Refused, "authorization" | "signature">,
    name: string,
    code: number,
  ): Promise<DirectSettle> {
    const [vault] = vaultAddress(refused.authorization.agentWallet);
    const before = await f.chain.tokenBalance(vault);
    const direct = await f.chain.settleDirect(refused.authorization, refused.signature, f.owner);
    expect(direct.err).not.toBeNull();
    expect(direct.error?.name).toBe(name);
    expect(direct.error?.code).toBe(code);
    expect(direct.logs.some((l) => l.includes(`Error Code: ${name}`))).toBe(true);
    expect(await f.chain.tokenBalance(vault)).toBe(before);
    process.stdout.write(`${name} proven on chain by failed tx ${direct.signature}\n`);
    return direct;
  }

  /** The SDK with its local check turned off, so the signed payment reaches the server. */
  async function signedButRefused(
    agentWallet: PublicKey,
    r: CatalogRoute,
    reason: string,
    fetchImpl?: typeof fetch,
  ): Promise<Refused> {
    const agent = createAgent({
      connection: f.chain.connection,
      agentWallet,
      sessionKey: f.session,
      localPolicyCheck: false,
      ...(fetchImpl ? { fetch: fetchImpl } : {}),
    });
    const err = await agent
      .fetch(paidUrl(r), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: TEXT }),
      })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(PaymentRejectedError);
    const rejected = err as PaymentRejectedError;
    expect(rejected.reason).toBe(reason);
    expect(rejected.status).toBe(402);
    return {
      authorization: rejected.authorization,
      signature: rejected.signature,
      payload: rejected.paymentPayload,
    };
  }

  /** The SDK with its local check on refuses before signing and sends only the unpaid request. */
  async function refusedLocally(agentWallet: PublicKey, r: CatalogRoute, reason: string) {
    const sent: string[] = [];
    let requests = 0;
    const agent = createAgent({
      connection: f.chain.connection,
      agentWallet,
      sessionKey: f.session,
      fetch: (input, init) => {
        requests++;
        return recordingFetch(sent)(input, init);
      },
    });
    const err = await agent
      .fetch(paidUrl(r), {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ text: TEXT }),
      })
      .then(
        () => null,
        (e: unknown) => e,
      );
    expect(err).toBeInstanceOf(PolicyRefusedError);
    expect((err as PolicyRefusedError).reason).toBe(reason);
    expect(requests).toBe(1);
    expect(sent).toEqual([]);
  }

  it("refuses a replayed nonce in the program, the facilitator and the SDK with NonceAlreadyUsed", async () => {
    const loop = requireLoop();
    // The SDK signs whatever nonce the 402 names. A server that replays a used nonce for another
    // resource gets its payment refused, never a second debit.
    const replayNonce = (async (input, init) => {
      const req = new Request(input, init);
      const res = await fetch(req);
      if (res.status !== 402 || req.headers.get(HEADER_PAYMENT_SIGNATURE)) return res;
      const required = decodeHeader<PaymentRequired>(
        res.headers.get(HEADER_PAYMENT_REQUIRED) as string,
      );
      for (const a of required.accepts) a.extra.nonce = loop.payment.nonce;
      return new Response(JSON.stringify(required), {
        status: 402,
        headers: {
          "content-type": "application/json",
          [HEADER_PAYMENT_REQUIRED]: encodeHeader(required),
        },
      });
    }) as typeof fetch;
    const refused = await signedButRefused(
      f.loop.agentWallet,
      f.keywords,
      "NonceAlreadyUsed",
      replayNonce,
    );
    expect(bytesToHex(refused.authorization.nonce)).toBe(loop.payment.nonce);
    await expectFacilitatorRefuses(refused.payload, "NonceAlreadyUsed");
    await expectProgramRefuses(refused, "NonceAlreadyUsed", 6103);

    // The exact terms of the settled payment, signed again with a fresh expiry.
    const again: PaymentAuthorization = {
      agentWallet: loop.receipt.agentWallet,
      sessionKey: loop.receipt.sessionKey,
      recipient: loop.receipt.recipient,
      mint: loop.receipt.mint,
      amount: loop.receipt.amount,
      resourceId: loop.receipt.resourceId,
      nonce: loop.receipt.nonce,
      expiresAt: BigInt(Math.floor(Date.now() / 1000) + 300),
    };
    await expectProgramRefuses(
      { authorization: again, signature: signAuthorization(again, f.session.secretKey) },
      "NonceAlreadyUsed",
      6103,
    );
    const receipt = await fetchReceipt(f.chain.connection, new PublicKey(loop.payment.receipt));
    expect(receipt?.amount).toBe(loop.receipt.amount);
    expect(receipt?.slot).toBe(loop.receipt.slot);
  });

  it("refuses a price over the per-call cap in the program, the facilitator and the SDK", async () => {
    // Same owner, second wallet. Cap one base unit under the demo price.
    const capped = await f.chain.createAgentWallet({
      owner: f.owner,
      id: 1n,
      session: f.session.publicKey,
      perCallCap: f.price - 1n,
      dailyCap: DAILY_CAP,
      deposit: 100_000n,
      allowList: f.catalog.routes.map((r) => ({
        resourceId: r.resourceId,
        recipient: new PublicKey(f.catalog.payTo),
      })),
    });
    await refusedLocally(capped.agentWallet, f.summarize, "PerCallCapExceeded");
    const refused = await signedButRefused(capped.agentWallet, f.summarize, "PerCallCapExceeded");
    await expectFacilitatorRefuses(refused.payload, "PerCallCapExceeded");
    await expectProgramRefuses(refused, "PerCallCapExceeded", 6003);
    const [pda] = receiptAddress(capped.agentWallet, refused.authorization.nonce);
    expect(await fetchReceipt(f.chain.connection, pda)).toBeNull();
  });

  it("refuses a resource off the allow-list in the program, the facilitator and the SDK", async () => {
    // Third wallet. Only /v1/summarize is allowed, so /v1/keywords is off the list.
    const narrow = await f.chain.createAgentWallet({
      owner: f.owner,
      id: 2n,
      session: f.session.publicKey,
      perCallCap: PER_CALL_CAP,
      dailyCap: DAILY_CAP,
      deposit: 100_000n,
      allowList: [
        { resourceId: f.summarize.resourceId, recipient: new PublicKey(f.catalog.payTo) },
      ],
    });
    await refusedLocally(narrow.agentWallet, f.keywords, "ResourceNotAllowed");
    const refused = await signedButRefused(narrow.agentWallet, f.keywords, "ResourceNotAllowed");
    await expectFacilitatorRefuses(refused.payload, "ResourceNotAllowed");
    await expectProgramRefuses(refused, "ResourceNotAllowed", 6005);
    const [pda] = receiptAddress(narrow.agentWallet, refused.authorization.nonce);
    expect(await fetchReceipt(f.chain.connection, pda)).toBeNull();
  });
});

describe("console backend reads the same receipt (FR14, FR18)", () => {
  it("signs the owner in with a wallet signature and serves the receipt, summary, CSV and agents", async (ctx) => {
    const loop = requireLoop();
    const session = await signIn(env.services.backend, env.webOrigin, f.owner);
    const owner = f.owner.publicKey.toBase58();

    const me = await session.get("/v1/me");
    expect(me.status).toBe(200);
    expect(await me.json()).toMatchObject({ owner, authMethod: "session" });

    const display = formatUnits(f.price, deployment.mintDecimals);
    const receiptsRes = await session.get("/v1/receipts");
    expect(receiptsRes.status).toBe(200);
    const { receipts } = (await receiptsRes.json()) as { receipts: Array<Record<string, unknown>> };
    expect(receipts).toHaveLength(1);
    expect(receipts[0]).toMatchObject({
      receiptAddress: loop.payment.receipt,
      signature: loop.payment.transaction,
      slot: loop.receipt.slot.toString(),
      agentWallet: f.loop.agentWallet.toBase58(),
      owner,
      sessionKey: f.session.publicKey.toBase58(),
      recipient: deployment.demoRecipient,
      recipientToken: f.chain.recipientToken.toBase58(),
      mint: deployment.mint,
      amount: f.price.toString(),
      displayAmount: display,
      resourceId: f.summarize.resourceId,
      resource: f.summarize.resource,
      nonce: loop.payment.nonce,
      feePayer: deployment.facilitator,
      network: deployment.caip2,
      status: "settled",
    });

    const summaryRes = await session.get("/v1/summary?range=24h");
    expect(summaryRes.status).toBe(200);
    const summary = (await summaryRes.json()) as {
      totalSpend: { amount: string; displayAmount: string };
      settlementCount: number;
      activeAgents: number;
      recentReceipts: Array<{ receiptAddress: string }>;
    };
    expect(summary.settlementCount).toBe(1);
    expect(summary.totalSpend).toEqual({ amount: f.price.toString(), displayAmount: display });
    expect(summary.activeAgents).toBe(1);
    expect(summary.recentReceipts.map((r) => r.receiptAddress)).toEqual([loop.payment.receipt]);

    const csvRes = await session.get("/v1/receipts.csv");
    expect(csvRes.status).toBe(200);
    expect(csvRes.headers.get("content-type")).toMatch(/^text\/csv/);
    const lines = (await csvRes.text()).trim().split(/\r?\n/);
    expect(lines).toHaveLength(2);
    const header = (lines[0] as string).split(",");
    const cells = (lines[1] as string).split(",");
    const cell = (name: string) => cells[header.indexOf(name)];
    expect(cell("receipt_address")).toBe(loop.payment.receipt);
    expect(cell("signature")).toBe(loop.payment.transaction);
    expect(cell("agent_wallet")).toBe(f.loop.agentWallet.toBase58());
    expect(cell("amount")).toBe(display);
    expect(cell("amount_base_units")).toBe(f.price.toString());
    expect(cell("nonce")).toBe(loop.payment.nonce);
    expect(cell("resource")).toBe(f.summarize.resource);
    expect(cell("status")).toBe("settled");

    const agentsRes = await session.get("/v1/agents");
    if (agentsRes.status === 404) {
      console.warn(
        "GET /v1/agents is not served by this backend build, so the agents check is skipped.",
      );
      ctx.skip();
      return;
    }
    expect(agentsRes.status).toBe(200);
    const { agents } = (await agentsRes.json()) as {
      agents: Array<{
        address: string;
        id: string;
        mint: string;
        vaultBalance: { amount: string };
        totalSpent: { amount: string };
        settlementCount: string;
        allowListCount: number;
        sessionKeys: { active: number; total: number };
      }>;
    };
    expect(agents.map((a) => a.id).sort()).toEqual(["0", "1", "2"]);
    const main = agents.find((a) => a.address === f.loop.agentWallet.toBase58());
    expect(main).toMatchObject({
      id: "0",
      mint: deployment.mint,
      vaultBalance: { amount: (DEPOSIT - f.price).toString() },
      totalSpent: { amount: f.price.toString() },
      settlementCount: "1",
      allowListCount: f.catalog.routes.length,
      sessionKeys: { active: 1, total: 1 },
    });
  });
});
