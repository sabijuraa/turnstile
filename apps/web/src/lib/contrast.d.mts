export function luminance(hex: string): number;
export function contrastRatio(a: string, b: string): number;
export function parseTokens(css: string): Record<string, string>;
export const PAIRS: readonly { fg: string; bg: string; min: number }[];
