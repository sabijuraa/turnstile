import { useId } from "react";
import styles from "./art.module.css";

/*
 * Isometric shapes drawn in SVG. A point in 3D (x along the right axis, y along the left axis,
 * z up) maps to the screen with the usual 30 degree projection, so every shape lines up.
 */
const COS = Math.cos(Math.PI / 6);

type P3 = [number, number, number];

const round = (n: number) => Math.round(n * 100) / 100;

function face(points: P3[], ox: number, oy: number) {
  return points
    .map(([x, y, z]) => `${round(ox + (x - y) * COS)},${round(oy + (x + y) / 2 - z)}`)
    .join(" ");
}

export type Tone = "night" | "paper" | "glass" | "mint" | "teal" | "amber";

const SHADES: Record<
  Tone,
  { top: [string, string]; left: [string, string]; right: [string, string]; edge: string }
> = {
  night: {
    top: ["#2a5f56", "#12302b"],
    left: ["#0e2622", "#030b0a"],
    right: ["#1b443d", "#0a1c19"],
    edge: "rgb(70 227 183 / 0.22)",
  },
  paper: {
    top: ["#ffffff", "#f3f2ec"],
    left: ["#dcdbd1", "#c4c3b8"],
    right: ["#f4f3ec", "#dad9ce"],
    edge: "rgb(19 26 26 / 0.12)",
  },
  glass: {
    top: ["rgb(255 255 255 / 0.5)", "rgb(190 235 222 / 0.22)"],
    left: ["rgb(150 215 198 / 0.32)", "rgb(90 170 150 / 0.14)"],
    right: ["rgb(200 240 228 / 0.36)", "rgb(120 200 178 / 0.16)"],
    edge: "rgb(70 227 183 / 0.4)",
  },
  mint: {
    top: ["#9df5dd", "#46e3b7"],
    left: ["#1fa583", "#0f6e57"],
    right: ["#3ccda6", "#1c9476"],
    edge: "rgb(6 18 16 / 0.12)",
  },
  teal: {
    top: ["#1a8f8f", "#0b5a5c"],
    left: ["#063537", "#021b1c"],
    right: ["#0d6a6c", "#073f41"],
    edge: "rgb(255 255 255 / 0.08)",
  },
  amber: {
    top: ["#ffd08a", "#f5b14a"],
    left: ["#b77a22", "#8a5a12"],
    right: ["#dc9b39", "#b57c24"],
    edge: "rgb(6 18 16 / 0.12)",
  },
};

function useGradientId() {
  return useId().replace(/[^a-zA-Z0-9]/g, "");
}

/** One box, placed by its back corner, with width along x, depth along y and height along z. */
export function Box({
  x = 0,
  y = 0,
  z = 0,
  w,
  d,
  h,
  tone = "paper",
  ox,
  oy,
}: {
  x?: number;
  y?: number;
  z?: number;
  w: number;
  d: number;
  h: number;
  tone?: Tone;
  ox: number;
  oy: number;
}) {
  const id = useGradientId();
  const s = SHADES[tone];
  return (
    <g stroke={s.edge} strokeWidth="0.75">
      <defs>
        <linearGradient id={`${id}t`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor={s.top[0]} />
          <stop offset="1" stopColor={s.top[1]} />
        </linearGradient>
        <linearGradient id={`${id}l`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={s.left[0]} />
          <stop offset="1" stopColor={s.left[1]} />
        </linearGradient>
        <linearGradient id={`${id}r`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={s.right[0]} />
          <stop offset="1" stopColor={s.right[1]} />
        </linearGradient>
      </defs>
      <polygon
        fill={`url(#${id}l)`}
        points={face(
          [
            [x, y + d, z],
            [x + w, y + d, z],
            [x + w, y + d, z + h],
            [x, y + d, z + h],
          ],
          ox,
          oy,
        )}
      />
      <polygon
        fill={`url(#${id}r)`}
        points={face(
          [
            [x + w, y, z],
            [x + w, y + d, z],
            [x + w, y + d, z + h],
            [x + w, y, z + h],
          ],
          ox,
          oy,
        )}
      />
      <polygon
        fill={`url(#${id}t)`}
        points={face(
          [
            [x, y, z + h],
            [x + w, y, z + h],
            [x + w, y + d, z + h],
            [x, y + d, z + h],
          ],
          ox,
          oy,
        )}
      />
    </g>
  );
}

const COIN_TONES = {
  mint: { top: "#7df0d0", rim: "#1c9476", inset: "#2fbf98" },
  amber: { top: "#ffd08a", rim: "#a56e1a", inset: "#dc9b39" },
  paper: { top: "#ffffff", rim: "#c4c3b8", inset: "#dcdbd1" },
  night: { top: "#2a5f56", rim: "#061210", inset: "#46e3b7" },
  teal: { top: "#1a8f8f", rim: "#063537", inset: "#46e3b7" },
};

/** A coin lying flat, centred on the middle of its top face. */
export function Coin({
  cx,
  cy,
  r = 26,
  h = 9,
  tone = "mint",
}: {
  cx: number;
  cy: number;
  r?: number;
  h?: number;
  tone?: keyof typeof COIN_TONES;
}) {
  const c = COIN_TONES[tone];
  const ry = r * 0.56;
  return (
    <g>
      <path d={`M${cx - r} ${cy} v${h} a${r} ${ry} 0 0 0 ${r * 2} 0 v${-h} z`} fill={c.rim} />
      <ellipse cx={cx} cy={cy} rx={r} ry={ry} fill={c.top} />
      <ellipse
        cx={cx}
        cy={cy}
        rx={r * 0.62}
        ry={ry * 0.62}
        fill="none"
        stroke={c.inset}
        strokeWidth="1.5"
      />
    </g>
  );
}

/** Coins stacked upward from a base point. */
export function CoinStack({
  cx,
  cy,
  count,
  r = 34,
  gap = 13,
  tones = ["mint", "teal"],
}: {
  cx: number;
  cy: number;
  count: number;
  r?: number;
  gap?: number;
  tones?: (keyof typeof COIN_TONES)[];
}) {
  return (
    <g>
      {Array.from({ length: count }, (_, level) => level).map((level) => (
        <Coin
          key={level}
          cx={cx}
          cy={cy - level * gap}
          r={r}
          h={gap - 1}
          tone={tones[level % tones.length]}
        />
      ))}
    </g>
  );
}

/** A shaded sphere with a soft contact shadow. */
export function Ball({
  cx,
  cy,
  r,
  tone = "mint",
}: {
  cx: number;
  cy: number;
  r: number;
  tone?: "mint" | "night" | "paper";
}) {
  const id = useGradientId();
  const stops = {
    mint: ["#d6fff2", "#46e3b7", "#0f6e57"],
    night: ["#5f8f85", "#12302b", "#020807"],
    paper: ["#ffffff", "#ecebe3", "#bdbcb0"],
  }[tone];
  return (
    <g>
      <defs>
        <radialGradient id={id} cx="0.35" cy="0.3" r="0.75">
          <stop offset="0" stopColor={stops[0]} />
          <stop offset="0.45" stopColor={stops[1]} />
          <stop offset="1" stopColor={stops[2]} />
        </radialGradient>
      </defs>
      <circle cx={cx} cy={cy} r={r} fill={`url(#${id})`} />
    </g>
  );
}

/** A tilted ring with a small sphere riding along it. */
export function Orbit({
  cx,
  cy,
  rx,
  ry,
  tilt = -16,
  color = "rgb(19 26 26 / 0.3)",
  dot = "#0b5a5c",
  seconds = 18,
}: {
  cx: number;
  cy: number;
  rx: number;
  ry: number;
  tilt?: number;
  color?: string;
  dot?: string;
  seconds?: number;
}) {
  const d = `M ${cx + rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx - rx} ${cy} A ${rx} ${ry} 0 1 1 ${cx + rx} ${cy}`;
  return (
    <g transform={`rotate(${tilt} ${cx} ${cy})`}>
      <path d={d} fill="none" stroke={color} strokeWidth="1.1" />
      <circle
        r="4.5"
        fill={dot}
        className={styles.ride}
        style={{ offsetPath: `path("${d}")`, animationDuration: `${seconds}s` }}
      />
    </g>
  );
}

/** A slip of paper with a torn edge and a tick, standing in the isometric plane. */
export function ReceiptSlip({
  x,
  y,
  scale = 1,
  skew = true,
}: {
  x: number;
  y: number;
  scale?: number;
  skew?: boolean;
}) {
  const matrix = skew
    ? `matrix(${0.866 * scale} ${-0.5 * scale} 0 ${scale} ${x} ${y})`
    : `translate(${x} ${y}) scale(${scale})`;
  return (
    <g transform={matrix}>
      <path
        d="M0 0H74V112l-9.25 8-9.25-8-9.25 8-9.25-8-9.25 8-9.25-8-9.25 8-9.25-8z"
        fill="#fcfcf9"
        stroke="rgb(19 26 26 / 0.14)"
      />
      <rect x="12" y="14" width="34" height="6" rx="3" fill="#131a1a" />
      <rect x="12" y="32" width="50" height="4" rx="2" fill="#cdccc2" />
      <rect x="12" y="44" width="50" height="4" rx="2" fill="#cdccc2" />
      <rect x="12" y="56" width="30" height="4" rx="2" fill="#cdccc2" />
      <circle cx="51" cy="88" r="12" fill="#0b5a5c" />
      <path
        d="M45.5 88l4 4 7-8"
        fill="none"
        stroke="#46e3b7"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="12" y="84" width="20" height="8" rx="2" fill="#e2eeec" />
    </g>
  );
}
