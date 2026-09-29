/** Browser client for the console backend, reached same origin through /api/backend. */

export const BACKEND_BASE = "/api/backend";

export class ConsoleApiError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = "ConsoleApiError";
    this.status = status;
    this.code = code;
  }
}

interface ErrorBody {
  error?: { code?: unknown; message?: unknown };
}

function isErrorBody(value: unknown): value is ErrorBody {
  return typeof value === "object" && value !== null && "error" in value;
}

/** Turns a thrown value into words a person can act on. */
export function errorMessage(error: unknown): string {
  if (error instanceof ConsoleApiError) return error.message;
  if (error instanceof Error && error.message) return error.message;
  return "Something failed without a reason. Refresh the page and try again.";
}

export function isUnauthenticated(error: unknown): boolean {
  return error instanceof ConsoleApiError && error.status === 401;
}

async function readError(response: Response): Promise<ConsoleApiError> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (isErrorBody(body) && typeof body.error?.message === "string") {
    const code = typeof body.error.code === "string" ? body.error.code : "error";
    return new ConsoleApiError(response.status, code, body.error.message);
  }
  if (response.status === 502 || response.status === 503 || response.status === 504) {
    return new ConsoleApiError(
      response.status,
      "backend_unavailable",
      "The console backend is not answering. Check that it is running, then try again.",
    );
  }
  return new ConsoleApiError(
    response.status,
    "unexpected_response",
    `The console backend answered ${response.status} without a reason. Try again in a moment.`,
  );
}

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  body?: unknown;
  signal?: AbortSignal;
}

/** Calls the backend and returns its JSON. Failures throw ConsoleApiError with the backend message. */
export async function api<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${BACKEND_BASE}${path}`, {
      method: options.method ?? "GET",
      credentials: "same-origin",
      cache: "no-store",
      headers: options.body === undefined ? undefined : { "content-type": "application/json" },
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
    });
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") throw error;
    throw new ConsoleApiError(
      0,
      "network_error",
      "The console could not reach the network. Check your connection and try again.",
    );
  }
  if (!response.ok) throw await readError(response);
  return (await response.json()) as T;
}

/** Builds a query string from defined, non empty values. */
export function query(params: Record<string, string | number | undefined | null>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === "") continue;
    search.set(key, String(value));
  }
  const text = search.toString();
  return text ? `?${text}` : "";
}
