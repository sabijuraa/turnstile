import { Icon, type IconName } from "@/components/Icon";
import styles from "./pricing.module.css";

interface Part {
  icon: IconName;
  name: string;
  body: string;
  builders: boolean;
  owners: boolean;
}

const parts: readonly Part[] = [
  {
    icon: "endpoint",
    name: "Resource SDK",
    body: "Middleware for Express and Hono that turns a route into a paid route.",
    builders: true,
    owners: false,
  },
  {
    icon: "agent",
    name: "Agent SDK",
    body: "Pays a 402 on its own inside the agent's policy and refuses anything outside it.",
    builders: false,
    owners: true,
  },
  {
    icon: "wallet",
    name: "Console",
    body: "Create agent wallets, set limits, manage session keys and API keys, and read spend.",
    builders: true,
    owners: true,
  },
  {
    icon: "receipt",
    name: "On-chain receipts and CSV statements",
    body: "A receipt on Solana for every payment, and a statement you can export for your books.",
    builders: true,
    owners: true,
  },
  {
    icon: "gate",
    name: "Facilitator",
    body: "Verifies and settles each payment and pays the network fee.",
    builders: true,
    owners: true,
  },
  {
    icon: "play",
    name: "Live demo",
    body: "A real agent paying a real metered API, open to anyone.",
    builders: true,
    owners: true,
  },
];

function Mark({ included }: { included: boolean }) {
  return included ? (
    <span className={styles.markYes}>
      <Icon name="check" size={18} />
      <span className="visually-hidden">Included</span>
    </span>
  ) : (
    <span className={styles.markNo}>
      <span className={styles.dash} aria-hidden="true" />
      <span className="visually-hidden">Not needed on this side</span>
    </span>
  );
}

/** What comes with Turnstile, and which side of a paid call uses each part. */
export function Included() {
  return (
    <div className={styles.tableWrap}>
      <table className={styles.table}>
        <caption className="visually-hidden">
          What is included, and whether builders or owners use it
        </caption>
        <thead>
          <tr>
            <th scope="col">Part</th>
            <th scope="col" className={styles.markCol}>
              Builders
            </th>
            <th scope="col" className={styles.markCol}>
              Owners
            </th>
          </tr>
        </thead>
        <tbody>
          {parts.map((part) => (
            <tr key={part.name}>
              <th scope="row">
                <span className={styles.part}>
                  <span className={styles.partIcon}>
                    <Icon name={part.icon} size={18} />
                  </span>
                  <span>
                    <span className={styles.partName}>{part.name}</span>
                    <span className={styles.partBody}>{part.body}</span>
                  </span>
                </span>
              </th>
              <td className={styles.markCol}>
                <Mark included={part.builders} />
              </td>
              <td className={styles.markCol}>
                <Mark included={part.owners} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
