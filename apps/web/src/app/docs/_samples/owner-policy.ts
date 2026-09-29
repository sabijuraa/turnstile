import { getAssociatedTokenAddressSync } from "@solana/spl-token";
import { Connection, PublicKey, sendAndConfirmTransaction, Transaction } from "@solana/web3.js";
import { readKeypairFile } from "@turnstile/sdk-agent";
import { agentWalletAddress, parseUnits, resourceId } from "@turnstile/shared";
import {
  createWalletInstruction,
  depositInstruction,
  updatePolicyInstruction,
} from "@turnstile/shared/programs";

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Set ${name} before running this script.`);
  return value;
}

const rpcUrl = process.env.SOLANA_RPC_URL ?? "http://127.0.0.1:8899";
const connection = new Connection(rpcUrl, "confirmed");
// The owner authority. The console uses your browser wallet instead of a key file.
const owner = readKeypairFile(required("OWNER_KEYPAIR"));
const mint = new PublicKey(required("MINT"));
const payTo = new PublicKey(required("PAY_TO"));
// The public key printed by turnstile-agent keygen.
const sessionKey = new PublicKey(required("SESSION_KEY"));

// Each owner numbers their wallets. The id is part of the wallet address.
const id = 1n;
const [agentWallet] = agentWalletAddress(owner.publicKey, id);
const perCallCap = parseUnits("0.01");
const dailyCap = parseUnits("1");

const tx = new Transaction().add(
  createWalletInstruction({
    owner: owner.publicKey,
    mint,
    id,
    perCallCap,
    dailyCap,
    sessionKey,
    sessionExpiresAt: 0n, // no expiry
  }),
  depositInstruction({
    owner: owner.publicKey,
    agentWallet,
    ownerToken: getAssociatedTokenAddressSync(mint, owner.publicKey),
    amount: parseUnits("5"),
  }),
  // An empty allow-list allows nothing. Add each resource and recipient pair the agent may pay.
  updatePolicyInstruction({
    owner: owner.publicKey,
    agentWallet,
    perCallCap,
    dailyCap,
    allowList: [{ resourceId: resourceId("http://127.0.0.1:4030/v1/summarize"), recipient: payTo }],
  }),
);

const signature = await sendAndConfirmTransaction(connection, tx, [owner]);
console.warn(`Agent wallet ${agentWallet.toBase58()} is ready. Transaction ${signature}`);
