import { PublicKey } from "@solana/web3.js";
import type { Context } from "hono";
import { z } from "zod";
import { ApiError, describeZodError } from "./errors.js";

/** A base58 Solana address, checked by decoding it. */
export const pubkeySchema = z
  .string({ error: "must be a base58 Solana address" })
  .trim()
  .refine((v) => {
    try {
      return new PublicKey(v).toBase58() === v;
    } catch {
      return false;
    }
  }, "must be a base58 Solana address");

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

/** Parses query parameters against a schema. */
export function readQuery<T extends z.ZodType>(c: Context, schema: T): z.infer<T> {
  const parsed = schema.safeParse(c.req.query());
  if (!parsed.success) {
    throw new ApiError(400, "invalid_query", `${describeZodError(parsed.error)}.`);
  }
  return parsed.data;
}

/** Validates a path parameter as a Solana address. */
export function readAddressParam(c: Context, name: string): string {
  const value = c.req.param(name) ?? "";
  const parsed = pubkeySchema.safeParse(value);
  if (!parsed.success) {
    throw new ApiError(
      400,
      "invalid_address",
      `${value || "The address"} is not a valid Solana address. Copy the agent wallet address again.`,
    );
  }
  return parsed.data;
}
