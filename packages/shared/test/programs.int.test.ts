/**
 * End to end test against a real solana-test-validator with both programs loaded.
 * Set TURNSTILE_TEST_RPC_URL to run it, for example http://127.0.0.1:18899. Without it the
 * suite is skipped so unit test runs stay fast.
 */
import { createAssociatedTokenAccount, createMint, getAccount, mintTo } from "@solana/spl-token";
import {
  Connection,
  Keypair,
  LAMPORTS_PER_SOL,
  type PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import { beforeAll, describe, expect, it } from "vitest";
import {
  agentWalletAddress,
  evaluatePayment,
  type PaymentAuthorization,
  randomNonce,
  receiptAddress,
  resourceId,
  signAuthorization,
  vaultAddress,
} from "../src/index.js";
import {
  createWalletInstruction,
  decodePaymentSettledEvents,
  decodeRollingSpendReturnData,
  depositInstruction,
  fetchAgentWallet,
  fetchReceipt,
  parseProgramError,
  rollingSpendInstruction,
  settleInstructions,
  updatePolicyInstruction,
} from "../src/programs/index.js";

const RPC_URL = process.env.TURNSTILE_TEST_RPC_URL;

if (!RPC_URL) {
  console.warn(
    "Skipping programs.int.test.ts. Set TURNSTILE_TEST_RPC_URL to a validator with both programs loaded to run it.",
  );
}

const SUITE = RPC_URL
  ? "programs against a local validator"
  : "programs against a local validator, skipped because TURNSTILE_TEST_RPC_URL is not set";

describe.skipIf(!RPC_URL)(SUITE, () => {
  const connection = new Connection(RPC_URL ?? "http://127.0.0.1:8899", "confirmed");
  const owner = Keypair.generate();
  const facilitator = Keypair.generate();
  const session = Keypair.generate();
  const recipient = Keypair.generate();
  const walletId = BigInt(Date.now());
  const [agentWallet] = agentWalletAddress(owner.publicKey, walletId);
  const [vault] = vaultAddress(agentWallet);
  const rid = resourceId("https://demo.turnstile.dev/v1/summarize");
  let mint: PublicKey;
  let ownerToken: PublicKey;
  let recipientToken: PublicKey;

  async function send(ixs: TransactionInstruction[], signers: Keypair[]): Promise<string> {
    return sendAndConfirmTransaction(connection, new Transaction().add(...ixs), signers, {
      commitment: "confirmed",
    });
  }

  async function airdrop(key: PublicKey): Promise<void> {
    const sig = await connection.requestAirdrop(key, 10 * LAMPORTS_PER_SOL);
    const latest = await connection.getLatestBlockhash("confirmed");
    await connection.confirmTransaction({ signature: sig, ...latest }, "confirmed");
  }

  function authorization(amount: bigint): PaymentAuthorization {
    return {
      agentWallet,
      sessionKey: session.publicKey,
      recipient: recipient.publicKey,
      mint,
      amount,
      resourceId: rid,
      nonce: randomNonce(),
      expiresAt: BigInt(Math.floor(Date.now() / 1000) + 300),
    };
  }

  beforeAll(async () => {
    await airdrop(owner.publicKey);
    await airdrop(facilitator.publicKey);
    mint = await createMint(connection, owner, owner.publicKey, null, 6);
    ownerToken = await createAssociatedTokenAccount(connection, owner, mint, owner.publicKey);
    recipientToken = await createAssociatedTokenAccount(
      connection,
      owner,
      mint,
      recipient.publicKey,
    );
    await mintTo(connection, owner, mint, ownerToken, owner, 10_000_000n);
  }, 60_000);

  it("creates, funds and sets policy on a wallet", async () => {
    await send(
      [
        createWalletInstruction({
          owner: owner.publicKey,
          mint,
          id: walletId,
          perCallCap: 100_000n,
          dailyCap: 250_000n,
          sessionKey: session.publicKey,
          sessionExpiresAt: 0n,
        }),
        depositInstruction({ owner: owner.publicKey, agentWallet, ownerToken, amount: 1_000_000n }),
        updatePolicyInstruction({
          owner: owner.publicKey,
          agentWallet,
          perCallCap: 100_000n,
          dailyCap: 250_000n,
          allowList: [{ resourceId: rid, recipient: recipient.publicKey }],
        }),
      ],
      [owner],
    );
    const wallet = await fetchAgentWallet(connection, agentWallet);
    expect(wallet?.owner.equals(owner.publicKey)).toBe(true);
    expect(wallet?.vault.equals(vault)).toBe(true);
    expect(wallet?.policy.allowList).toHaveLength(1);
    expect((await getAccount(connection, vault)).amount).toBe(1_000_000n);
  }, 60_000);

  it("settles a signed authorization, writes the receipt and emits the event", async () => {
    const auth = authorization(40_000n);
    const signature = signAuthorization(auth, session.secretKey);
    const ixs = settleInstructions({
      authorization: auth,
      signature,
      feePayer: facilitator.publicKey,
    });
    const txSig = await send(ixs, [facilitator]);

    const [receiptKey] = receiptAddress(agentWallet, auth.nonce);
    const receipt = await fetchReceipt(connection, receiptKey);
    expect(receipt?.amount).toBe(40_000n);
    expect(receipt?.recipient.equals(recipient.publicKey)).toBe(true);
    expect(receipt?.recipientToken.equals(recipientToken)).toBe(true);
    expect(receipt?.feePayer.equals(facilitator.publicKey)).toBe(true);
    expect(receipt?.nonce).toEqual(auth.nonce);
    expect(receipt?.resourceId).toEqual(rid);

    const tx = await connection.getTransaction(txSig, {
      commitment: "confirmed",
      maxSupportedTransactionVersion: 0,
    });
    const events = decodePaymentSettledEvents(tx?.meta?.logMessages ?? []);
    expect(events).toHaveLength(1);
    expect(events[0]?.receipt.equals(receiptKey)).toBe(true);
    expect(events[0]?.amount).toBe(40_000n);
    expect(events[0]?.slot).toBe(receipt?.slot);
    console.warn(`settle transaction used ${tx?.meta?.computeUnitsConsumed} compute units`);

    expect((await getAccount(connection, recipientToken)).amount).toBe(40_000n);
    expect((await getAccount(connection, vault)).amount).toBe(960_000n);

    // The same authorization again is refused by the chain with the specific error.
    const replay = await send(ixs, [facilitator]).then(
      () => null,
      (err: unknown) => err,
    );
    expect(parseProgramError(replay)?.name).toBe("NonceAlreadyUsed");
  }, 60_000);

  it("refuses over-cap payments on chain and reports rolling spend", async () => {
    const auth = authorization(100_001n);
    const signature = signAuthorization(auth, session.secretKey);
    const ixs = settleInstructions({
      authorization: auth,
      signature,
      feePayer: facilitator.publicKey,
    });
    const failed = await send(ixs, [facilitator]).then(
      () => null,
      (err: unknown) => err,
    );
    expect(parseProgramError(failed)?.name).toBe("PerCallCapExceeded");

    const view = new Transaction().add(rollingSpendInstruction({ agentWallet }));
    view.feePayer = facilitator.publicKey;
    view.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
    const sim = await connection.simulateTransaction(view);
    expect(sim.value.err).toBeNull();
    const data = sim.value.returnData?.data[0];
    expect(data && decodeRollingSpendReturnData(data)).toBe(40_000n);

    const wallet = await fetchAgentWallet(connection, agentWallet);
    if (!wallet) throw new Error("wallet missing");
    const now = BigInt(Math.floor(Date.now() / 1000));
    const decision = evaluatePayment(
      wallet.policy,
      {
        sessionKey: session.publicKey,
        amount: 100_001n,
        resourceId: rid,
        recipient: recipient.publicKey,
      },
      now,
    );
    expect(decision).toMatchObject({ ok: false, reason: "PerCallCapExceeded" });
  }, 60_000);
});
