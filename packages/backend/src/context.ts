import type { MiddlewareHandler } from "hono";
import type { Pool } from "pg";
import type { AgentDirectory, SolanaRpc } from "./chain/directory.js";
import type { Config } from "./config.js";
import type { Logger } from "./logger.js";
import type { Metrics } from "./metrics.js";

/** Everything a route needs, built once per app. */
export interface Services {
  pool: Pool;
  rpc: SolanaRpc;
  config: Config;
  clock: () => Date;
  logger: Logger;
  metrics: Metrics;
  directory: AgentDirectory;
  /**
   * Replaces the session and API key check behind requireOwner. A host without the console
   * database, such as the web app's in-process console API, signs owners in some other way and
   * plugs its check in here. It must set `owner` and `authMethod` on the context.
   */
  authorize?: (opts: { apiKey: boolean }) => MiddlewareHandler<AppEnv>;
}

export type AuthMethod = "session" | "api_key";

export interface AppEnv {
  Variables: {
    requestId: string;
    log: Logger;
    owner: string;
    authMethod: AuthMethod;
  };
}
