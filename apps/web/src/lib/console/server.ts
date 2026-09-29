/** Server-only settings for the console route handlers. Nothing here reaches the browser bundle. */

import { readFileSync } from "node:fs";
import {
  AGENT_WALLET_PROGRAM_ID,
  NETWORKS,
  networkByName,
  SETTLEMENT_PROGRAM_ID,
  STABLECOIN_DECIMALS,
} from "@turnstile/shared";
import type { DeploymentInfo } from "./types";

export function backendUrl(): string {
  return (process.env.TURNSTILE_BACKEND_URL ?? "http://127.0.0.1:4022").replace(/\/+$/, "");
}

function networkName(): string {
  return process.env.TURNSTILE_NETWORK ?? "localnet";
}

export function rpcUrl(): string {
  return process.env.SOLANA_RPC_URL ?? networkByName(networkName()).rpcUrl;
}

interface DeploymentFile {
  network?: unknown;
  programs?: { agentWallet?: unknown; settlement?: unknown };
  mint?: unknown;
  mintSymbol?: unknown;
  mintDecimals?: unknown;
  facilitator?: unknown;
}

function text(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

/** Public facts from DEPLOYMENT_FILE, with the program ids from the shared package as fallback. */
export function deploymentInfo(): DeploymentInfo {
  const path = process.env.DEPLOYMENT_FILE;
  let file: DeploymentFile = {};
  if (path) {
    try {
      file = JSON.parse(readFileSync(path, "utf8")) as DeploymentFile;
    } catch (error) {
      console.error(`DEPLOYMENT_FILE ${path} could not be read`, error);
    }
  }
  const network = text(file.network) ?? networkName();
  return {
    network: network in NETWORKS ? network : networkName(),
    programs: {
      agentWallet: text(file.programs?.agentWallet) ?? AGENT_WALLET_PROGRAM_ID.toBase58(),
      settlement: text(file.programs?.settlement) ?? SETTLEMENT_PROGRAM_ID.toBase58(),
    },
    mint: text(file.mint),
    mintSymbol: text(file.mintSymbol) ?? "tUSDC",
    mintDecimals: typeof file.mintDecimals === "number" ? file.mintDecimals : STABLECOIN_DECIMALS,
    facilitator: text(file.facilitator),
    facilitatorUrl: text(process.env.FACILITATOR_URL),
  };
}
