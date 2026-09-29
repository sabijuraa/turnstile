import { createServer, type IncomingHttpHeaders, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { Keypair, type PublicKey } from "@solana/web3.js";
import {
  AGENT_WALLET_PROGRAM_ID,
  authorizationFromWire,
  bytesToHex,
  canonicalResource,
  decodeHeader,
  encodeHeader,
  type PaymentAuthorization,
  type PaymentPayload,
  type PaymentRequired,
  type PaymentRequirements,
  randomNonce,
  resourceId,
  SETTLEMENT_PROGRAM_ID,
  type SettlementResponse,
  verifyAuthorizationSignature,
} from "@turnstile/shared";
import bs58 from "bs58";

export interface RecordedRequest {
  method: string;
  path: string;
  headers: IncomingHttpHeaders;
  body: string;
}

export interface FakeServerOptions {
  mint: PublicKey;
  payTo: PublicKey;
  /** Base units. */
  price: bigint;
  /** "ok" settles, "reject" answers a paid request with a second 402. */
  mode?: "ok" | "reject";
  rejectReason?: string;
  /** Put the requirements only in the body, not in the header. */
  bodyOnly?: boolean;
  /** Changes the requirements before they are sent, to test hostile servers. */
  tamper?: (r: PaymentRequirements) => PaymentRequirements;
}

export interface FakeServer {
  url: string;
  requests: RecordedRequest[];
  /** Authorizations that arrived with a valid signature. */
  verified: {
    authorization: PaymentAuthorization;
    signature: Uint8Array;
    payload: PaymentPayload;
  }[];
  options: FakeServerOptions;
  close(): Promise<void>;
}

/** A resource server that speaks the x402 turnstile-policy wire format and settles nothing. */
export async function startFakeServer(options: FakeServerOptions): Promise<FakeServer> {
  const requests: RecordedRequest[] = [];
  const verified: FakeServer["verified"] = [];
  let base = "";
  const server: Server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const body = Buffer.concat(chunks).toString("utf8");
      const path = req.url ?? "/";
      requests.push({ method: req.method ?? "GET", path, headers: req.headers, body });
      if (path === "/free") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ free: true }));
        return;
      }
      const resource = canonicalResource(`${base}${path}`);
      const signatureHeader = req.headers["payment-signature"];
      if (typeof signatureHeader !== "string") {
        let requirement: PaymentRequirements = {
          scheme: "turnstile-policy",
          network: "solana:localnet",
          amount: options.price.toString(),
          asset: options.mint.toBase58(),
          payTo: options.payTo.toBase58(),
          maxTimeoutSeconds: 60,
          resource,
          description: "test resource",
          mimeType: "application/json",
          extra: {
            resourceId: bytesToHex(resourceId(resource)),
            nonce: bytesToHex(randomNonce()),
            settlementProgram: SETTLEMENT_PROGRAM_ID.toBase58(),
            agentWalletProgram: AGENT_WALLET_PROGRAM_ID.toBase58(),
            facilitator: "http://127.0.0.1:1",
            expiresAt: String(Math.floor(Date.now() / 1000) + 60),
            displayAmount: "test",
          },
        };
        if (options.tamper) requirement = options.tamper(requirement);
        const required: PaymentRequired = {
          x402Version: 2,
          error: "payment_required",
          resource,
          accepts: [requirement],
        };
        const headers: Record<string, string> = { "content-type": "application/json" };
        if (!options.bodyOnly) headers["payment-required"] = encodeHeader(required);
        res.writeHead(402, headers);
        res.end(JSON.stringify(required));
        return;
      }
      const payload = decodeHeader<PaymentPayload>(signatureHeader);
      const authorization = authorizationFromWire(payload.payload.authorization);
      const signature = bs58.decode(payload.payload.signature);
      if (!verifyAuthorizationSignature(authorization, signature)) {
        res.writeHead(400, { "content-type": "application/json" });
        res.end(JSON.stringify({ error: "bad signature" }));
        return;
      }
      verified.push({ authorization, signature, payload });
      if (options.mode === "reject") {
        // Same shape as the @turnstile/sdk-resource paywall: fresh requirements plus why.
        const reason = options.rejectReason ?? "DailyCapExceeded";
        const message = `The facilitator refused the payment with ${reason}.`;
        const rejected = {
          x402Version: 2,
          error: message,
          resource,
          accepts: [payload.accepted],
          reason,
          message,
        };
        res.writeHead(402, {
          "content-type": "application/json",
          "payment-required": encodeHeader(rejected),
        });
        res.end(JSON.stringify(rejected));
        return;
      }
      const settlement: SettlementResponse = {
        success: true,
        transaction: bs58.encode(Keypair.generate().secretKey),
        network: "solana:localnet",
        payer: authorization.agentWallet.toBase58(),
        receipt: Keypair.generate().publicKey.toBase58(),
      };
      res.writeHead(200, {
        "content-type": "application/json",
        "payment-response": encodeHeader(settlement),
      });
      res.end(JSON.stringify({ echo: body, contentType: req.headers["content-type"] ?? null }));
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as AddressInfo).port;
  base = `http://127.0.0.1:${port}`;
  return {
    url: base,
    requests,
    verified,
    options,
    close: () =>
      new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}
