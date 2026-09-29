import { Section } from "@/components/Section";
import styles from "./security.module.css";

const threats: readonly {
  title: string;
  happens: string;
  stops: string;
  codes: readonly string[];
}[] = [
  {
    title: "The facilitator is compromised",
    happens:
      "An attacker could submit payments your agent really signed, or hold them back. Payments may stall until it is back.",
    stops:
      "The amount, the recipient and the nonce are all inside the agent's signature, and the chain checks it. The fee payer key has no authority over any vault.",
    codes: ["SignatureMismatch", "NonceAlreadyUsed"],
  },
  {
    title: "A service lies about its price",
    happens:
      "A service can ask any price in its 402. The agent SDK compares it with your policy and refuses early.",
    stops:
      "Anything above the per-call cap is refused on chain. Below the cap the price is the service's call, so set the cap close to what you expect to pay.",
    codes: ["PerCallCapExceeded"],
  },
  {
    title: "A service swaps in its own address",
    happens:
      "A compromised server keeps an allowed route but asks to be paid at a wallet it controls.",
    stops:
      "Your allow-list pairs each route with the wallet it pays. A payment to any other address is refused.",
    codes: ["ResourceNotAllowed"],
  },
  {
    title: "A session key leaks",
    happens:
      "Whoever holds it can sign payments as your agent. They can pay the services on your allow-list up to your caps.",
    stops:
      "The caps and the allow-list still apply. Revoke the key with one signature and the next payment it signs is refused. An expiry ends it on its own.",
    codes: ["SessionKeyRevoked", "SessionKeyExpired"],
  },
  {
    title: "The website or console is compromised",
    happens:
      "An attacker could change what the page shows or prepare a transaction you did not ask for.",
    stops:
      "Neither holds a key that can move funds. Every change needs your signature in your own wallet, so read what the wallet shows before you approve.",
    codes: [],
  },
  {
    title: "Someone replays a payment",
    happens: "An old signed payment is sent again, to charge the agent a second time.",
    stops:
      "Each payment has a random nonce and an expiry. Its receipt address is built from the nonce, so a second settlement finds it taken and fails.",
    codes: ["NonceAlreadyUsed", "AuthorizationExpired"],
  },
];

export function Threats() {
  return (
    <Section
      id="threats"
      tone="surface"
      eyebrow="Threat model"
      title="What happens when something goes wrong."
      lead="Any service can fail or be attacked. Here is what an attacker gets in each case, and what keeps your money in place."
    >
      <ul className={styles.threats}>
        {threats.map((threat) => (
          <li key={threat.title} className={styles.threat}>
            <h3 className={styles.threatTitle}>{threat.title}</h3>
            <dl className={styles.threatFacts}>
              <div>
                <dt className="label">What an attacker gets</dt>
                <dd>{threat.happens}</dd>
              </div>
              <div>
                <dt className="label">What stops it</dt>
                <dd>{threat.stops}</dd>
              </div>
            </dl>
            {threat.codes.length > 0 ? (
              <p className={styles.codes}>
                <span className="visually-hidden">Program errors </span>
                {threat.codes.map((code) => (
                  <code key={code}>{code}</code>
                ))}
              </p>
            ) : null}
          </li>
        ))}
      </ul>
    </Section>
  );
}
