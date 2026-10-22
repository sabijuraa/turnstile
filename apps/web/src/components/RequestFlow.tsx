import styles from "./RequestFlow.module.css";

/**
 * The product in one picture. Paid requests leave the agent, pass the turnstile one at a time and
 * each prints a receipt while the daily cap gauge fills. The seventh request would pass the cap,
 * so the gate stays shut and it bounces back. Decorative, the copy around it says the same.
 */
export function RequestFlow() {
  const packets = [0, 1, 2, 3, 4, 5];
  return (
    <div className={styles.stage} aria-hidden="true">
      <svg viewBox="0 0 520 360" className={styles.svg}>
        <defs>
          <linearGradient id="rf-lane" x1="0" x2="1">
            <stop offset="0" stopColor="var(--color-mint)" stopOpacity="0" />
            <stop offset="0.5" stopColor="var(--color-mint)" stopOpacity="0.55" />
            <stop offset="1" stopColor="var(--color-mint)" stopOpacity="0" />
          </linearGradient>
          <radialGradient id="rf-glow">
            <stop offset="0" stopColor="var(--color-mint)" stopOpacity="0.45" />
            <stop offset="1" stopColor="var(--color-mint)" stopOpacity="0" />
          </radialGradient>
          <linearGradient id="rf-gauge" x1="0" x2="1">
            <stop offset="0" stopColor="var(--color-mint)" />
            <stop offset="0.75" stopColor="var(--color-amber)" />
            <stop offset="1" stopColor="var(--color-refuse)" />
          </linearGradient>
          <pattern id="rf-grid" width="24" height="24" patternUnits="userSpaceOnUse">
            <path d="M24 0H0V24" fill="none" stroke="var(--color-on-night-line)" strokeWidth="1" />
          </pattern>
        </defs>

        <rect width="520" height="360" fill="url(#rf-grid)" opacity="0.6" />

        {/* The agent */}
        <g transform="translate(26 132)">
          <rect width="96" height="96" rx="18" className={styles.node} />
          <text x="48" y="42" textAnchor="middle" className={styles.nodeLabel}>
            agent
          </text>
          <text x="48" y="62" textAnchor="middle" className={styles.nodeMono}>
            session key
          </text>
          <circle cx="48" cy="78" r="4" className={styles.live} />
        </g>

        {/* The lane */}
        <rect x="122" y="178" width="250" height="4" rx="2" fill="url(#rf-lane)" />

        {/* Paid requests */}
        {packets.map((i) => (
          <g key={i} className={styles.packet} style={{ animationDelay: `${i * 1.1}s` }}>
            <rect x="-22" y="-11" width="44" height="22" rx="11" className={styles.packetBody} />
            <text x="0" y="4" textAnchor="middle" className={styles.packetText}>
              0.005
            </text>
          </g>
        ))}
        <g className={styles.refused}>
          <rect x="-22" y="-11" width="44" height="22" rx="11" className={styles.refusedBody} />
          <text x="0" y="4" textAnchor="middle" className={styles.packetText}>
            0.005
          </text>
        </g>

        {/* The turnstile */}
        <g transform="translate(300 180)">
          <circle r="64" fill="url(#rf-glow)" />
          <rect x="-30" y="-66" width="60" height="132" rx="14" className={styles.post} />
          <g className={styles.arms}>
            {[0, 120, 240].map((a) => (
              <rect
                key={a}
                x="-3"
                y="-44"
                width="6"
                height="44"
                rx="3"
                transform={`rotate(${a})`}
                className={styles.arm}
              />
            ))}
            <circle r="9" className={styles.hub} />
          </g>
          <text y="-78" textAnchor="middle" className={styles.gateLabel}>
            policy on chain
          </text>
        </g>

        {/* The cap gauge */}
        <g transform="translate(300 338)">
          <path d="M-56 0 A56 56 0 0 1 56 0" className={styles.gaugeTrack} />
          <path
            d="M-56 0 A56 56 0 0 1 56 0"
            className={styles.gaugeFill}
            stroke="url(#rf-gauge)"
            pathLength={100}
          />
          <text y="-12" textAnchor="middle" className={styles.gaugeText}>
            daily cap
          </text>
        </g>

        {/* The receipt printer */}
        <g transform="translate(410 120)">
          <rect width="90" height="34" rx="8" className={styles.printer} />
          <rect x="12" y="26" width="66" height="6" rx="3" className={styles.slot} />
          <g className={styles.tape}>
            <path
              d="M18 30 H72 V150 l-6 6 -6 -6 -6 6 -6 -6 -6 6 -6 -6 -6 6 -6 -6 -6 6 -6 -6 Z"
              className={styles.paper}
            />
            {[0, 1, 2, 3, 4, 5].map((i) => (
              <g key={i} className={styles.line} style={{ animationDelay: `${0.75 + i * 1.1}s` }}>
                <rect x="24" y={42 + i * 17} width="30" height="4" rx="2" className={styles.ink} />
                <rect
                  x="58"
                  y={42 + i * 17}
                  width="9"
                  height="4"
                  rx="2"
                  className={styles.inkStrong}
                />
              </g>
            ))}
          </g>
          <text x="45" y="-10" textAnchor="middle" className={styles.gateLabel}>
            receipts
          </text>
        </g>

        <g className={styles.verdict} transform="translate(300 40)">
          <rect x="-88" y="-16" width="176" height="30" rx="15" className={styles.verdictBody} />
          <text y="4" textAnchor="middle" className={styles.verdictText}>
            DailyCapExceeded
          </text>
        </g>
      </svg>
    </div>
  );
}
