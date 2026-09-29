import { parseUnits, STABLECOIN_DECIMALS } from "@turnstile/shared";
import { z } from "zod";
import type { Config } from "../config.js";

const U64_MAX = (1n << 64n) - 1n;

export function mintDecimals(config: Config): number {
  return config.deployment?.mintDecimals ?? STABLECOIN_DECIMALS;
}

/**
 * A decimal amount in whole stablecoin units, such as "1.25", parsed exactly into base units.
 * More precision than the mint has is an error, never rounded.
 */
export function amountSchema(decimals: number, opts: { allowZero?: boolean } = {}) {
  return z
    .string({ error: `must be a decimal amount as a string, such as "1.25"` })
    .trim()
    .transform((value, ctx) => {
      let units: bigint;
      try {
        units = parseUnits(value, decimals);
      } catch {
        const tooPrecise =
          /^\d+\.\d+$/.test(value) && (value.split(".")[1]?.length ?? 0) > decimals;
        ctx.addIssue({
          code: "custom",
          message: tooPrecise
            ? `has more than ${decimals} decimal places. The stablecoin has ${decimals} decimals`
            : `must be a positive decimal amount such as "1.25"`,
        });
        return z.NEVER;
      }
      if (!opts.allowZero && units === 0n) {
        ctx.addIssue({ code: "custom", message: "must be above zero" });
        return z.NEVER;
      }
      if (units > U64_MAX) {
        ctx.addIssue({ code: "custom", message: "is larger than the chain can hold" });
        return z.NEVER;
      }
      return units;
    });
}
