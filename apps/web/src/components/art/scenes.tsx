import styles from "./art.module.css";
import { Ball, Box, Coin, CoinStack, Orbit, ReceiptSlip } from "./Iso";

const ARM_ANGLES = [0, 120, 240];

/** Three turnstile arms on one level, spinning in the isometric ground plane. */
function Arms({ ox, oy, z }: { ox: number; oy: number; z: number }) {
  return (
    <g transform={`matrix(0.866 0.5 -0.866 0.5 ${ox} ${oy - z})`}>
      <g className={styles.spin}>
        {ARM_ANGLES.map((angle) => (
          <g key={angle} transform={`rotate(${angle})`}>
            <rect
              x="10"
              y="-8"
              width="98"
              height="16"
              rx="8"
              fill="#1c9476"
              transform="translate(5 8)"
            />
            <rect x="10" y="-8" width="98" height="16" rx="8" fill="#9df5dd" />
          </g>
        ))}
      </g>
    </g>
  );
}

/** The hero. A full-height turnstile on a plinth, with coins going in and a receipt coming out. */
export function GateScene() {
  const ox = 290;
  const oy = 250;
  return (
    <svg viewBox="0 0 580 520" className={styles.art} aria-hidden="true">
      <defs>
        <radialGradient id="gateGlow" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0" stopColor="#46e3b7" stopOpacity="0.32" />
          <stop offset="1" stopColor="#46e3b7" stopOpacity="0" />
        </radialGradient>
      </defs>
      <ellipse
        cx={ox}
        cy={oy + 46}
        rx="270"
        ry="170"
        fill="url(#gateGlow)"
        className={styles.pulse}
      />
      <g stroke="rgb(70 227 183 / 0.14)" fill="none">
        <polygon points="290,18 540,162 540,396 290,510 40,396 40,162" />
        <line x1="290" y1="18" x2="290" y2="510" />
      </g>
      <Orbit
        cx={ox}
        cy={oy + 10}
        rx={262}
        ry={78}
        color="rgb(70 227 183 / 0.4)"
        dot="#46e3b7"
        seconds={16}
      />

      <g className={styles.float}>
        <Box x={-150} y={-150} z={-14} w={300} d={300} h={14} tone="night" ox={ox} oy={oy} />
        <Box x={-135} y={-135} w={270} d={270} h={8} tone="glass" ox={ox} oy={oy} />
        <Box x={-120} y={-122} z={8} w={240} d={36} h={40} tone="paper" ox={ox} oy={oy} />
        <Box x={-120} y={-122} z={48} w={240} d={36} h={6} tone="mint" ox={ox} oy={oy} />
        <Box x={-135} y={24} z={8} w={270} d={34} h={1} tone="teal" ox={ox} oy={oy} />

        <g>
          <g className={styles.coinRun}>
            <Coin cx={ox + 64 - 33} cy={oy + 37 + 19 - 8} r={21} h={7} tone="amber" />
          </g>
          <g className={`${styles.coinRun} ${styles.coinRun2}`}>
            <Coin cx={ox + 64 - 33} cy={oy + 37 + 19 - 8} r={21} h={7} tone="amber" />
          </g>
          <g className={`${styles.coinRun} ${styles.coinRun3}`}>
            <Coin cx={ox + 64 - 33} cy={oy + 37 + 19 - 8} r={21} h={7} tone="amber" />
          </g>
        </g>

        <Box x={-17} y={-17} z={8} w={34} d={34} h={160} tone="teal" ox={ox} oy={oy} />
        <Arms ox={ox} oy={oy} z={66} />
        <Arms ox={ox} oy={oy} z={104} />
        <Arms ox={ox} oy={oy} z={142} />
        <Box x={-22} y={-22} z={168} w={44} d={44} h={9} tone="mint" ox={ox} oy={oy} />

        <Box x={-120} y={86} z={8} w={240} d={36} h={18} tone="paper" ox={ox} oy={oy} />
        <Box x={-120} y={86} z={26} w={240} d={36} h={6} tone="mint" ox={ox} oy={oy} />
      </g>

      <g className={styles.floatFast}>
        <ReceiptSlip x={448} y={350} scale={0.92} />
      </g>
      <g className={styles.floatSlow}>
        <Box x={0} y={0} w={46} d={46} h={46} tone="teal" ox={82} oy={108} />
        <circle cx="96" cy="150" r="3.4" fill="#46e3b7" />
        <circle cx="110" cy="142" r="3.4" fill="#46e3b7" />
      </g>
      <g className={styles.float}>
        <Ball cx={432} cy={70} r={15} tone="mint" />
      </g>
      <Ball cx={52} cy={330} r={9} tone="paper" />
    </svg>
  );
}

/** An agent cube with a coin dropping onto it. */
export function AskArt() {
  return (
    <svg viewBox="0 0 220 170" className={styles.art} aria-hidden="true">
      <ellipse cx="110" cy="146" rx="70" ry="16" fill="rgb(19 26 26 / 0.07)" />
      <Box x={-36} y={-36} w={72} d={72} h={68} tone="teal" ox={110} oy={106} />
      <circle cx="127" cy="110" r="4.5" fill="#46e3b7" />
      <circle cx="148" cy="98" r="4.5" fill="#46e3b7" />
      <g className={styles.bob}>
        <Coin cx={110} cy={26} r={24} h={8} tone="amber" />
      </g>
    </svg>
  );
}

/** A shield standing in the isometric plane, thick, with a tick. */
export function ShieldArt({ dark = false }: { dark?: boolean }) {
  const outline = "M0 8 44 -8 88 8V58C88 92 62 110 44 120 26 110 0 92 0 58Z";
  return (
    <svg viewBox="0 0 220 170" className={styles.art} aria-hidden="true">
      <ellipse
        cx="110"
        cy="150"
        rx="70"
        ry="14"
        fill={dark ? "rgb(70 227 183 / 0.14)" : "rgb(19 26 26 / 0.07)"}
      />
      <g transform="matrix(0.866 -0.5 0 1 62 62)">
        <path d={outline} fill="#063537" transform="translate(-12 -2)" />
        <path d={outline} fill="#0b5a5c" transform="translate(-6 -1)" />
        <path d={outline} fill="#1a8f8f" />
        <path
          d="M24 52 39 67 66 36"
          fill="none"
          stroke="#9df5dd"
          strokeWidth="9"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </g>
    </svg>
  );
}

export function SlipArt() {
  return (
    <svg viewBox="0 0 220 170" className={styles.art} aria-hidden="true">
      <ellipse cx="108" cy="150" rx="60" ry="13" fill="rgb(19 26 26 / 0.07)" />
      <g opacity="0.55">
        <ReceiptSlip x={84} y={72} scale={0.86} />
      </g>
      <g className={styles.floatFast}>
        <ReceiptSlip x={72} y={66} scale={0.96} />
      </g>
    </svg>
  );
}

const SKYLINE: readonly [number, number, number][] = [
  [-90, -90, 62],
  [-30, -90, 96],
  [30, -90, 74],
  [-90, -30, 118],
  [-30, -30, 140],
  [30, -30, 92],
  [-90, 30, 84],
  [-30, 30, 122],
  [30, 30, 52],
];

/** Spend as a block of columns under a glass ceiling, with one coin stopped above it. */
export function CapScene() {
  const ox = 260;
  const oy = 230;
  return (
    <svg viewBox="0 0 520 470" className={styles.art} aria-hidden="true">
      <ellipse cx={ox} cy={oy + 130} rx="200" ry="70" fill="rgb(70 227 183 / 0.1)" />
      <Orbit
        cx={ox}
        cy={oy + 40}
        rx={236}
        ry={66}
        tilt={-14}
        color="rgb(70 227 183 / 0.36)"
        dot="#46e3b7"
      />
      <Box x={-110} y={-110} z={-10} w={220} d={220} h={10} tone="night" ox={ox} oy={oy + 60} />
      {SKYLINE.map(([x, y, h]) => (
        <Box
          key={`${x}${y}`}
          x={x}
          y={y}
          w={50}
          d={50}
          h={h}
          tone={h > 110 ? "mint" : "paper"}
          ox={ox}
          oy={oy + 60}
        />
      ))}
      <g className={styles.pulse}>
        <Box x={-120} y={-120} z={150} w={240} d={240} h={5} tone="glass" ox={ox} oy={oy + 60} />
      </g>
      <g className={styles.bob}>
        <Coin cx={ox} cy={oy - 186 + 60 + 6} r={28} h={9} tone="amber" />
      </g>
      <g className={styles.floatSlow}>
        <Ball cx={70} cy={120} r={13} tone="paper" />
      </g>
    </svg>
  );
}

/** A stack of receipts held in place by a seal. */
export function ReceiptScene() {
  return (
    <svg viewBox="0 0 480 400" className={styles.art} aria-hidden="true">
      <g stroke="rgb(19 26 26 / 0.08)" fill="none">
        <polygon points="240,14 440,128 440,328 240,392 40,328 40,128" />
      </g>
      <ellipse cx="240" cy="350" rx="150" ry="28" fill="rgb(19 26 26 / 0.08)" />
      <Orbit cx={240} cy={215} rx={214} ry={62} tilt={-14} />
      <g className={styles.float}>
        <g opacity="0.45">
          <ReceiptSlip x={232} y={210} scale={1.5} />
        </g>
        <g opacity="0.75">
          <ReceiptSlip x={196} y={214} scale={1.6} />
        </g>
        <ReceiptSlip x={152} y={222} scale={1.72} />
      </g>
      <g className={styles.floatFast}>
        <Ball cx={414} cy={92} r={14} tone="night" />
      </g>
      <Ball cx={70} cy={300} r={9} tone="mint" />
    </svg>
  );
}

/** A safe with coins resting on top. */
export function VaultScene() {
  const ox = 230;
  const oy = 190;
  return (
    <svg viewBox="0 0 460 380" className={styles.art} aria-hidden="true">
      <ellipse cx={ox} cy={oy + 130} rx="170" ry="40" fill="rgb(19 26 26 / 0.08)" />
      <g className={styles.float}>
        <Box x={-90} y={-90} w={180} d={180} h={148} tone="night" ox={ox} oy={oy + 70} />
        <g transform={`matrix(0.866 -0.5 0 1 ${ox + 12} ${oy + 113})`}>
          <rect
            x="0"
            y="-92"
            width="130"
            height="118"
            rx="8"
            fill="#0b5a5c"
            stroke="rgb(70 227 183 / 0.4)"
          />
          <circle cx="65" cy="-33" r="27" fill="#061210" stroke="#46e3b7" strokeWidth="3" />
          <circle cx="65" cy="-33" r="8" fill="#46e3b7" />
          <g stroke="#46e3b7" strokeWidth="3" strokeLinecap="round">
            <line x1="65" y1="-54" x2="65" y2="-46" />
            <line x1="65" y1="-20" x2="65" y2="-12" />
            <line x1="44" y1="-33" x2="52" y2="-33" />
            <line x1="78" y1="-33" x2="86" y2="-33" />
          </g>
        </g>
        <CoinStack cx={ox - 28} cy={oy - 38} count={4} r={30} gap={11} tones={["amber"]} />
        <CoinStack cx={ox + 36} cy={oy - 18} count={2} r={30} gap={11} tones={["amber"]} />
      </g>
      <g className={styles.floatFast}>
        <Coin cx={392} cy={84} r={18} h={6} tone="amber" />
      </g>
      <Ball cx={56} cy={110} r={11} tone="mint" />
    </svg>
  );
}

/** A key lying on a plinth, the session key. */
export function KeyScene() {
  const ox = 230;
  const oy = 190;
  return (
    <svg viewBox="0 0 460 380" className={styles.art} aria-hidden="true">
      <ellipse cx={ox} cy={oy + 124} rx="180" ry="42" fill="rgb(19 26 26 / 0.08)" />
      <Box x={-120} y={-120} z={-20} w={240} d={240} h={20} tone="paper" ox={ox} oy={oy + 30} />
      <Orbit cx={ox} cy={oy} rx={212} ry={60} tilt={-14} />
      <g className={styles.float}>
        <g transform={`matrix(0.866 0.5 -0.866 0.5 ${ox} ${oy + 6})`}>
          <g transform="translate(5 7)" fill="#063537">
            <circle cx="-62" cy="0" r="38" />
            <rect x="-30" y="-11" width="124" height="22" rx="4" />
            <rect x="64" y="8" width="16" height="26" rx="3" />
            <rect x="36" y="8" width="16" height="18" rx="3" />
          </g>
          <circle cx="-62" cy="0" r="38" fill="#1a8f8f" />
          <circle cx="-62" cy="0" r="15" fill="#f6f5f0" />
          <rect x="-30" y="-11" width="124" height="22" rx="4" fill="#1a8f8f" />
          <rect x="64" y="8" width="16" height="26" rx="3" fill="#1a8f8f" />
          <rect x="36" y="8" width="16" height="18" rx="3" fill="#1a8f8f" />
        </g>
      </g>
      <g className={styles.floatFast}>
        <Ball cx={392} cy={82} r={13} tone="mint" />
      </g>
    </svg>
  );
}

/** Coin towers rising, for pricing. */
export function CoinsScene() {
  return (
    <svg viewBox="0 0 400 300" className={styles.art} aria-hidden="true">
      <ellipse cx="200" cy="244" rx="150" ry="36" fill="rgb(19 26 26 / 0.08)" />
      <CoinStack cx={138} cy={214} count={7} r={46} gap={15} />
      <CoinStack cx={250} cy={232} count={3} r={46} gap={15} tones={["paper"]} />
      <g className={styles.bob}>
        <Coin cx={322} cy={82} r={24} h={8} tone="amber" />
      </g>
      <Ball cx={62} cy={74} r={10} tone="night" />
    </svg>
  );
}

/** Stacked server slabs with status lights, for a metered API. */
export function ApiArt() {
  const ox = 120;
  const oy = 92;
  return (
    <svg viewBox="0 0 240 190" className={styles.art} aria-hidden="true">
      <ellipse cx="120" cy="168" rx="84" ry="16" fill="rgb(19 26 26 / 0.07)" />
      {[0, 34, 68].map((z) => (
        <g key={z}>
          <Box
            x={-54}
            y={-54}
            z={z - 32}
            w={108}
            d={108}
            h={26}
            tone={z === 68 ? "teal" : "paper"}
            ox={ox}
            oy={oy + 34}
          />
          <circle
            cx={ox + 18}
            cy={oy + 108 - z - 14}
            r="3.2"
            fill={z === 68 ? "#46e3b7" : "#0b5a5c"}
            className={styles.pulse}
          />
        </g>
      ))}
      <g className={styles.bob}>
        <Coin cx={ox + 66} cy={28} r={15} h={5} tone="amber" />
      </g>
    </svg>
  );
}

/** A cylinder of records, for a paid data feed. */
export function DataArt() {
  return (
    <svg viewBox="0 0 240 190" className={styles.art} aria-hidden="true">
      <ellipse cx="120" cy="166" rx="84" ry="16" fill="rgb(19 26 26 / 0.07)" />
      <CoinStack cx={120} cy={138} count={4} r={56} gap={26} tones={["paper", "teal"]} />
      <g className={styles.bob}>
        <rect x="104" y="18" width="32" height="10" rx="5" fill="#46e3b7" />
      </g>
      <Ball cx={204} cy={50} r={8} tone="night" />
    </svg>
  );
}

/** Two agents passing a coin between them. */
export function AgentsArt() {
  return (
    <svg viewBox="0 0 240 190" className={styles.art} aria-hidden="true">
      <ellipse cx="120" cy="160" rx="100" ry="16" fill="rgb(19 26 26 / 0.07)" />
      <Box x={-28} y={-28} w={56} d={56} h={54} tone="teal" ox={62} oy={118} />
      <circle cx="75" cy="122" r="3.6" fill="#46e3b7" />
      <circle cx="92" cy="112" r="3.6" fill="#46e3b7" />
      <Box x={-28} y={-28} w={56} d={56} h={54} tone="paper" ox={178} oy={118} />
      <circle cx="191" cy="122" r="3.6" fill="#0b5a5c" />
      <circle cx="208" cy="112" r="3.6" fill="#0b5a5c" />
      <path
        d="M62 62 Q120 0 178 62"
        fill="none"
        stroke="rgb(19 26 26 / 0.3)"
        strokeDasharray="4 5"
      />
      <g className={styles.bob}>
        <Coin cx={120} cy={38} r={16} h={6} tone="amber" />
      </g>
    </svg>
  );
}

const PIN_STEPS = [-48, -24, 0, 24, 48];

/** A processor on a board, for pay-per-use compute. */
export function ComputeArt() {
  const ox = 120;
  const oy = 96;
  return (
    <svg viewBox="0 0 240 190" className={styles.art} aria-hidden="true">
      <ellipse cx="120" cy="166" rx="96" ry="18" fill="rgb(19 26 26 / 0.07)" />
      <Box x={-82} y={-82} z={-8} w={164} d={164} h={8} tone="paper" ox={ox} oy={oy} />
      {PIN_STEPS.map((step) => (
        <g key={step}>
          <Box x={step - 3} y={-72} w={6} d={144} h={2} tone="mint" ox={ox} oy={oy} />
          <Box x={-72} y={step - 3} w={144} d={6} h={2} tone="mint" ox={ox} oy={oy} />
        </g>
      ))}
      <Box x={-46} y={-46} z={2} w={92} d={92} h={18} tone="teal" ox={ox} oy={oy} />
      <g className={styles.pulse}>
        <Box x={-22} y={-22} z={20} w={44} d={44} h={5} tone="mint" ox={ox} oy={oy} />
      </g>
    </svg>
  );
}

/** Small shapes for a page corner. */
export function CornerShapes() {
  return (
    <svg viewBox="0 0 240 190" className={styles.art} aria-hidden="true">
      <g className={styles.float}>
        <Box x={-34} y={-34} w={68} d={68} h={68} tone="teal" ox={130} oy={84} />
      </g>
      <g className={styles.floatSlow}>
        <Box x={-16} y={-16} w={32} d={32} h={32} tone="paper" ox={46} oy={120} />
      </g>
      <g className={styles.floatFast}>
        <Ball cx={210} cy={36} r={12} tone="mint" />
      </g>
    </svg>
  );
}
