"use client";

import styles from "./SettlementSequence.module.css";
import { useStepLoop } from "./useStepLoop";

const lanes = [
  { x: 52, name: "Agent", role: "session key" },
  { x: 180, name: "Paid API", role: "sdk-resource" },
  { x: 308, name: "Facilitator", role: "fee payer" },
  { x: 436, name: "Solana", role: "two programs" },
] as const;

type Tone = "request" | "price" | "paid";

const steps: readonly {
  from: number;
  to: number;
  label: string;
  tone: Tone;
  caption: string;
}[] = [
  {
    from: 0,
    to: 1,
    label: "POST /v1/summarize",
    tone: "request",
    caption: "The agent calls the route like any other API.",
  },
  {
    from: 1,
    to: 0,
    label: "402 PAYMENT-REQUIRED",
    tone: "price",
    caption: "The API answers with a price, a recipient and a fresh nonce.",
  },
  {
    from: 0,
    to: 0,
    label: "ed25519 sign, 260 bytes",
    tone: "request",
    caption: "The session key signs that exact payment and nothing wider.",
  },
  {
    from: 0,
    to: 1,
    label: "PAYMENT-SIGNATURE",
    tone: "request",
    caption: "The agent sends the same request again with the signature attached.",
  },
  {
    from: 1,
    to: 2,
    label: "/verify, /settle",
    tone: "request",
    caption: "The API hands the signed payment to a facilitator.",
  },
  {
    from: 2,
    to: 3,
    label: "ed25519 + settle",
    tone: "request",
    caption: "The facilitator pays the network fee. It cannot change a single byte.",
  },
  {
    from: 3,
    to: 3,
    label: "policy, debit, receipt",
    tone: "paid",
    caption: "The programs check the policy, move the funds and write the receipt.",
  },
  {
    from: 3,
    to: 2,
    label: "receipt PDA",
    tone: "paid",
    caption: "The receipt address comes back from the chain.",
  },
  {
    from: 2,
    to: 1,
    label: "settled",
    tone: "paid",
    caption: "The API now knows it has been paid.",
  },
  {
    from: 1,
    to: 0,
    label: "200 PAYMENT-RESPONSE",
    tone: "paid",
    caption: "The agent gets its answer, with the receipt attached.",
  },
];

const FIRST_ROW = 96;
const ROW = 37;
const HEIGHT = FIRST_ROW + ROW * steps.length;

/** Holds on the finished picture for a few frames before the exchange starts over. */
const HOLD_FRAMES = 3;

function laneX(index: number): number {
  return lanes[index]?.x ?? 0;
}

/** The x402 exchange as a sequence diagram, drawn one message at a time. */
export function SettlementSequence() {
  const last = steps.length - 1;
  const { ref, frame } = useStepLoop<HTMLElement>(steps.length + HOLD_FRAMES, 1400, last);
  const current = Math.min(frame, last);

  return (
    <figure
      ref={ref}
      className={styles.panel}
      aria-label="Sequence diagram of one paid request. The agent calls the API and gets a 402 with a price. It signs the payment and retries. The API passes it to a facilitator, which submits it to Solana. The programs check the policy, move the funds and write a receipt, and the agent gets its response."
    >
      <svg viewBox={`0 0 488 ${HEIGHT}`} className={styles.svg} aria-hidden="true">
        <defs>
          {(["request", "price", "paid"] as const).map((tone) => (
            <marker
              key={tone}
              id={`seq-${tone}`}
              viewBox="0 0 8 8"
              refX="7"
              refY="4"
              markerWidth="7"
              markerHeight="7"
              orient="auto-start-reverse"
            >
              <path d="M0 0 8 4 0 8Z" className={styles[`head_${tone}`]} />
            </marker>
          ))}
        </defs>

        {lanes.map((lane) => (
          <g key={lane.name}>
            <line x1={lane.x} x2={lane.x} y1={58} y2={HEIGHT - 8} className={styles.lifeline} />
            <rect x={lane.x - 50} y={10} width={100} height={48} rx={9} className={styles.actor} />
            <text x={lane.x} y={31} textAnchor="middle" className={styles.actorName}>
              {lane.name}
            </text>
            <text x={lane.x} y={47} textAnchor="middle" className={styles.actorRole}>
              {lane.role}
            </text>
          </g>
        ))}

        {steps.map((step, index) => {
          const y = FIRST_ROW + index * ROW;
          const shown = index <= frame;
          const active = index === current && frame <= last;
          const self = step.from === step.to;
          const fromX = laneX(step.from);
          const toX = laneX(step.to);
          const left = Math.min(fromX, toX);
          const toRightEdge = step.from === 3;
          return (
            <g
              key={step.label}
              className={[
                styles.row,
                styles[step.tone],
                shown ? styles.shown : "",
                active ? styles.active : "",
              ].join(" ")}
            >
              {self ? (
                <rect
                  x={fromX - 5}
                  y={y - 15}
                  width={10}
                  height={24}
                  rx={3}
                  className={styles.activation}
                />
              ) : (
                <line
                  x1={fromX + (toX > fromX ? 4 : -4)}
                  x2={toX + (toX > fromX ? -4 : 4)}
                  y1={y}
                  y2={y}
                  pathLength={1}
                  className={styles.arrow}
                  markerEnd={`url(#seq-${step.tone})`}
                />
              )}
              <text
                x={self ? (toRightEdge ? fromX - 12 : fromX + 12) : left + 9}
                y={self ? y + 1 : y - 7}
                textAnchor={self && toRightEdge ? "end" : "start"}
                className={styles.label}
              >
                {step.label}
              </text>
            </g>
          );
        })}
      </svg>
      <figcaption className={styles.caption}>
        <span className={styles.count}>
          {String(current + 1).padStart(2, "0")}/{steps.length}
        </span>
        <span>{steps[current]?.caption}</span>
      </figcaption>
    </figure>
  );
}
