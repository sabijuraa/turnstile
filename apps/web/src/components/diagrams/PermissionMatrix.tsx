import { Icon } from "@/components/Icon";
import styles from "./PermissionMatrix.module.css";

const actions = [
  "Withdraw funds",
  "Change the policy",
  "Sign a payment",
  "Submit a payment",
  "Prepare a transaction",
] as const;

const parties: readonly { name: string; holds: string; can: readonly boolean[] }[] = [
  { name: "Your wallet", holds: "owner key", can: [true, true, false, false, false] },
  { name: "The agent", holds: "session key", can: [false, false, true, false, false] },
  { name: "The facilitator", holds: "fee payer key", can: [false, false, false, true, false] },
  { name: "The console", holds: "no key", can: [false, false, false, false, true] },
];

/** Which key can do what. The programs enforce every cell, whoever is asking. */
export function PermissionMatrix() {
  return (
    // biome-ignore lint/a11y/noNoninteractiveTabindex: a table wider than a phone must scroll by keyboard
    <section className={styles.wrap} aria-label="What each key can do" tabIndex={0}>
      <table className={styles.table}>
        <thead>
          <tr>
            <th scope="col">
              <span className="visually-hidden">Party</span>
            </th>
            {actions.map((action) => (
              <th key={action} scope="col">
                {action}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {parties.map((party) => (
            <tr key={party.name}>
              <th scope="row">
                {party.name}
                <code>{party.holds}</code>
              </th>
              {party.can.map((allowed, index) => (
                <td key={actions[index]} className={allowed ? styles.yes : styles.no}>
                  {allowed ? <Icon name="check" size={16} /> : <span aria-hidden="true">·</span>}
                  <span className="visually-hidden">{allowed ? "Yes" : "No"}</span>
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}
