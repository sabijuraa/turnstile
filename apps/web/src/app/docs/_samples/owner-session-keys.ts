import { Connection, PublicKey, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import { readKeypairFile } from "@turnstile/sdk-agent";
import { addSessionKeyInstruction, revokeSessionKeyInstruction } from "@turnstile/shared/programs";

const rpcUrl = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
const connection = new Connection(rpcUrl, "confirmed");
const owner = readKeypairFile("keys/owner.json");
const address = process.env.AGENT_WALLET;
if (!address) throw new Error("Set AGENT_WALLET to the agent wallet address from the console.");
const agentWallet = new PublicKey(address);
const oldKey = readKeypairFile("keys/session.json").publicKey;
const newKey = readKeypairFile("keys/session-2.json").publicKey;

// Rotate in one transaction. The new key expires in 30 days, the old one stops working now.
const expiresAt = BigInt(Math.floor(Date.now() / 1000) + 30 * 24 * 60 * 60);
const tx = new Transaction().add(
  addSessionKeyInstruction({ owner: owner.publicKey, agentWallet, sessionKey: newKey, expiresAt }),
  revokeSessionKeyInstruction({ owner: owner.publicKey, agentWallet, sessionKey: oldKey }),
);
await sendAndConfirmTransaction(connection, tx, [owner]);
