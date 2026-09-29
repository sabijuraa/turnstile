import type { ContentfulStatusCode } from "hono/utils/http-status";
import type { z } from "zod";

/** An error with a stable code and a message that tells the caller what to do next. */
export class ApiError extends Error {
  override name = "ApiError";
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export interface ErrorBody {
  error: { code: string; message: string };
}

export function errorBody(code: string, message: string): ErrorBody {
  return { error: { code, message } };
}

/** Turns zod issues into one readable sentence per field. */
export function describeZodError(err: z.ZodError): string {
  return err.issues
    .map((i) => {
      const field = i.path.length > 0 ? i.path.join(".") : "request";
      return `${field} ${i.message.charAt(0).toLowerCase()}${i.message.slice(1)}`;
    })
    .join(". ");
}

export const unauthenticated = (): ApiError =>
  new ApiError(
    401,
    "unauthenticated",
    "Sign in to the console or send an API key as Authorization: Bearer tsk_... and try again.",
  );
