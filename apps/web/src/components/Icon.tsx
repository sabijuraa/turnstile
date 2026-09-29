import type { ReactElement, SVGProps } from "react";

/**
 * Turnstile line icons. Drawn on a 24 unit grid with a 1.5 stroke, round caps and round joins,
 * and a 2 unit corner radius on every rectangle so the set reads as one family.
 */
const paths = {
  arrowRight: (
    <>
      <path d="M4.5 12h15" />
      <path d="m13.5 6 6 6-6 6" />
    </>
  ),
  arrowUpRight: (
    <>
      <path d="M7 17 17 7" />
      <path d="M8.5 7H17v8.5" />
    </>
  ),
  check: <path d="m5 12.5 4.5 4.5L19 7.5" />,
  close: (
    <>
      <path d="M6 6l12 12" />
      <path d="M18 6 6 18" />
    </>
  ),
  menu: (
    <>
      <path d="M4 7.5h16" />
      <path d="M4 12h16" />
      <path d="M4 16.5h16" />
    </>
  ),
  copy: (
    <>
      <rect x="8.5" y="8.5" width="11" height="11" rx="2" />
      <path d="M15.5 8.5V6.5a2 2 0 0 0-2-2h-7a2 2 0 0 0-2 2v7a2 2 0 0 0 2 2h2" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15" r="3.75" />
      <path d="m10.75 12.25 8.25-8.25" />
      <path d="m16 7 2.5 2.5" />
      <path d="m13.5 9.5 2 2" />
    </>
  ),
  shield: (
    <>
      <path d="M12 3.5 5 6v5.5c0 4.25 2.9 7.6 7 9 4.1-1.4 7-4.75 7-9V6l-7-2.5Z" />
      <path d="m9 12 2.25 2.25L15.5 10" />
    </>
  ),
  gauge: (
    <>
      <path d="M4 16a8 8 0 1 1 16 0" />
      <path d="m12 16 4-5" />
      <path d="M4 19.5h16" />
    </>
  ),
  receipt: (
    <>
      <path d="M6 3.5h12v17l-2.25-1.5-2.25 1.5-1.5-1-1.5 1-2.25-1.5L6 20.5v-17Z" />
      <path d="M9 8h6" />
      <path d="M9 11.5h6" />
      <path d="M9 15h3.5" />
    </>
  ),
  wallet: (
    <>
      <rect x="3.5" y="6" width="17" height="13" rx="2" />
      <path d="M3.5 9.5h17" />
      <path d="M6 6l9.5-2.25a1.5 1.5 0 0 1 1.85 1.45V6" />
      <path d="M15.5 14h2" />
    </>
  ),
  code: (
    <>
      <path d="m8.5 7.5-4.5 4.5 4.5 4.5" />
      <path d="m15.5 7.5 4.5 4.5-4.5 4.5" />
      <path d="m13.25 5-2.5 14" />
    </>
  ),
  endpoint: (
    <>
      <rect x="3.5" y="5" width="17" height="14" rx="2" />
      <path d="M3.5 9h17" />
      <path d="m8 13 2 1.75L8 16.5" />
      <path d="M12.5 16.5h3.5" />
    </>
  ),
  list: (
    <>
      <path d="M9 7h11" />
      <path d="M9 12h11" />
      <path d="M9 17h11" />
      <path d="M4.5 7h.01" />
      <path d="M4.5 12h.01" />
      <path d="M4.5 17h.01" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 2" />
    </>
  ),
  alert: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.75v5" />
      <path d="M12 16.25h.01" />
    </>
  ),
  info: (
    <>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 11v5.25" />
      <path d="M12 7.75h.01" />
    </>
  ),
  search: (
    <>
      <circle cx="10.75" cy="10.75" r="6.25" />
      <path d="m15.5 15.5 4.5 4.5" />
    </>
  ),
  download: (
    <>
      <path d="M12 4v11" />
      <path d="m7.5 10.5 4.5 4.5 4.5-4.5" />
      <path d="M4.5 19.5h15" />
    </>
  ),
  chevronDown: <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />,
  sort: (
    <>
      <path d="m8 9.5 4-4 4 4" />
      <path d="m8 14.5 4 4 4-4" />
    </>
  ),
  sortAsc: <path d="m7.5 14 4.5-4.5 4.5 4.5" />,
  sortDesc: <path d="m7.5 10 4.5 4.5 4.5-4.5" />,
  lock: (
    <>
      <rect x="5" y="10.5" width="14" height="10" rx="2" />
      <path d="M8.5 10.5V7.75a3.5 3.5 0 0 1 7 0v2.75" />
      <path d="M12 14.5v2" />
    </>
  ),
  agent: (
    <>
      <rect x="5" y="7.5" width="14" height="11" rx="2" />
      <path d="M12 7.5V4.5" />
      <path d="M12 4.5h.01" />
      <path d="M9.5 12.5v1" />
      <path d="M14.5 12.5v1" />
      <path d="M2.5 12v3" />
      <path d="M21.5 12v3" />
    </>
  ),
  coins: (
    <>
      <ellipse cx="10" cy="7.5" rx="6" ry="2.75" />
      <path d="M4 7.5v4.25c0 1.5 2.7 2.75 6 2.75" />
      <path d="M4 11.75V16c0 1.5 2.7 2.75 6 2.75" />
      <ellipse cx="15" cy="15.5" rx="5" ry="2.25" />
      <path d="M10 15.5v2.75C10 19.5 12.25 20.5 15 20.5s5-1 5-2.25V15.5" />
    </>
  ),
  gate: (
    <>
      <path d="M5 4v16" />
      <path d="M19 4v16" />
      <path d="M5 10h6.5" />
      <path d="M19 10h-3" />
      <path d="M3.5 20h17" />
    </>
  ),
  pulse: <path d="M3.5 12h4l2-5 4 10 2-5h5" />,
  external: (
    <>
      <path d="M13.5 4.5h6v6" />
      <path d="m19.5 4.5-8 8" />
      <path d="M17 13.5v4a2 2 0 0 1-2 2H6.5a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2h4" />
    </>
  ),
  play: <path d="M8 5.5v13l10-6.5-10-6.5Z" />,
} satisfies Record<string, ReactElement>;

export type IconName = keyof typeof paths;
export const iconNames = Object.keys(paths) as IconName[];

export interface IconProps extends Omit<SVGProps<SVGSVGElement>, "children"> {
  name: IconName;
  /** Rendered size in pixels. Defaults to 20. */
  size?: number;
  /** Accessible name. Leave empty for decorative icons next to visible text. */
  title?: string;
}

export function Icon({ name, size = 20, title, ...rest }: IconProps) {
  const labelled = Boolean(title);
  return (
    // biome-ignore lint/a11y/noSvgWithoutTitle: the title is rendered when a label is given, otherwise the icon is aria-hidden
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.5}
      strokeLinecap="round"
      strokeLinejoin="round"
      role={labelled ? "img" : undefined}
      aria-hidden={labelled ? undefined : true}
      focusable="false"
      {...rest}
    >
      {labelled ? <title>{title}</title> : null}
      {paths[name]}
    </svg>
  );
}
