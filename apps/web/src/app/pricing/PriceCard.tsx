import { Illustration } from "@/components/Illustration";
import { StatusPill } from "@/components/StatusPill";
import styles from "./pricing.module.css";

/**
 * Illustrative numbers for the pricing model. Turnstile has no commercial offering, so none of this
 * is a real price. The card and its caption both say so next to the figures.
 */
const example = {
  rate: "0.5%",
  calls: "1,000",
  pricePerCall: "0.004 USDC",
  volume: "4.00 USDC",
  fee: "0.02 USDC",
} as const;

export function PriceCard() {
  return (
    <Illustration
      className={styles.priceFigure}
      note="Illustration. Sample numbers to show the model, not a real price."
    >
      <div className={styles.price}>
        <div className={styles.priceHead}>
          <p className="label">Fee on settled volume</p>
          <StatusPill tone="caution" icon="info">
            Illustrative
          </StatusPill>
        </div>
        <p className={styles.priceFigureRow}>
          <span className={`${styles.priceValue} figures`}>{example.rate}</span>
          <span className={styles.priceUnit}>of each settled payment</span>
        </p>
        <div className={styles.example}>
          <p className="label">Worked example</p>
          <dl className={styles.exampleList}>
            <div>
              <dt>Calls settled</dt>
              <dd className="figures">{example.calls}</dd>
            </div>
            <div>
              <dt>Price per call</dt>
              <dd className="figures">{example.pricePerCall}</dd>
            </div>
            <div>
              <dt>Settled volume</dt>
              <dd className="figures">{example.volume}</dd>
            </div>
            <div>
              <dt>Network fees</dt>
              <dd className={styles.exampleText}>Paid by the facilitator</dd>
            </div>
            <div className={styles.exampleTotal}>
              <dt>Fee at {example.rate}</dt>
              <dd className="figures">{example.fee}</dd>
            </div>
          </dl>
        </div>
        <p className={styles.priceNote}>
          Today no fee is taken. The full amount of every payment reaches the service.
        </p>
      </div>
    </Illustration>
  );
}
