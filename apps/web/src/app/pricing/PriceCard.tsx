import { StatusPill } from "@/components/StatusPill";
import styles from "./pricing.module.css";

/** Illustrative numbers for the pricing model. Turnstile has no commercial offering. */
export function PriceCard() {
  return (
    <div className={styles.price}>
      <div>
        <StatusPill tone="caution" icon="info">
          Illustrative
        </StatusPill>
        <p className={`${styles.priceValue} figures`}>0.5%</p>
        <p className={styles.priceUnit}>of each settled payment</p>
      </div>
      <dl className={styles.example}>
        <div>
          <dt>1,000 calls at 0.004 USDC</dt>
          <dd className="figures">4.00 USDC</dd>
        </div>
        <div className={styles.exampleTotal}>
          <dt>Fee at 0.5%</dt>
          <dd className="figures">0.02 USDC</dd>
        </div>
      </dl>
    </div>
  );
}
