"use client";

import { useCallback, useRef, useState } from "react";
import { api, errorMessage, isUnauthenticated } from "./api";
import { connectOwner, useConsoleSession } from "./context";
import type { BuiltTransactions, TxConfirmation } from "./types";
import { redirectToSignIn } from "./useResource";
import { signAndSend } from "./wallet";

export type ChainActionState =
  | { phase: "idle" }
  | { phase: "building" }
  | { phase: "signing"; step: number; steps: number; description: string }
  | {
      phase: "confirming";
      step: number;
      steps: number;
      description: string;
      signature: string;
      explorerUrl: string | null;
    }
  | { phase: "confirmed"; signatures: string[]; explorerUrl: string; result: BuiltTransactions }
  | { phase: "failed"; message: string; explorerUrl: string | null };

const CONFIRM_ROUNDS = 6;

async function confirm(signature: string): Promise<TxConfirmation> {
  let last: TxConfirmation | null = null;
  for (let round = 0; round < CONFIRM_ROUNDS; round += 1) {
    last = await api<TxConfirmation>("/v1/tx/confirm", {
      method: "POST",
      body: { signature, timeoutMs: 15_000 },
    });
    if (last.status !== "pending") return last;
  }
  if (!last) throw new Error("No confirmation answer came back");
  return last;
}

/**
 * Runs one owner change on chain. The backend builds the unsigned transactions, the owner wallet
 * signs and sends each one, and the backend confirms it. The state says where it is at every step.
 */
export function useChainAction() {
  const { me } = useConsoleSession();
  const [state, setState] = useState<ChainActionState>({ phase: "idle" });
  const busy = useRef(false);

  const run = useCallback(
    async (path: string, body: unknown): Promise<BuiltTransactions | null> => {
      if (busy.current) return null;
      busy.current = true;
      let explorerUrl: string | null = null;
      try {
        setState({ phase: "building" });
        const built = await api<BuiltTransactions>(path, { method: "POST", body });
        const signer = await connectOwner(me.owner);
        const signatures: string[] = [];
        const steps = built.transactions.length;
        for (const [index, tx] of built.transactions.entries()) {
          explorerUrl = null;
          setState({ phase: "signing", step: index + 1, steps, description: tx.description });
          const signature = await signAndSend(
            signer.wallet,
            signer.account,
            tx.transaction,
            built.network,
          );
          signatures.push(signature);
          setState({
            phase: "confirming",
            step: index + 1,
            steps,
            description: tx.description,
            signature,
            explorerUrl: null,
          });
          const result = await confirm(signature);
          explorerUrl = result.explorerUrl;
          if (result.status === "failed") {
            const reason = result.error?.message ?? "Solana rejected the transaction.";
            throw new Error(
              `${reason}${reason.endsWith(".") ? "" : "."} Nothing else was changed.`,
            );
          }
          if (result.status === "pending") {
            throw new Error(
              "Solana has not confirmed the transaction yet. Open it in the explorer, then refresh this page to see the result.",
            );
          }
        }
        setState({
          phase: "confirmed",
          signatures,
          explorerUrl: explorerUrl ?? "",
          result: built,
        });
        return built;
      } catch (error) {
        if (isUnauthenticated(error)) {
          redirectToSignIn();
          return null;
        }
        setState({ phase: "failed", message: errorMessage(error), explorerUrl });
        return null;
      } finally {
        busy.current = false;
      }
    },
    [me.owner],
  );

  const reset = useCallback(() => setState({ phase: "idle" }), []);

  const pending =
    state.phase === "building" || state.phase === "signing" || state.phase === "confirming";

  return { state, run, reset, pending };
}
