import type { SettlementChain } from "./chain/types.js";
import type { Config } from "./config.js";
import type { Logger } from "./logger.js";
import type { Metrics } from "./metrics.js";
import type { Facilitator } from "./service.js";
import type { FacilitatorStore } from "./store/store.js";

/** Everything a route needs, built once per app. */
export interface Services {
  config: Config;
  chain: SettlementChain;
  store: FacilitatorStore;
  logger: Logger;
  metrics: Metrics;
  facilitator: Facilitator;
}

export interface AppEnv {
  Variables: {
    requestId: string;
    log: Logger;
  };
}
