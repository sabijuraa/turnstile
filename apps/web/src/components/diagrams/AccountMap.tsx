import styles from "./AccountMap.module.css";

const W = 208;
const H = 84;
const COL = [8, 346, 684] as const;
const ROW = [8, 160, 312] as const;

const nodes = [
  { id: "owner", x: COL[0], y: ROW[0], name: "Owner wallet", detail: "holds the owner key" },
  { id: "session", x: COL[0], y: ROW[1], name: "Session key", detail: "held by the agent" },
  {
    id: "facilitator",
    x: COL[0],
    y: ROW[2],
    name: "Facilitator",
    detail: "pays fees, no authority",
  },
  {
    id: "wallet",
    x: COL[1],
    y: ROW[0],
    name: "AgentWallet PDA",
    detail: "policy, keys, 97 buckets",
    pda: true,
  },
  {
    id: "settlement",
    x: COL[1],
    y: ROW[1] + 76,
    name: "settlement",
    detail: "program",
    program: true,
  },
  {
    id: "vault",
    x: COL[2],
    y: ROW[0],
    name: "Vault PDA",
    detail: "holds the stablecoin",
    pda: true,
  },
  { id: "recipient", x: COL[2], y: ROW[1], name: "Recipient token", detail: "the paid service" },
  {
    id: "receipt",
    x: COL[2],
    y: ROW[2],
    name: "Receipt PDA",
    detail: "seeds: wallet + nonce",
    pda: true,
  },
] as const;

const edges = [
  {
    d: `M${COL[0] + W} ${ROW[0] + 42}H${COL[1] - 6}`,
    label: "sets policy",
    x: 280,
    y: ROW[0] + 32,
    paid: false,
  },
  {
    d: `M${COL[1] + W} ${ROW[0] + 42}H${COL[2] - 6}`,
    label: "owns",
    x: 618,
    y: ROW[0] + 32,
    paid: false,
  },
  {
    d: `M${COL[0] + W} ${ROW[1] + 42}H277V${ROW[1] + 106}H${COL[1] - 6}`,
    label: "signs payment",
    x: 280,
    y: ROW[1] + 32,
    paid: true,
  },
  {
    d: `M${COL[0] + W} ${ROW[2] + 42}H277V${ROW[1] + 134}H${COL[1] - 6}`,
    label: "submits",
    x: 280,
    y: ROW[2] + 62,
    paid: false,
  },
  {
    d: `M${COL[1] + W / 2} ${ROW[1] + 76}V${ROW[0] + H + 6}`,
    label: "CPI debit",
    x: COL[1] + W / 2 + 10,
    y: ROW[0] + H + 42,
    paid: true,
    start: true,
  },
  {
    d: `M${COL[2] + W / 2} ${ROW[0] + H}V${ROW[1] - 6}`,
    label: "transfer",
    x: COL[2] + W / 2 + 10,
    y: ROW[0] + H + 38,
    paid: true,
    start: true,
  },
  {
    d: `M${COL[1] + W} ${ROW[1] + 120}H618V${ROW[2] + 42}H${COL[2] - 6}`,
    label: "creates",
    x: 618,
    y: ROW[1] + 110,
    paid: true,
  },
] as const;

const relations = [
  ["Owner wallet", "sets the policy of", "AgentWallet PDA"],
  ["AgentWallet PDA", "owns", "Vault PDA"],
  ["Session key", "signs a payment for", "settlement"],
  ["Facilitator", "submits it, with no authority over", "settlement"],
  ["settlement", "calls debit on", "AgentWallet PDA"],
  ["Vault PDA", "transfers to", "Recipient token"],
  ["settlement", "creates", "Receipt PDA"],
] as const;

/** Every account in a payment and what each may do to the others. */
export function AccountMap() {
  return (
    <figure className={styles.figure}>
      <svg viewBox="0 0 900 404" className={styles.svg} aria-hidden="true">
        <defs>
          <marker
            id="am-head"
            viewBox="0 0 8 8"
            refX="6"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M0 0 8 4 0 8Z" fill="var(--color-on-ink-muted)" />
          </marker>
          <marker
            id="am-paid"
            viewBox="0 0 8 8"
            refX="6"
            refY="4"
            markerWidth="7"
            markerHeight="7"
            orient="auto"
          >
            <path d="M0 0 8 4 0 8Z" fill="var(--color-mint)" />
          </marker>
        </defs>
        {edges.map((edge) => (
          <path
            key={edge.label}
            d={edge.d}
            className={edge.paid ? styles.edgePaid : styles.edge}
            markerEnd={`url(#${edge.paid ? "am-paid" : "am-head"})`}
          />
        ))}
        {edges.map((edge) => (
          <text
            key={edge.label}
            x={edge.x}
            y={edge.y}
            textAnchor={"start" in edge ? "start" : "middle"}
            className={styles.edgeLabel}
          >
            {edge.label}
          </text>
        ))}
        {nodes.map((node) => (
          <g key={node.id} transform={`translate(${node.x} ${node.y})`}>
            <rect
              width={W}
              height={H}
              rx={12}
              className={
                "program" in node ? styles.program : "pda" in node ? styles.pda : styles.node
              }
            />
            <text x={16} y={36} className={styles.name}>
              {node.name}
            </text>
            <text x={16} y={58} className={styles.detail}>
              {node.detail}
            </text>
          </g>
        ))}
      </svg>
      <ul className={styles.list}>
        {relations.map(([from, verb, to]) => (
          <li key={`${from}${to}`}>
            <strong>{from}</strong> <span>{verb}</span> <strong>{to}</strong>
          </li>
        ))}
      </ul>
    </figure>
  );
}
