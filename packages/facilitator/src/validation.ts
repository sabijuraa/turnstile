import { PublicKey } from "@solana/web3.js";
import { SCHEME } from "@turnstile/shared";
import type { Context } from "hono";
import { z } from "zod";
import { ApiError, describeZodError } from "./errors.js";

/** A base58 Solana address, checked by decoding it. */
export const pubkeySchema = z.string({ error: "must be a base58 Solana address" }).refine((v) => {
  try {
    return new PublicKey(v).toBase58() === v;
  } catch {
    return false;
  }
}, "must be a base58 Solana address");

const hex32 = z.string().regex(/^[0-9a-f]{64}$/, "must be 64 lowercase hex characters");
const uintString = z.string().regex(/^\d{1,20}$/, "must be a decimal integer string");

export const paymentRequirementsSchema = z.object({
  scheme: z.literal(SCHEME, { error: `must be ${SCHEME}` }),
  network: z.string().min(1),
  amount: uintString,
  asset: pubkeySchema,
  payTo: pubkeySchema,
  maxTimeoutSeconds: z.number().int().positive(),
  resource: z.string().min(1).max(2048),
  description: z.string().max(1000),
  mimeType: z.string().max(200),
  extra: z.object({
    resourceId: hex32,
    nonce: hex32,
    settlementProgram: pubkeySchema,
    agentWalletProgram: pubkeySchema,
    facilitator: z.string().max(2048),
    expiresAt: uintString,
    displayAmount: z.string().max(100),
  }),
});

export const paymentBodySchema = z.object({
  x402Version: z.number().int().optional(),
  paymentPayload: z.unknown(),
  paymentRequirements: paymentRequirementsSchema,
});

export const requirementsBodySchema = z
  .object({
    resource: z
      .string({ error: "must be the absolute URL of the paid route" })
      .max(2048)
      .refine((v) => {
        try {
          const u = new URL(v);
          return u.protocol === "http:" || u.protocol === "https:";
        } catch {
          return false;
        }
      }, "must be an absolute http or https URL"),
    amount: uintString.optional(),
    price: z
      .string()
      .regex(/^\d+(\.\d+)?$/, "must be a decimal string such as 0.005")
      .optional(),
    payTo: pubkeySchema,
    description: z.string({ error: "must describe the resource" }).max(1000),
    mimeType: z.string().min(1).max(200).default("application/json"),
    maxTimeoutSeconds: z.number().int().min(1).max(3600).optional(),
    asset: pubkeySchema.optional(),
  })
  .refine((b) => (b.amount === undefined) !== (b.price === undefined), {
    message: "Send exactly one of amount (base units) and price (decimal).",
    path: ["amount"],
  });

/** Parses a JSON body against a schema and turns every problem into a 400 with a clear message. */
export async function readJson<T extends z.ZodType>(c: Context, schema: T): Promise<z.infer<T>> {
  const type = c.req.header("content-type") ?? "";
  if (!type.toLowerCase().startsWith("application/json")) {
    throw new ApiError(
      415,
      "unsupported_media_type",
      "Send the request body as JSON with Content-Type application/json.",
    );
  }
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ApiError(
      400,
      "invalid_json",
      "The request body is not valid JSON. Fix it and retry.",
    );
  }
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new ApiError(400, "invalid_request", `${describeZodError(parsed.error)}.`);
  }
  return parsed.data;
}
