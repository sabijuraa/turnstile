import { Keypair, PublicKey } from "@solana/web3.js";
import {
  AGENT_WALLET_PROGRAM_ID,
  authorizationToWire,
  bytesToHex,
  encodeHeader,
  hexToBytes,
  type PaymentAuthorization,
  type PaymentPayload,
  type PaymentRequirements,
  resourceId,
  SCHEME,
  SETTLEMENT_PROGRAM_ID,
  type SettlementResponse,
  signAuthorization,
  type VerifyResponse,
  X402_VERSION,
} from "@turnstile/shared";
import bs58 from "bs58";

export const MINT = new PublicKey("So11111111111111111111111111111111111111112");
export const FACILITATOR_URL = "http://facilitator.test";

interface RequirementsBody {
  resource: string;
  price: string;
  payTo: string;
  description: string;
  mimeType: string;
  maxTimeoutSeconds?: number;
}

/**
 * A scripted stand-in for the facilitator HTTP API. It records every call and answers
 * verify and settle with whatever the test sets.
 */
export class FakeFacilitator {
  calls: { path: string; body: unknown }[] = [];
  verdict: VerifyResponse = { isValid: true };
  settlement: SettlementResponse | null = null;
  down = false;
  private nonce = 0;

  readonly fetch: typeof fetch = async (input, init) => {
    if (this.down) throw new TypeError("fetch failed: connect ECONNREFUSED 127.0.0.1:4020");
    const url = new URL(typeof input === "string" ? input : input.toString());
    const body = init?.body ? (JSON.parse(String(init.body)) as unknown) : undefined;
    this.calls.push({ path: url.pathname, body });
    const reply = (status: number, value: unknown) =>
      new Response(JSON.stringify(value), {
        status,
        headers: { "content-type": "application/json" },
      });
    switch (url.pathname) {
      case "/requirements":
        return reply(200, this.requirements(body as RequirementsBody));
      case "/verify":
        return reply(200, this.verdict);
      case "/settle":
        return reply(
          200,
          this.settlement ?? {
            success: true,
            transaction: "5sig",
            network: "solana:localnet",
            payer: "wallet",
            receipt: "receipt",
          },
        );
      default:
        return reply(404, { error: { code: "not_found", message: "no" } });
    }
  };

  requirements(b: RequirementsBody): PaymentRequirements {
    const [whole = "0", frac = ""] = b.price.split(".");
    const amount = BigInt(whole) * 1_000_000n + BigInt(frac.padEnd(6, "0") || "0");
    this.nonce++;
    return {
      scheme: SCHEME,
      network: "solana:localnet",
      amount: amount.toString(),
      asset: MINT.toBase58(),
      payTo: b.payTo,
      maxTimeoutSeconds: b.maxTimeoutSeconds ?? 60,
      resource: b.resource,
      description: b.description,
      mimeType: b.mimeType,
      extra: {
        resourceId: bytesToHex(resourceId(b.resource)),
        nonce: this.nonce.toString(16).padStart(64, "0"),
        settlementProgram: SETTLEMENT_PROGRAM_ID.toBase58(),
        agentWalletProgram: AGENT_WALLET_PROGRAM_ID.toBase58(),
        facilitator: FACILITATOR_URL,
        expiresAt: "1900000000",
        displayAmount: `${b.price} tUSDC`,
      },
    };
  }

  paths(): string[] {
    return this.calls.map((c) => c.path);
  }
}

/** Signs requirements the way the agent SDK does and returns the PAYMENT-SIGNATURE value. */
export function payHeader(
  req: PaymentRequirements,
  overrides: Partial<PaymentPayload> = {},
): string {
  const session = Keypair.generate();
  const auth: PaymentAuthorization = {
    agentWallet: Keypair.generate().publicKey,
    sessionKey: session.publicKey,
    recipient: new PublicKey(req.payTo),
    mint: new PublicKey(req.asset),
    amount: BigInt(req.amount),
    resourceId: hexToBytes(req.extra.resourceId),
    nonce: hexToBytes(req.extra.nonce),
    expiresAt: BigInt(req.extra.expiresAt),
  };
  const payload: PaymentPayload = {
    x402Version: X402_VERSION,
    resource: req.resource,
    accepted: req,
    payload: {
      authorization: authorizationToWire(auth),
      signature: bs58.encode(signAuthorization(auth, session.secretKey)),
    },
    ...overrides,
  };
  return encodeHeader(payload);
}
