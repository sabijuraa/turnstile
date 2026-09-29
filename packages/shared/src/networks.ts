export type NetworkName = "localnet" | "devnet";

export interface NetworkConfig {
  name: NetworkName;
  /** CAIP-2 id used in x402 requirements. */
  caip2: string;
  rpcUrl: string;
  wsUrl: string;
  /** Query string that points the Solana explorer at this cluster. */
  explorerCluster: string;
}

export const NETWORKS: Record<NetworkName, NetworkConfig> = {
  localnet: {
    name: "localnet",
    caip2: "solana:localnet",
    rpcUrl: "http://127.0.0.1:8899",
    wsUrl: "ws://127.0.0.1:8900",
    explorerCluster: "cluster=custom&customUrl=http%3A%2F%2F127.0.0.1%3A8899",
  },
  devnet: {
    name: "devnet",
    caip2: "solana:EtWTRABZaYq6iMfeYKouRu166VU2xqa1",
    rpcUrl: "https://api.devnet.solana.com",
    wsUrl: "wss://api.devnet.solana.com",
    explorerCluster: "cluster=devnet",
  },
};

export function networkByName(name: string): NetworkConfig {
  if (name === "localnet" || name === "devnet") return NETWORKS[name];
  throw new Error(`Unknown network "${name}". Use localnet or devnet.`);
}

export function explorerTxUrl(network: NetworkConfig, signature: string): string {
  return `https://explorer.solana.com/tx/${signature}?${network.explorerCluster}`;
}

export function explorerAddressUrl(network: NetworkConfig, address: string): string {
  return `https://explorer.solana.com/address/${address}?${network.explorerCluster}`;
}
