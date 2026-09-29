import { AccountLayout } from "@solana/spl-token";
import type { Connection, PublicKey } from "@solana/web3.js";
import { decodeAgentWallet } from "@turnstile/shared/programs";
import { WalletStateError } from "./errors.js";
import type { WalletSnapshot, WalletStateSource } from "./state.js";

/** Reads the agent wallet and its vault in one RPC round trip. */
export function chainWalletStateSource(
  connection: Connection,
  agentWallet: PublicKey,
  agentWalletProgram: PublicKey,
): WalletStateSource {
  let vault: PublicKey | null = null;
  return {
    async load(): Promise<WalletSnapshot> {
      const keys = vault ? [agentWallet, vault] : [agentWallet];
      let infos: Awaited<ReturnType<Connection["getMultipleAccountsInfo"]>>;
      try {
        infos = await connection.getMultipleAccountsInfo(keys, "confirmed");
      } catch (err) {
        throw new WalletStateError(
          `Could not read agent wallet ${agentWallet.toBase58()} from ${connection.rpcEndpoint}. Check the RPC URL and try again.`,
          { cause: err },
        );
      }
      const walletInfo = infos[0];
      if (!walletInfo) {
        throw new WalletStateError(
          `Agent wallet ${agentWallet.toBase58()} does not exist on ${connection.rpcEndpoint}. Check the address and the network.`,
        );
      }
      if (!walletInfo.owner.equals(agentWalletProgram)) {
        throw new WalletStateError(
          `${agentWallet.toBase58()} is not owned by the agent wallet program ${agentWalletProgram.toBase58()}.`,
        );
      }
      let decoded: ReturnType<typeof decodeAgentWallet>;
      try {
        decoded = decodeAgentWallet(walletInfo.data);
      } catch (err) {
        throw new WalletStateError(
          `${agentWallet.toBase58()} is not an agent wallet account. Check the address.`,
          { cause: err },
        );
      }
      // The vault address never changes, so after the first read both accounts come back in
      // one call. The first read needs a second call to learn it.
      let vaultInfo = vault?.equals(decoded.vault) ? infos[1] : undefined;
      if (vaultInfo === undefined) {
        const address = decoded.vault;
        vault = address;
        try {
          vaultInfo = await connection.getAccountInfo(address, "confirmed");
        } catch (err) {
          throw new WalletStateError(
            `Could not read the vault ${address.toBase58()} of agent wallet ${agentWallet.toBase58()}.`,
            { cause: err },
          );
        }
      }
      if (!vaultInfo || vaultInfo.data.length < AccountLayout.span) {
        throw new WalletStateError(
          `The vault ${decoded.vault.toBase58()} of agent wallet ${agentWallet.toBase58()} is missing.`,
        );
      }
      const vaultBalance = AccountLayout.decode(vaultInfo.data).amount;
      return {
        address: agentWallet,
        owner: decoded.owner,
        mint: decoded.mint,
        vault: decoded.vault,
        policy: {
          ...decoded.policy,
          vaultBalance,
        },
      };
    },
  };
}
