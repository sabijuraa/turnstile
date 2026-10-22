/**
 * The whole Turnstile loop inside this web app, for a host with no servers of its own.
 *
 * The facilitator, the metered demo API and the demo agent are the same packages the Docker
 * stack runs. Here they share one process and call each other in memory instead of over HTTP, so
 * a serverless function can run a full paid request: the agent gets a 402, signs with its session
 * key, the paywall asks the facilitator to verify and settle, and the settlement program checks
 * the policy on chain. Their only state lives on chain, apart from the demo's run history, which
 * this keeps in memory because the page only ever shows recent runs.
 *
 * Switched on by TURNSTILE_LIVE=1. Keys come from server-only environment variables and never
 * reach the browser.
 */

import "server-only";

import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import {
  type Catalog,
  createApiMetrics,
  createApp as createDemoApi,
  createLogger as createDemoLogger,
  createRunnerApp,
  createRunnerMetrics,
  DemoRunner,
  MemoryRunStore,
  paywallRoutes,
  SolanaDemoChain,
} from "@turnstile/demo-api";
import {
  createApp as createFacilitator,
  createLogger,
  createMetrics,
  createSolanaChain,
  type FacilitatorStore,
  turnstileCodec,
} from "@turnstile/facilitator";
import { createAgent } from "@turnstile/sdk-agent";
import { createPaywall } from "@turnstile/sdk-resource";
import { NETWORKS, type NetworkName, parseUnits } from "@turnstile/shared";

/** Where the facilitator answers on this site. The paid API is served at the site root. */
export const FACILITATOR_PATH = "/api/live/facilitator";
/** The price of one paid call, in the deployment's stablecoin. */
const PRICE = "0.005";

interface LiveDeployment {
  network: NetworkName;
  caip2?: string;
  programs: { agentWallet: string; settlement: string };
  mint: string;
  mintDecimals: number;
  mintSymbol?: string;
  facilitator?: string;
  demoOwner?: string;
  demoSession?: string;
  demoRecipient: string;
}

export function liveEnabled(): boolean {
  return process.env.TURNSTILE_LIVE === "1";
}

function secretKey(name: string): Keypair {
  const raw = process.env[name];
  if (!raw)
    throw new Error(
      `${name} is not set. Add the key as a JSON byte array in the host's secret settings.`,
    );
  try {
    return Keypair.fromSecretKey(Uint8Array.from(JSON.parse(raw) as number[]));
  } catch {
    throw new Error(`${name} is not a JSON array of 64 secret key bytes.`);
  }
}

export function liveDeployment(): LiveDeployment {
  const raw = process.env.TURNSTILE_DEPLOYMENT;
  if (!raw)
    throw new Error("TURNSTILE_DEPLOYMENT is not set. Paste the deployment record JSON into it.");
  return JSON.parse(raw) as LiveDeployment;
}

/** A store for the facilitator's only state, kept in memory. Settlement itself lives on chain. */
function memoryFacilitatorStore(): FacilitatorStore {
  const resources = new Map<string, string>();
  return {
    async ping() {},
    async upsertResource(id, resource) {
      if (!resources.has(id)) resources.set(id, resource);
    },
    // A settle that fails after signing is reported to the caller, who retries the same payment.
    // Nothing is queued for replay here, because there is no worker to replay it.
    async recordDeadLetter() {
      return { id: "none", attempts: 1 };
    },
    async pendingDeadLetters() {
      return [];
    },
    async markDeadLetter() {},
  };
}

interface Live {
  origin: string;
  deployment: LiveDeployment;
  connection: Connection;
  facilitator: { fetch: (request: Request) => Response | Promise<Response> };
  demoApi: { fetch: (request: Request) => Response | Promise<Response> };
  catalog: Catalog;
  runner: DemoRunner;
  store: MemoryRunStore;
  /** The demo agent's own HTTP API, answered in process. */
  runnerApp: { fetch: (request: Request) => Response | Promise<Response> };
}

let cached: Live | null = null;

/**
 * Builds the in-process stack once per server instance. `origin` is this site's public origin,
 * which names the paid resources and must stay the same for every request an instance serves.
 */
export function live(origin: string): Live {
  if (cached) return cached;
  const deployment = liveDeployment();
  const network = deployment.network;
  const net = NETWORKS[network];
  const rpcUrl = process.env.SOLANA_RPC_URL ?? net.rpcUrl;
  const connection = new Connection(rpcUrl, "confirmed");
  const feePayer = secretKey("FACILITATOR_SECRET_KEY");
  const owner = secretKey("DEMO_OWNER_SECRET_KEY");
  const session = secretKey("DEMO_SESSION_SECRET_KEY");
  const caip2 = deployment.caip2 ?? net.caip2;
  const logLevel = process.env.LOG_LEVEL ?? "warn";

  const logger = createLogger(logLevel);
  const facilitatorUrl = `${origin}${FACILITATOR_PATH}`;
  const { app: facilitatorApp } = createFacilitator({
    config: {
      port: 0,
      databaseUrl: "",
      network,
      caip2,
      rpcUrl,
      wsUrl: process.env.SOLANA_WS_URL ?? net.wsUrl,
      deployment: { ...deployment, network },
      mint: new PublicKey(deployment.mint),
      mintDecimals: deployment.mintDecimals,
      settlementProgram: new PublicKey(deployment.programs.settlement),
      agentWalletProgram: new PublicKey(deployment.programs.agentWallet),
      publicUrl: facilitatorUrl,
      logLevel,
      defaultTimeoutSeconds: 60,
      maxTimeoutSeconds: 3600,
      bodyLimitBytes: 64 * 1024,
    },
    chain: createSolanaChain({
      rpcUrl,
      feePayer,
      codec: turnstileCodec,
      agentWalletProgram: new PublicKey(deployment.programs.agentWallet),
      settlementProgram: new PublicKey(deployment.programs.settlement),
      logger,
      connection,
    }),
    store: memoryFacilitatorStore(),
    logger,
    metrics: createMetrics(false),
  });

  // Requests for the facilitator never leave the process.
  const inProcess: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const url = new URL(request.url);
    if (url.origin === origin && url.pathname.startsWith(FACILITATOR_PATH)) {
      const inner = new URL(url.pathname.slice(FACILITATOR_PATH.length) || "/", origin);
      inner.search = url.search;
      return facilitatorApp.fetch(await rebase(request, inner));
    }
    if (url.origin === origin && url.pathname.startsWith("/v1/")) {
      return demoApi.app.fetch(request);
    }
    return fetch(request);
  };

  const apiConfig = {
    port: 0,
    network,
    deployment: { ...deployment, network } as never,
    facilitatorUrl,
    publicUrl: origin,
    price: PRICE,
    priceBaseUnits: parseUnits(PRICE, deployment.mintDecimals),
    payTo: deployment.demoRecipient,
    logLevel,
  };
  const paywall = createPaywall({
    facilitatorUrl,
    payTo: deployment.demoRecipient,
    publicUrl: origin,
    routes: paywallRoutes(apiConfig),
    fetch: inProcess,
  });
  const demoApi = createDemoApi({
    config: apiConfig,
    paywall,
    logger: createDemoLogger(logLevel, "demo-api"),
    metrics: createApiMetrics(false),
  });

  const store = new MemoryRunStore();
  const runnerMetrics = createRunnerMetrics(false);
  const runnerLogger = createDemoLogger(logLevel, "demo-agent");
  const runner = new DemoRunner({
    store,
    chain: new SolanaDemoChain({
      connection,
      owner,
      mint: new PublicKey(deployment.mint),
      mintDecimals: deployment.mintDecimals,
    }),
    logger: runnerLogger,
    metrics: runnerMetrics,
    owner: owner.publicKey,
    sessionKey: session.publicKey,
    mint: new PublicKey(deployment.mint),
    mintDecimals: deployment.mintDecimals,
    network: caip2,
    loadCatalog: async () => demoApi.catalog,
    demoApiUrl: origin,
    makeAgent: (agentWallet) =>
      createAgent({
        connection,
        agentWallet,
        sessionKey: session,
        localPolicyCheck: false,
        settlementProgram: deployment.programs.settlement,
        agentWalletProgram: deployment.programs.agentWallet,
        mintDecimals: deployment.mintDecimals,
        fetch: inProcess,
      }),
  });

  const runnerApp = createRunnerApp({
    runner,
    store,
    logger: runnerLogger,
    metrics: runnerMetrics,
    webOrigins: [origin],
    readiness: { solana: () => connection.getSlot("confirmed") },
    keepaliveMs: 10_000,
  });

  cached = {
    runnerApp,
    origin,
    deployment,
    connection,
    facilitator: facilitatorApp,
    demoApi: demoApi.app,
    catalog: demoApi.catalog,
    runner,
    store,
  };
  return cached;
}

/** The same request at another URL, with its body copied rather than re-streamed. */
export async function rebase(request: Request, url: URL): Promise<Request> {
  const body =
    request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer();
  return new Request(url, {
    method: request.method,
    headers: request.headers,
    body,
    signal: request.signal,
  });
}

/** The public origin of this deployment, from the request or an explicit setting. */
export function originOf(request: Request): string {
  const configured = process.env.TURNSTILE_PUBLIC_URL;
  if (configured) return new URL(configured).origin;
  const url = new URL(request.url);
  const host = request.headers.get("x-forwarded-host") ?? url.host;
  const proto = request.headers.get("x-forwarded-proto") ?? url.protocol.replace(":", "");
  return `${proto}://${host}`;
}
