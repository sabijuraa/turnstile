import type { Metadata } from "next";
import Link from "next/link";
import { Code, DocHeader, DocSection, FieldTable, Prose } from "../_components/Doc";

export const metadata: Metadata = {
  title: "Concepts",
  description:
    "Agent wallets, session keys, policies, the facilitator, receipts, nonces and replay protection.",
};

const authorization = `PaymentAuthorization {
  agent_wallet: Pubkey,
  session_key:  Pubkey,
  recipient:    Pubkey,   // owner of the recipient token account
  mint:         Pubkey,
  amount:       u64,      // base units
  resource_id:  [u8; 32],
  nonce:        [u8; 32],
  expires_at:   i64,      // unix seconds
}

signed message = "TURNSTILE_PAYMENT_V1"      20 bytes
               + settlement program id     32 bytes
               + borsh(authorization)     208 bytes
                                          260 bytes`;

export default function Page() {
  return (
    <article>
      <DocHeader eyebrow="Concepts" title="How Turnstile keeps spending in bounds">
        The chain holds the funds, checks the policy and keeps the receipts. Everything off chain is
        there for speed.
      </DocHeader>

      <DocSection id="agent-wallet" title="Agent wallet">
        <Prose>
          <p>An account on chain that holds one agent&apos;s money and rules.</p>
          <ul>
            <li>
              It is a program address derived from the owner and a numeric id, so one owner can have
              many agents.
            </li>
            <li>
              Funds sit in a vault, a token account whose authority is the wallet itself. Nobody
              holds a private key for it.
            </li>
            <li>
              Only the owner can deposit, withdraw, change the policy, manage keys or close the
              wallet. Withdraw works at any time.
            </li>
            <li>
              A payment leaves the vault only through the settlement program, and only when the
              policy allows it.
            </li>
          </ul>
        </Prose>
      </DocSection>

      <DocSection id="session-key" title="Session key">
        <Prose>
          <p>The one key the agent holds. It signs payment authorizations and nothing else.</p>
          <ul>
            <li>It cannot withdraw, change the policy or add another key.</li>
            <li>
              A wallet holds up to four keys. Each is active or revoked and may carry an expiry.
            </li>
            <li>
              Revoking a key takes effect at the next settlement. An expired key is refused too.
            </li>
            <li>
              The console and its backend never see it. Generate it next to the agent with{" "}
              <code>turnstile-agent keygen</code>.
            </li>
          </ul>
        </Prose>
      </DocSection>

      <DocSection id="policy" title="Policy">
        <Prose>
          <p>
            Three limits the owner sets once. The settlement program checks all three on chain, so
            no off-chain service can pay past them.
          </p>
        </Prose>
        <FieldTable
          caption="Policy fields"
          nameLabel="Limit"
          rows={[
            {
              name: "per_call_cap",
              detail:
                "The most one payment can move, in base units. It may not exceed the daily cap.",
            },
            {
              name: "daily_cap",
              detail: "The most the wallet can pay in any rolling 24 hours, in base units.",
            },
            {
              name: "allow_list",
              detail:
                "The resource and recipient pairs the agent may pay. An empty list allows nothing.",
            },
          ]}
        />
        <Prose>
          <p>The daily cap is a rolling window, not a calendar day.</p>
          <ul>
            <li>
              Spend is recorded in 15 minute buckets, indexed by <code>floor(unix_time / 900)</code>
              .
            </li>
            <li>
              The wallet keeps a ring of 97 buckets. Spend counts when its bucket index is at least
              the current index minus 96.
            </li>
            <li>
              A payment therefore counts for at least 24 hours and at most 24 hours 15 minutes. The
              window errs toward the owner and never lets more than the cap through in any true 24
              hours.
            </li>
          </ul>
          <p>The allow-list binds each resource to the address that may be paid for it.</p>
          <ul>
            <li>
              An entry is a <code>resource_id</code> and a <code>recipient</code>. A payment passes
              only when the exact pair is on the list.
            </li>
            <li>
              Binding the recipient stops a compromised server from pointing an allowed resource at
              its own address.
            </li>
            <li>
              The wallet stores up to 16 entries. One <code>update_policy</code> transaction fits at
              most 15, so the builders and the console cap it at 15.
            </li>
            <li>
              <code>update_policy</code> replaces the caps and the list together, in one step.
            </li>
          </ul>
        </Prose>
      </DocSection>

      <DocSection id="resource-id" title="Resource id">
        <Prose>
          <p>How a URL becomes the 32 bytes the allow-list stores.</p>
          <ul>
            <li>
              The canonical resource is the scheme, host and path of the route, with no query, no
              fragment and no trailing slash.
            </li>
            <li>
              The resource id is <code>sha256(&quot;turnstile:resource:&quot; + resource)</code>.
            </li>
            <li>
              <code>resourceId</code> in <code>@turnstile/shared</code> and{" "}
              <code>resourceIdHex</code> in the resource SDK compute it for you.
            </li>
          </ul>
        </Prose>
      </DocSection>

      <DocSection id="facilitator" title="Facilitator">
        <Prose>
          <p>The x402 facilitator. It turns a signed authorization into a settled payment.</p>
          <ul>
            <li>It issues payment requirements with a fresh nonce for every 402.</li>
            <li>
              It verifies a payment offline and against chain state, then simulates the exact
              settlement so the program has the final word.
            </li>
            <li>
              It submits the settlement and pays the network fee and receipt rent with its own fee
              payer key. That key has no authority over any vault.
            </li>
            <li>
              Its reclaim job closes receipts past their 7 day retention and returns the rent to the
              fee payer.
            </li>
            <li>
              Its only state is Postgres, so any number of instances can serve the same traffic.
            </li>
            <li>
              A settlement whose outcome is unknown goes to a dead letter table and can be replayed.
              A policy refusal is final and goes back to the caller.
            </li>
          </ul>
        </Prose>
      </DocSection>

      <DocSection id="receipt" title="Receipt">
        <Prose>
          <p>Every settlement writes one receipt account. It is the record of the payment.</p>
          <ul>
            <li>
              It holds the agent wallet, owner, session key, recipient, recipient token account,
              mint, amount, resource id, nonce, slot, timestamp, fee payer and the expiry of the
              authorization it settled.
            </li>
            <li>
              Its address derives from the agent wallet and the nonce, so anyone can find it from
              the authorization.
            </li>
            <li>
              The settlement also emits a <code>PaymentSettled</code> event. The indexer copies both
              into Postgres for the console, the API and CSV statements.
            </li>
            <li>
              The fee payer that paid the receipt rent may close it with <code>close_receipt</code>{" "}
              once 7 days have passed since the authorization expired. The rent goes back to that
              fee payer. Before then the program refuses with <code>RetentionNotElapsed</code>, and
              any other signer gets <code>NotFeePayer</code>.
            </li>
            <li>
              The facilitator runs this as a reclaim job. The indexed copy in Postgres stays, so the
              console, the API and statements keep every payment.
            </li>
          </ul>
        </Prose>
      </DocSection>

      <DocSection id="nonce" title="Nonce and replay protection">
        <Prose>
          <p>Each payment authorization can settle once.</p>
          <ul>
            <li>
              The facilitator issues a random 32 byte nonce with every 402. The agent signs it as
              part of the authorization.
            </li>
            <li>
              The receipt address is derived from the wallet and that nonce. The program cannot
              create it twice, so a second settlement fails with <code>NonceAlreadyUsed</code>.
            </li>
            <li>
              A retry of the same payment to the facilitator returns the original receipt with{" "}
              <code>alreadySettled: true</code>. The agent is never charged twice.
            </li>
            <li>
              The authorization carries an expiry. The program refuses it after that second with{" "}
              <code>AuthorizationExpired</code>.
            </li>
            <li>
              A closed receipt does not reopen its nonce. Settlement refuses an expired
              authorization before it looks at the receipt, and a receipt can only close 7 days
              after that expiry.
            </li>
            <li>
              The signed message starts with a domain tag and the settlement program id, so a
              signature cannot be reused by another program or deployment.
            </li>
          </ul>
        </Prose>
        <Code code={authorization} language="Rust" name="Payment authorization" />
        <Prose>
          <p>
            The session key signs these 260 bytes. The settle transaction carries an Ed25519
            instruction that verifies the signature, and the settlement program checks it through
            the instructions sysvar. See the{" "}
            <Link href="/docs/reference#facilitator">facilitator reference</Link> for the wire
            format.
          </p>
        </Prose>
      </DocSection>
    </article>
  );
}
