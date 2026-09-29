export interface SignInFields {
  domain: string;
  uri: string;
  pubkey: string;
  network: string;
  nonce: string;
  issuedAt: Date;
  expiresAt: Date;
}

/**
 * The text the owner signs. It follows the Sign In With Solana layout so wallets can show it
 * as a sign-in request and so the owner can read which site, key and time window it covers.
 */
export function buildSignInMessage(f: SignInFields): string {
  return [
    `${f.domain} wants you to sign in with your Solana account:`,
    f.pubkey,
    "",
    "Sign in to the Turnstile console. This request does not send a transaction or cost any fees.",
    "",
    `URI: ${f.uri}`,
    "Version: 1",
    `Chain ID: ${f.network}`,
    `Nonce: ${f.nonce}`,
    `Issued At: ${f.issuedAt.toISOString()}`,
    `Expiration Time: ${f.expiresAt.toISOString()}`,
  ].join("\n");
}
