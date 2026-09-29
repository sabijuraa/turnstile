import type { PublicKey } from "@solana/web3.js";
import type { PolicyState } from "@turnstile/shared";

/** What the agent needs to know about its wallet. `policy.vaultBalance` is always set. */
export interface WalletSnapshot {
  address: PublicKey;
  owner: PublicKey;
  mint: PublicKey;
  vault: PublicKey;
  policy: PolicyState & { vaultBalance: bigint };
}

/** Where wallet state comes from. The default reads the chain. Tests pass their own. */
export interface WalletStateSource {
  load(): Promise<WalletSnapshot>;
}
