import { explorerAddressUrl, NETWORKS, SETTLEMENT_PROGRAM_ID } from "@turnstile/shared";
import { Icon } from "@/components/Icon";
import { Illustration } from "@/components/Illustration";
import { ReceiptCard } from "@/components/Receipt";
import { Section } from "@/components/Section";
import { sampleReceipt } from "./illustration";
import styles from "./product.module.css";

const settlementProgramUrl = explorerAddressUrl(NETWORKS.devnet, SETTLEMENT_PROGRAM_ID.toBase58());

const contents: readonly { group: string; items: string }[] = [
  { group: "Who paid", items: "The agent wallet, its owner and the session key that signed." },
  { group: "Who was paid", items: "The recipient, the token mint and the exact amount." },
  { group: "What for", items: "The resource id of the route that was called." },
  { group: "When", items: "The nonce, the slot and the time it settled." },
  { group: "Network fee", items: "The fee payer. The facilitator pays it, not your agent." },
];

export function Records() {
  return (
    <Section id="records" labelledBy="records-title" tone="surface">
      <div className={`${styles.split} ${styles.splitReverse}`}>
        <div className={styles.splitCopy}>
          <p className={`label ${styles.eyebrow}`}>Receipts and records</p>
          <h2 id="records-title" className={styles.splitTitle}>
            A receipt for every paid request.
          </h2>
          <p className={styles.splitLead}>
            The receipt is its own account on Solana, written in the same transaction as the
            payment. Either both happen or neither does. Nobody can edit it or remove it later.
          </p>
          <dl className={styles.contents}>
            {contents.map((entry) => (
              <div key={entry.group} className={styles.contentsRow}>
                <dt>{entry.group}</dt>
                <dd>{entry.items}</dd>
              </div>
            ))}
          </dl>
          <ul className={styles.checkList}>
            <li>
              <Icon name="list" size={18} />
              Read every payment in the console as it settles, filtered by agent, service or date.
            </li>
            <li>
              <Icon name="download" size={18} />
              Export a statement as CSV for your books.
            </li>
            <li>
              <Icon name="search" size={18} />
              Check any receipt yourself on a public explorer.
            </li>
          </ul>
          <a
            className={styles.textLink}
            href={settlementProgramUrl}
            target="_blank"
            rel="noreferrer"
          >
            See the settlement program on Solana Explorer
            <Icon name="arrowUpRight" size={16} />
            <span className="visually-hidden">(opens in a new tab)</span>
          </a>
        </div>
        <Illustration className={styles.splitVisual}>
          <ReceiptCard
            amount={sampleReceipt.amount}
            asset={sampleReceipt.asset}
            status="settled"
            settledAt={sampleReceipt.settledAt}
            fields={sampleReceipt.fields}
          />
        </Illustration>
      </div>
    </Section>
  );
}
