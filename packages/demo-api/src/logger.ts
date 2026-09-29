import { type Logger, pino } from "pino";

export type { Logger };

export function createLogger(level: string, service: "demo-api" | "demo-agent"): Logger {
  return pino({ level, base: { service } });
}
