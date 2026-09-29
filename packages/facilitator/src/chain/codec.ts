import {
  decodeAgentWallet,
  decodeReceipt,
  programErrorName,
  settleInstructions,
} from "@turnstile/shared/programs";
import type { ProgramCodec } from "./solana.js";

/** The Turnstile programs as the facilitator sees them, built on the shared program client. */
export const turnstileCodec: ProgramCodec = {
  settleInstructions: (authorization, signature, feePayer) =>
    settleInstructions({ authorization, signature, feePayer }),

  decodeWallet(address, data) {
    const w = decodeAgentWallet(data);
    return { address, owner: w.owner, mint: w.mint, vault: w.vault, policy: w.policy };
  },

  decodeReceipt(data) {
    const r = decodeReceipt(data);
    return {
      agentWallet: r.agentWallet,
      sessionKey: r.sessionKey,
      recipient: r.recipient,
      mint: r.mint,
      amount: r.amount,
      resourceId: r.resourceId,
      nonce: r.nonce,
    };
  },

  errorName: (code) => programErrorName(code) ?? undefined,
};
