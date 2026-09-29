/**
 * Captures the request and response examples shown in the API reference from a real run.
 *
 * It needs a validator with both programs, the localnet bootstrap and a running facilitator.
 * It starts a resource server with the resource SDK, creates and funds an agent wallet with the
 * shared instruction builders, pays with the agent SDK and records every exchange as JSON.
 *
 *   SOLANA_RPC_URL=... DEPLOYMENT_FILE=... KEYS_DIR=... FACILITATOR_URL=... \
 *   SESSION_KEY_FILE=... tsx apps/web/src/app/docs/_examples/capture.ts
 */
import { readFileSync, writeFileSync } from "node:fs";
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import {
  Connection,
  PublicKey,
  sendAndConfirmTransaction,
  Transaction,
  type TransactionInstruction,
} from "@solana/web3.js";
import {
  createAgent,
  PaymentRejectedError,
  PolicyRefusedError,
  readKeypairFile,
} from "@turnstile/sdk-agent";
import {
  createPaywall,
  expressPaywall,
  FacilitatorClient,
  getSettlement,
} from "@turnstile/sdk-resource";
import {
  agentWalletAddress,
  bytesToHex,
  decodeHeader,
  encodeHeader,
  HEADER_PAYMENT_REQUIRED,
  HEADER_PAYMENT_RESPONSE,
  HEADER_PAYMENT_SIGNATURE,
  type PaymentPayload,
  type PaymentRequirements,
  resourceId,
} from "@turnstile/shared";
import {
  createWalletInstruction,
  depositInstruction,
  fetchReceipt,
  updatePolicyInstruction,
} from "@turnstile/shared/programs";

const env = (name: string): string => {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} before running the capture.`);
  return value;
};

const outDir = process.env.OUT_DIR ?? dirname(fileURLToPath(import.meta.url));
const rpcUrl = env("SOLANA_RPC_URL");
const facilitatorUrl = env("FACILITATOR_URL").replace(/\/+$/, "");
const port = Number(process.env.RESOURCE_PORT ?? "3581");
const deployment = JSON.parse(readFileSync(env("DEPLOYMENT_FILE"), "utf8")) as {
  mint: string;
  demoRecipient: string;
  genesisHash: string;
};

interface Exchange {
  method: string;
  path: string;
  request?: unknown;
  status: number;
  response: unknown;
}

const facilitatorLog: Exchange[] = [];

/** A fetch that records every call the resource SDK makes to the facilitator. */
const recordingFetch: typeof fetch = async (input, init) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  const res = await fetch(input, init);
  const body: unknown = await res.clone().json();
  facilitatorLog.push({
    method: init?.method ?? "GET",
    path: url.pathname,
    ...(typeof init?.body === "string" ? { request: JSON.parse(init.body) as unknown } : {}),
    status: res.status,
    response: body,
  });
  return res;
};

function save(name: string, value: unknown): void {
  const text = JSON.stringify(
    value,
    (_key, v: unknown) => (typeof v === "bigint" ? v.toString() : v),
    2,
  );
  writeFileSync(join(outDir, name), `${text}\n`);
  console.warn(`wrote ${name}`);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

async function main(): Promise<void> {
  const connection = new Connection(rpcUrl, "confirmed");
  const owner = readKeypairFile(join(env("KEYS_DIR"), "demo-owner.json"));
  const session = readKeypairFile(env("SESSION_KEY_FILE"));
  const mint = new PublicKey(deployment.mint);
  const payTo = new PublicKey(deployment.demoRecipient);
  const publicUrl = `http://127.0.0.1:${port}`;

  // The resource server. Plain node:http with the Express middleware from the resource SDK.
  const paywall = createPaywall({
    facilitatorUrl,
    payTo: payTo.toBase58(),
    publicUrl,
    fetch: recordingFetch,
    routes: {
      "POST /v1/summarize": { price: "0.005", description: "Summarize a text" },
      "POST /v1/report": { price: "0.02", description: "Write a long report" },
    },
  });
  const middleware = expressPaywall(paywall);
  const server: Server = createServer((req, res) => {
    middleware(req, res, (err?: unknown) => {
      if (err) {
        res.statusCode = 500;
        res.end(String(err));
        return;
      }
      void readBody(req).then((raw) => {
        const text = raw ? ((JSON.parse(raw) as { text?: string }).text ?? "") : "";
        res.setHeader("content-type", "application/json");
        res.end(
          JSON.stringify({
            summary: text.split(". ")[0],
            receipt: getSettlement(req)?.receipt,
          }),
        );
      });
    });
  });
  await new Promise<void>((resolve) => server.listen(port, "127.0.0.1", resolve));
  const address = server.address() as AddressInfo;
  console.warn(`resource server on ${address.port}`);

  // A fresh agent wallet with the shared instruction builders, signed by the owner.
  let id = BigInt(Date.now());
  while (await connection.getAccountInfo(agentWalletAddress(owner.publicKey, id)[0])) id++;
  const [agentWallet] = agentWalletAddress(owner.publicKey, id);
  const ownerToken = getAssociatedTokenAddressSync(mint, owner.publicKey);
  const summarize = `${publicUrl}/v1/summarize`;
  const report = `${publicUrl}/v1/report`;
  const ixs: TransactionInstruction[] = [
    createWalletInstruction({
      owner: owner.publicKey,
      mint,
      id,
      perCallCap: 10_000n,
      dailyCap: 1_000_000n,
      sessionKey: session.publicKey,
      sessionExpiresAt: 0n,
    }),
    depositInstruction({ owner: owner.publicKey, agentWallet, ownerToken, amount: 2_000_000n }),
    updatePolicyInstruction({
      owner: owner.publicKey,
      agentWallet,
      perCallCap: 10_000n,
      dailyCap: 1_000_000n,
      allowList: [
        { resourceId: resourceId(summarize), recipient: payTo },
        { resourceId: resourceId(report), recipient: payTo },
      ],
    }),
  ];
  const setupSignature = await sendAndConfirmTransaction(
    connection,
    new Transaction().add(...ixs),
    [owner],
    { commitment: "confirmed" },
  );
  console.warn(`agent wallet ${agentWallet.toBase58()} created in ${setupSignature}`);

  // The facilitator endpoints the resource SDK does not call on its own.
  const client = new FacilitatorClient({ url: facilitatorUrl, fetch: recordingFetch });
  await client.supported();

  // 1. An unpaid request, as any HTTP client sees it.
  const unpaid = await fetch(summarize, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Turnstile settles one payment per request. It runs on Solana." }),
  });
  const unpaidHeader = unpaid.headers.get(HEADER_PAYMENT_REQUIRED) ?? "";
  save("http-402.json", {
    request: { method: "POST", url: summarize },
    status: unpaid.status,
    headers: {
      "content-type": unpaid.headers.get("content-type"),
      [HEADER_PAYMENT_REQUIRED]: unpaidHeader,
    },
    decodedHeader: decodeHeader<unknown>(unpaidHeader),
    body: await unpaid.json(),
  });

  // 2. The agent SDK pays. Its fetch is wrapped so the paid retry is recorded too.
  // Only the request is kept. Cloning the response would tee its body, and the agent cancels
  // the body of the 402, which never finishes while a tee branch stays unread.
  const agentRequests: Request[] = [];
  const agent = createAgent({
    connection,
    agentWallet,
    sessionKey: session,
    fetch: async (input, init) => {
      const request = new Request(input, init);
      agentRequests.push(request);
      return fetch(request);
    },
  });
  const started = performance.now();
  const paid = await agent.fetch(summarize, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ text: "Turnstile settles one payment per request. It runs on Solana." }),
  });
  const elapsedMs = Math.round(performance.now() - started);
  const paidRequest = agentRequests.at(-1);
  if (!paidRequest || !paid.payment) throw new Error("The paid request did not settle.");
  const signatureHeader = paidRequest.headers.get(HEADER_PAYMENT_SIGNATURE) ?? "";
  const responseHeader = paid.headers.get(HEADER_PAYMENT_RESPONSE) ?? "";
  save("http-paid.json", {
    request: {
      method: "POST",
      url: summarize,
      headers: { [HEADER_PAYMENT_SIGNATURE]: signatureHeader },
      decodedHeader: decodeHeader<unknown>(signatureHeader),
    },
    status: paid.status,
    headers: { [HEADER_PAYMENT_RESPONSE]: responseHeader },
    decodedHeader: decodeHeader<unknown>(responseHeader),
    body: await paid.json(),
    elapsedMs,
  });
  save("agent-payment.json", paid.payment);

  const receiptAccount = await fetchReceipt(connection, new PublicKey(paid.payment.receipt));
  if (!receiptAccount) throw new Error("The receipt is not on chain.");
  save("receipt.json", {
    address: paid.payment.receipt,
    agentWallet: receiptAccount.agentWallet.toBase58(),
    owner: receiptAccount.owner.toBase58(),
    sessionKey: receiptAccount.sessionKey.toBase58(),
    recipient: receiptAccount.recipient.toBase58(),
    recipientToken: receiptAccount.recipientToken.toBase58(),
    mint: receiptAccount.mint.toBase58(),
    amount: receiptAccount.amount,
    resourceId: bytesToHex(receiptAccount.resourceId),
    nonce: bytesToHex(receiptAccount.nonce),
    slot: receiptAccount.slot,
    unixTimestamp: receiptAccount.unixTimestamp,
    feePayer: receiptAccount.feePayer.toBase58(),
  });

  // 3. The same payment settled again. The facilitator answers with the first receipt.
  const payload = decodeHeader<PaymentPayload>(signatureHeader);
  const settleCall = facilitatorLog.find((e) => e.path === "/settle");
  if (!settleCall) throw new Error("The resource server never called settle.");
  const requirements = (settleCall.request as { paymentRequirements: PaymentRequirements })
    .paymentRequirements;
  await client.settle(payload, requirements);
  await client.verify(payload, requirements);

  // 4. A price above the per-call cap. With the local check on, nothing is signed.
  let localRefusal: unknown = null;
  try {
    await agent.fetch(report, { method: "POST" });
  } catch (err) {
    if (!(err instanceof PolicyRefusedError)) throw err;
    localRefusal = {
      name: err.name,
      code: err.code,
      reason: err.reason,
      message: err.message,
      resource: err.resource,
      amount: err.amount,
    };
  }
  save("agent-refused.json", localRefusal);

  // 5. The same call with the local check off. The facilitator refuses the signed payment.
  const trusting = createAgent({
    connection,
    agentWallet,
    sessionKey: session,
    localPolicyCheck: false,
  });
  const beforeRejection = facilitatorLog.length;
  let rejection: unknown = null;
  try {
    await trusting.fetch(report, { method: "POST" });
  } catch (err) {
    if (!(err instanceof PaymentRejectedError)) throw err;
    rejection = {
      name: err.name,
      code: err.code,
      reason: err.reason,
      status: err.status,
      message: err.message,
    };
    // The same signed payment sent by hand, to record the 402 the resource server answers with.
    const again = await fetch(report, {
      method: "POST",
      headers: { [HEADER_PAYMENT_SIGNATURE]: encodeHeader(err.paymentPayload) },
    });
    save("http-rejected.json", { status: again.status, body: await again.json() });
  }
  save("agent-rejected.json", rejection);

  // 6. A requirements call the facilitator refuses.
  await recordingFetch(`${facilitatorUrl}/requirements`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      resource: summarize,
      price: "0.005",
      payTo: "not-an-address",
      description: "Summarize a text",
    }),
  });
  const rejectedVerify = facilitatorLog.slice(beforeRejection).find((e) => e.path === "/verify");

  const byPath = (path: string) => facilitatorLog.filter((e) => e.path === path);
  save("facilitator-supported.json", byPath("/supported")[0]);
  save("facilitator-requirements.json", byPath("/requirements")[0]);
  save("facilitator-requirements-invalid.json", byPath("/requirements").at(-1));
  save("facilitator-verify.json", byPath("/verify")[0]);
  save("facilitator-settle.json", byPath("/settle")[0]);
  save("facilitator-settle-replay.json", byPath("/settle")[1]);
  save("facilitator-verify-used-nonce.json", byPath("/verify")[1]);
  save("facilitator-verify-rejected.json", rejectedVerify);

  save("capture.json", {
    capturedAt: new Date().toISOString(),
    rpcUrl,
    genesisHash: deployment.genesisHash,
    facilitatorUrl,
    resourceServer: publicUrl,
    agentWallet: agentWallet.toBase58(),
    sessionKey: session.publicKey.toBase58(),
    setupTransaction: setupSignature,
    paymentTransaction: paid.payment.transaction,
    receipt: paid.payment.receipt,
    paidRequestMs: elapsedMs,
  });

  server.close();
}

main().catch((err: unknown) => {
  console.error(err);
  process.exitCode = 1;
});
