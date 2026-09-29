import { type Logger, pino } from "pino";

export type { Logger };

export function createLogger(level: string): Logger {
  return pino({
    level,
    base: { service: "facilitator" },
    // Defense in depth. No code path logs key material, and these paths are dropped if one ever does.
    redact: { paths: ["secretKey", "*.secretKey", "feePayer", "*.feePayer"], remove: true },
  });
}
