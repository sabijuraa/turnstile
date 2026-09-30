import {
  explorerAddressUrl,
  explorerTxUrl,
  NETWORKS,
  type NetworkConfig,
  networkByName,
} from "@turnstile/shared";
import { EXPLORER_SLOT as SLOT } from "./explorer";

/** The network the demo runs on, reduced to what the browser needs. Built on the server. */
export interface DemoNetwork {
  name: NetworkConfig["name"];
  /** How the page names the network in a sentence, for example "Solana devnet". */
  label: string;
  /** Explorer links with a {value} slot, built by the shared helpers so the cluster query is right. */
  explorerTx: string;
  explorerAddress: string;
}

const labels: Record<NetworkConfig["name"], string> = {
  localnet: "a local Solana validator",
  devnet: "Solana devnet",
};

function fromEnv(): NetworkConfig {
  const name = process.env.TURNSTILE_NETWORK?.trim();
  if (!name) return NETWORKS.localnet;
  try {
    return networkByName(name);
  } catch (err) {
    console.error(`TURNSTILE_NETWORK is "${name}". Falling back to localnet.`, err);
    return NETWORKS.localnet;
  }
}

/**
 * Picks the network from what the runner reports, since that is where the payments really
 * settle. Falls back to TURNSTILE_NETWORK when the runner has not answered.
 */
export function demoNetwork(reported?: string): DemoNetwork {
  let network: NetworkConfig;
  if (reported === NETWORKS.devnet.caip2 || reported === "devnet") network = NETWORKS.devnet;
  else if (reported === NETWORKS.localnet.caip2 || reported === "localnet")
    network = NETWORKS.localnet;
  else network = fromEnv();
  return {
    name: network.name,
    label: labels[network.name],
    explorerTx: explorerTxUrl(network, SLOT),
    explorerAddress: explorerAddressUrl(network, SLOT),
  };
}
