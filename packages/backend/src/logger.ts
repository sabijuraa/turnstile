import { type Logger, pino } from "pino";

export type { Logger };

export function createLogger(level: string): Logger {
  return pino({ level, base: { service: "backend" } });
}
