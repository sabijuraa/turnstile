import { Hanken_Grotesk, IBM_Plex_Mono, Newsreader } from "next/font/google";

/** Display. A newspaper serif with presence at large sizes, calm and serious. Two static weights keep it light. */
export const display = Newsreader({
  subsets: ["latin"],
  weight: ["500", "600"],
  style: ["normal"],
  display: "swap",
  variable: "--font-newsreader",
  adjustFontFallback: true,
  fallback: ["Iowan Old Style", "Palatino Linotype", "Georgia", "serif"],
});

/** Text. A warm grotesk with open shapes that stays readable at small UI sizes. */
export const text = Hanken_Grotesk({
  subsets: ["latin"],
  weight: "variable",
  display: "swap",
  variable: "--font-hanken",
  fallback: ["Segoe UI", "Helvetica Neue", "Helvetica", "sans-serif"],
});

/** Mono. For amounts, receipts, addresses and code. */
export const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  display: "swap",
  variable: "--font-plex-mono",
  preload: false,
  fallback: ["ui-monospace", "Menlo", "Consolas", "monospace"],
});
