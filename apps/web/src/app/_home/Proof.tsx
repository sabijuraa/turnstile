import { explorerAddressUrl, NETWORKS, SETTLEMENT_PROGRAM_ID } from "@turnstile/shared";
import { Icon } from "@/components/Icon";
import { Illustration } from "@/components/Illustration";
import { ReceiptCard } from "@/components/Receipt";
import { Section } from "@/components/Section";
import styles from "./home.module.css";
import { sampleReceipt } from "./illustration";

const settlementProgramUrl = explorerAddressUrl(NETWORKS.devnet, SETTLEMENT_PROGRAM_ID.toBase58());

export function Proof() {
  return (
    <Section id="proof" labelledBy="proof-title">
      <div className={`${styles.split} ${styles.splitReverse}`}>
        <div className={styles.splitCopy}>
          <p className={`label ${styles.eyebrow}`}>Proof</p>
          <h2 id="proof-title" className={styles.splitTitle}>
            Every paid request leaves a receipt.
          </h2>
          <p className={styles.splitLead}>
            The receipt is written on chain in the same transaction as the payment. It names the
            agent, the service, the amount and the moment it settled. Nobody can edit it later.
          </p>
          <ul className={styles.proofList}>
            <li>
              <Icon name="list" size={18} />
              Read every payment in the console as it lands.
            </li>
            <li>
              <Icon name="search" size={18} />
              Check any receipt yourself on a public explorer.
            </li>
            <li>
              <Icon name="download" size={18} />
              Export a statement for your books.
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
