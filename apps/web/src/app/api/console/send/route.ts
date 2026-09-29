/**
 * Passes an owner-signed transaction to the network RPC. Wallets that cannot send on this network
 * sign only, and the console hands the signed bytes here. It carries no keys and cannot sign.
 */

import type { NextRequest } from "next/server";
import { rpcUrl } from "@/lib/console/server";

export const dynamic = "force-dynamic";

const MAX_TX_BYTES = 1232;

function fail(status: number, message: string) {
  return Response.json({ error: { code: "send_failed", message } }, { status });
}

interface RpcAnswer {
  result?: unknown;
  error?: { message?: unknown; data?: { err?: unknown; logs?: unknown } };
}

export async function POST(request: NextRequest) {
  const origin = request.headers.get("origin");
  if (origin && origin !== request.nextUrl.origin) {
    return fail(403, "Transactions can only be sent from the console itself.");
  }
  let transaction: unknown;
  try {
    ({ transaction } = (await request.json()) as { transaction?: unknown });
  } catch {
    return fail(400, "Send JSON with the signed transaction in base64.");
  }
  if (typeof transaction !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(transaction)) {
    return fail(400, "The signed transaction must be a base64 string.");
  }
  if (Buffer.from(transaction, "base64").length > MAX_TX_BYTES) {
    return fail(400, "The signed transaction is larger than Solana accepts.");
  }
  let answer: RpcAnswer;
  try {
    const response = await fetch(rpcUrl(), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "sendTransaction",
        params: [transaction, { encoding: "base64", preflightCommitment: "confirmed" }],
      }),
      cache: "no-store",
    });
    answer = (await response.json()) as RpcAnswer;
  } catch (error) {
    console.error("Solana RPC unreachable", error);
    return fail(502, "Solana is not answering. Check the network and try again.");
  }
  if (typeof answer.result === "string") return Response.json({ signature: answer.result });
  const data = answer.error?.data;
  const logs = Array.isArray(data?.logs)
    ? data.logs.filter((line): line is string => typeof line === "string")
    : [];
  // Anchor logs the program error by name and message, for example
  // "AnchorError ... Error Code: DailyCapExceeded. Error Number: 6004. Error Message: ...".
  const anchor = logs
    .map((line) => /Error Code: (\w+)\. Error Number: \d+\. Error Message: (.+?)\.?$/.exec(line))
    .find((m) => m !== null);
  if (anchor) {
    return fail(
      400,
      `The program refused the change with ${anchor[1]}. ${anchor[2]}. Nothing was changed.`,
    );
  }
  const reason =
    typeof answer.error?.message === "string" ? answer.error.message : "no reason given";
  return fail(400, `Solana refused the transaction with ${reason}. Nothing was changed.`);
}
