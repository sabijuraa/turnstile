import {
  createAgent,
  PaymentRejectedError,
  PolicyRefusedError,
  readKeypairFile,
} from "@turnstile/sdk-agent";

const agentWallet = process.env.AGENT_WALLET;
if (!agentWallet) throw new Error("Set AGENT_WALLET to the agent wallet address from the console.");

const agent = createAgent({
  rpcUrl: process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899",
  agentWallet,
  // The file written by turnstile-agent keygen. The key never leaves this process.
  sessionKey: readKeypairFile("keys/session.json"),
  // Optional. A local ceiling tighter than the on-chain per-call cap.
  maxPerCall: "0.01",
  onPayment: (event) => {
    if (event.type !== "settled") console.error(`${event.type} ${event.reason} ${event.message}`);
  },
});

export async function summarize(text: string): Promise<{ summary: string; receipt?: string }> {
  try {
    const res = await agent.fetch("http://127.0.0.1:4030/v1/summarize", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text }),
    });
    const { summary } = (await res.json()) as { summary: string };
    // Set when this call paid. It carries the receipt, the transaction and the amount.
    return { summary, receipt: res.payment?.receipt };
  } catch (err) {
    if (err instanceof PolicyRefusedError) {
      // Outside the policy. Nothing was signed and nothing was sent.
      throw new Error(`Refused before paying (${err.reason}). ${err.message}`, { cause: err });
    }
    if (err instanceof PaymentRejectedError) {
      // Signed and sent, then refused by the server, the facilitator or the chain.
      throw new Error(`Payment rejected with ${err.status} ${err.reason}. ${err.message}`, {
        cause: err,
      });
    }
    throw err;
  }
}
