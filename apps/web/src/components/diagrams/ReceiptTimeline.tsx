import styles from "./ReceiptTimeline.module.css";

const moments = [
  { name: "settle", note: "The receipt is created and the fee payer funds its rent." },
  { name: "expires_at", note: "At most 24 hours later the signed payment can no longer settle." },
  { name: "+ 7 days", note: "The receipt has stayed readable for a full week." },
  { name: "close_receipt", note: "The fee payer closes it and gets all of its rent back." },
] as const;

/** The life of a receipt account, from the settlement that creates it to the rent coming back. */
export function ReceiptTimeline() {
  return (
    <ol className={styles.line}>
      {moments.map((moment) => (
        <li key={moment.name} className={styles.moment}>
          <code className={styles.name}>{moment.name}</code>
          <p className={styles.note}>{moment.note}</p>
        </li>
      ))}
    </ol>
  );
}
