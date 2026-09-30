// Test-only owner wallet for the console browser tests. It registers a Wallet Standard wallet in
// the page and signs in Node with a local keypair file under keys/. None of this ships in the app.
import { createPrivateKey, sign } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../../../", import.meta.url));
const sharedRequire = createRequire(`${root}packages/shared/package.json`);
export const web3 = sharedRequire("@solana/web3.js");
export const splToken = sharedRequire("@solana/spl-token");
export const repoRoot = root;

export function readKeypair(path) {
  return web3.Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(path, "utf8"))));
}

function ed25519Sign(keypair, message) {
  const seed = Buffer.from(keypair.secretKey.slice(0, 32));
  const der = Buffer.concat([Buffer.from("302e020100300506032b657004220420", "hex"), seed]);
  const key = createPrivateKey({ key: der, format: "der", type: "pkcs8" });
  return sign(null, Buffer.from(message), key);
}

/**
 * Installs the wallet into every page of a browser context. `options.reject` makes the next
 * message signature fail as if the person declined it.
 */
export async function installWallet(context, keypair, options = {}) {
  const state = { rejectNextMessage: options.rejectNextMessage ?? false, signed: [] };
  await context.exposeBinding("__turnstileTestWallet", async (_source, kind, payload) => {
    if (kind === "signMessage") {
      if (state.rejectNextMessage) {
        state.rejectNextMessage = false;
        return { error: "User rejected the request." };
      }
      const bytes = Buffer.from(payload, "base64");
      state.signed.push({ kind, text: bytes.toString("utf8") });
      return { signature: ed25519Sign(keypair, bytes).toString("base64") };
    }
    if (kind === "signTransaction") {
      const tx = web3.Transaction.from(Buffer.from(payload, "base64"));
      tx.partialSign(keypair);
      state.signed.push({ kind, instructions: tx.instructions.length });
      return {
        signed: tx
          .serialize({ requireAllSignatures: true, verifySignatures: true })
          .toString("base64"),
      };
    }
    return { error: `Unknown wallet call ${kind}` };
  });
  await context.addInitScript(
    ({ address, publicKey }) => {
      const b64 = (bytes) => btoa(String.fromCharCode(...bytes));
      const unb64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
      const chains = ["solana:localnet"];
      const account = {
        address,
        publicKey: Uint8Array.from(publicKey),
        chains,
        features: ["solana:signMessage", "solana:signTransaction"],
      };
      let connected = [];
      const listeners = new Set();
      const call = async (kind, payload) => {
        const out = await window.__turnstileTestWallet(kind, payload);
        if (out.error) {
          const error = new Error(out.error);
          error.code = 4001;
          throw error;
        }
        return out;
      };
      const wallet = {
        version: "1.0.0",
        name: "Turnstile Test Wallet",
        icon: "data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAyNCAyNCI+PHJlY3Qgd2lkdGg9IjI0IiBoZWlnaHQ9IjI0IiByeD0iNSIgZmlsbD0iIzEzMWExYSIvPjwvc3ZnPg==",
        chains,
        get accounts() {
          return connected;
        },
        features: {
          "standard:connect": {
            version: "1.0.0",
            connect: async () => {
              connected = [account];
              for (const l of listeners) l({ accounts: connected });
              return { accounts: connected };
            },
          },
          "standard:disconnect": {
            version: "1.0.0",
            disconnect: async () => {
              connected = [];
            },
          },
          "standard:events": {
            version: "1.0.0",
            on: (_event, listener) => {
              listeners.add(listener);
              return () => listeners.delete(listener);
            },
          },
          "solana:signMessage": {
            version: "1.0.0",
            signMessage: async (...inputs) =>
              Promise.all(
                inputs.map(async (input) => {
                  const out = await call("signMessage", b64(input.message));
                  return { signedMessage: input.message, signature: unb64(out.signature) };
                }),
              ),
          },
          "solana:signTransaction": {
            version: "1.0.0",
            supportedTransactionVersions: ["legacy", 0],
            signTransaction: async (...inputs) =>
              Promise.all(
                inputs.map(async (input) => {
                  const out = await call("signTransaction", b64(input.transaction));
                  return { signedTransaction: unb64(out.signed) };
                }),
              ),
          },
        },
      };
      const register = ({ register }) => register(wallet);
      window.addEventListener("wallet-standard:app-ready", ({ detail }) => register(detail));
      window.dispatchEvent(
        new CustomEvent("wallet-standard:register-wallet", { detail: register }),
      );
    },
    { address: keypair.publicKey.toBase58(), publicKey: Array.from(keypair.publicKey.toBytes()) },
  );
  return state;
}
