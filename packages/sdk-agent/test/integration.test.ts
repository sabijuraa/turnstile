/**
 * Pays a real paywall through a real facilitator on a real validator.
 *
 * Needs a running stack, for example after infra/scripts/dev-up.sh plus a facilitator:
 *   TURNSTILE_INTEGRATION=1 SOLANA_RPC_URL=... DEPLOYMENT_FILE=... KEYS_DIR=... FACILITATOR_URL=...
 * Skipped without TURNSTILE_INTEGRATION=1.
 */
import { readFileSync } from "node:fs";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { serve } from "@hono/node-server";
import { AccountLayout, getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { honoPaywall } from "@turnstile/sdk-resource";
import { agentWalletAddress, resourceId, vaultAddress } from "@turnstile/shared";
import {
  createWalletInstruction,
  depositInstruction,
  fetchReceipt,
  updatePolicyInstruction,
  withdrawInstruction,
} from "@turnstile/shared/programs";
import { Hono } from "hono";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createAgent, type PaymentEvent, PolicyRefusedError } from "../src/index.js";
import { readKeypairFile } from "../src/keys.js";

const enabled = process.env.TURNSTILE_INTEGRATION === "1";
const env = (name: string): string => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} must be set for the integration test.`);
  return v;
};

describe.skipIf(!enabled)("agent SDK against validator and facilitator", () => {
  let connection: Connection;
  let owner: Keypair;
  let mint: PublicKey;
  let recipient: PublicKey;
  let agentWallet: PublicKey;
  let ownerToken: PublicKey;
  let server: ReturnType<typeof serve>;
  let baseUrl: string;
  const session = Keypair.generate();

  async function send(ixs: TransactionInstruction[]): Promise<string> {
    const latest = await connection.getLatestBlockhash("confirmed");
    const tx = new Transaction({ feePayer: owner.publicKey, ...latest }).add(...ixs);
    tx.sign(owner);
    const sig = await connection.sendRawTransaction(tx.serialize());
    const res = await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
    if (res.value.err)
      throw new Error(`transaction ${sig} failed ${JSON.stringify(res.value.err)}`);
    return sig;
  }

  async function vaultBalance(): Promise<bigint> {
    const info = await connection.getAccountInfo(vaultAddress(agentWallet)[0], "confirmed");
    if (!info) throw new Error("vault missing");
    return AccountLayout.decode(info.data).amount;
  }

  beforeAll(async () => {
    const deployment = JSON.parse(readFileSync(env("DEPLOYMENT_FILE"), "utf8")) as {
      mint: string;
      demoRecipient: string;
    };
    connection = new Connection(env("SOLANA_RPC_URL"), "confirmed");
    owner = readKeypairFile(join(env("KEYS_DIR"), "demo-owner.json"));
    mint = new PublicKey(deployment.mint);
    recipient = new PublicKey(deployment.demoRecipient);
    ownerToken = getAssociatedTokenAddressSync(mint, owner.publicKey);

    const app = new Hono();
    app.use(
      "*",
      honoPaywall({
        facilitatorUrl: env("FACILITATOR_URL"),
        payTo: recipient.toBase58(),
        routes: { "POST /paid": { price: "0.005", description: "integration test route" } },
      }),
    );
    app.post("/paid", (c) => c.json({ served: true }));
    await new Promise<void>((resolve) => {
      server = serve({ fetch: app.fetch, port: 0, hostname: "127.0.0.1" }, () => resolve());
    });
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    // A fresh wallet with the next free id. Daily cap 0.012 fits two calls at 0.005.
    let id = BigInt(Date.now());
    while (await connection.getAccountInfo(agentWalletAddress(owner.publicKey, id)[0])) id++;
    agentWallet = agentWalletAddress(owner.publicKey, id)[0];
    await send([
      createWalletInstruction({
        owner: owner.publicKey,
        mint,
        id,
        perCallCap: 10_000n,
        dailyCap: 12_000n,
        sessionKey: session.publicKey,
        sessionExpiresAt: 0n,
      }),
      depositInstruction({ owner: owner.publicKey, agentWallet, ownerToken, amount: 50_000n }),
      updatePolicyInstruction({
        owner: owner.publicKey,
        agentWallet,
        perCallCap: 10_000n,
        dailyCap: 12_000n,
        allowList: [{ resourceId: resourceId(`${baseUrl}/paid`), recipient }],
      }),
    ]);
  });

  afterAll(async () => {
    server?.close();
    if (agentWallet) {
      const amount = await vaultBalance();
      if (amount > 0n) {
        await send([
          withdrawInstruction({ owner: owner.publicKey, agentWallet, ownerToken, amount }),
        ]);
      }
    }
  });

  it("settles two payments on chain and refuses the third locally without signing", async () => {
    const events: PaymentEvent[] = [];
    let requests = 0;
    const agent = createAgent({
      connection,
      agentWallet,
      sessionKey: session,
      onPayment: (e) => events.push(e),
      fetch: (input, init) => {
        requests++;
        return fetch(input, init);
      },
    });

    for (let i = 0; i < 2; i++) {
      const started = performance.now();
      const res = await agent.fetch(`${baseUrl}/paid`, { method: "POST" });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ served: true });
      const payment = res.payment;
      if (!payment) throw new Error("no payment attached");
      const receipt = await fetchReceipt(connection, new PublicKey(payment.receipt));
      expect(receipt?.amount).toBe(5_000n);
      expect(receipt?.agentWallet.equals(agentWallet)).toBe(true);
      expect(receipt?.sessionKey.equals(session.publicKey)).toBe(true);
      expect(receipt?.recipient.equals(recipient)).toBe(true);
      console.warn(
        `paid call ${i + 1} settled in ${Math.round(performance.now() - started)} ms, receipt ${payment.receipt}, tx ${payment.transaction}`,
      );
    }
    expect(await vaultBalance()).toBe(40_000n);
    expect(requests).toBe(4);

    const err = await agent.fetch(`${baseUrl}/paid`, { method: "POST" }).catch((e) => e);
    expect(err).toBeInstanceOf(PolicyRefusedError);
    expect(err.reason).toBe("DailyCapExceeded");
    // Only the unpaid request went out. Nothing was signed or sent to the facilitator.
    expect(requests).toBe(5);
    expect(await vaultBalance()).toBe(40_000n);
    expect(events.map((e) => e.type)).toEqual(["settled", "settled", "refused"]);
  });
});
