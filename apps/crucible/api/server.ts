import { cors } from "@elysiajs/cors";
import {
  extractAuthHeaders,
  validateWalletSignatureFromHeaders,
  type WalletSignatureConfig,
} from "@jejunetwork/api";
import type { ContractCategoryName } from "@jejunetwork/config";
import {
  getContract,
  getCurrentNetwork,
  getEnvNumber,
  getEnvVar,
  getRpcUrl,
  getServicesConfig,
  getServiceUrl,
} from "@jejunetwork/config";
import type { JsonObject } from "@jejunetwork/types";
import { isValidAddress } from "@jejunetwork/types";
import { Elysia } from "elysia";
import { createPublicClient, http } from "viem";
import { localhost, mainnet, sepolia } from "viem/chains";
import { z } from "zod";
import type {
  AgentCharacter,
  CrucibleConfig,
  ExecutionRequest,
} from "../lib/types";
import { DEFAULT_AUTONOMOUS_CONFIG } from "./autonomous/types";
import { BotInitializer } from "./bots/initializer";
import type { TradingBot } from "./bots/trading-bot";
import {
  AUTONOMOUS_AGENTS,
  characters,
  getCharacter,
  listCharacters,
} from "./characters";
import { checkDWSHealth } from "./client/dws";
import { configureCrucible, config as crucibleConfig } from "./config";
import { cronRoutes } from "./cron";
import { banCheckMiddleware } from "./middleware/ban-check";
import {
  AddMemoryRequestSchema,
  AgentIdParamSchema,
  AgentSearchQuerySchema,
  AgentStartRequestSchema,
  BotIdParamSchema,
  ChatRequestSchema,
  CreateRoomRequestSchema,
  ExecuteRequestSchema,
  expect,
  FundAgentRequestSchema,
  JoinRoomRequestSchema,
  LeaveRoomRequestSchema,
  PostMessageRequestSchema,
  parseOrThrow,
  RegisterAgentRequestSchema,
  RoomIdParamSchema,
  SetPhaseRequestSchema,
} from "./schemas";
import { createAgentSDK } from "./sdk/agent";
import { createCompute } from "./sdk/compute";
import { type RuntimeMessage, runtimeManager } from "./sdk/eliza-runtime";
import { createExecutorSDK } from "./sdk/executor";
import { createKMSSigner } from "./sdk/kms-signer";
import { createLogger } from "./sdk/logger";
import { createRoomSDK } from "./sdk/room";
import { getApiKey, getPrivateKey } from "./sdk/secrets";
import { createStorage } from "./sdk/storage";
import { getDatabase } from "./sdk/database";

const log = createLogger("Server");

// Action counter for tracking daily actions
const actionCounter = {
  today: new Date().toISOString().split("T")[0],
  count: 0,
  increment() {
    const currentDay = new Date().toISOString().split("T")[0];
    if (currentDay !== this.today) {
      this.today = currentDay;
      this.count = 0;
    }
    this.count++;
  },
  getTodayCount() {
    const currentDay = new Date().toISOString().split("T")[0];
    if (currentDay !== this.today) {
      return 0;
    }
    return this.count;
  },
};

// Activity feed for tracking recent events
interface ActivityEvent {
  id: string;
  type:
    | "agent_created"
    | "room_created"
    | "message_sent"
    | "action_executed"
    | "trade_completed";
  actor: string;
  description: string;
  timestamp: number;
  metadata?: Record<string, string | number>;
}

const activityStore = {
  events: [] as ActivityEvent[],
  maxEvents: 100,
  add(event: Omit<ActivityEvent, "id" | "timestamp">) {
    this.events.unshift({
      ...event,
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`,
      timestamp: Date.now(),
    });
    if (this.events.length > this.maxEvents) {
      this.events.pop();
    }
  },
  getRecent(limit = 10): ActivityEvent[] {
    return this.events.slice(0, limit);
  },
};

/**
 * Safely get contract address, returning undefined if not configured.
 * Used for optional contracts that may not be deployed yet.
 */
function getContractSafe(
  category: ContractCategoryName,
  name: string,
  network: "localnet" | "testnet" | "mainnet",
): `0x${string}` | undefined {
  // Check env var first
  const envKey = `${category.toUpperCase()}_${name.replace(/([A-Z])/g, "_$1").toUpperCase()}`;
  const envVal = process.env[envKey];
  if (envVal && /^0x[a-fA-F0-9]{40}$/.test(envVal)) {
    return envVal as `0x${string}`;
  }
  // Fall back to contracts.json via getContract
  try {
    return getContract(category, name, network) as `0x${string}`;
  } catch {
    return undefined;
  }
}

/**
 * Constant-time string comparison to prevent timing attacks.
 * Returns true only if both strings are identical.
 */
function constantTimeCompare(a: string, b: string): boolean {
  if (a.length !== b.length) {
    // Still do a comparison to avoid timing leak on length check
    let xor = 0;
    for (let i = 0; i < a.length; i++) {
      xor |= a.charCodeAt(i) ^ (b.charCodeAt(i % b.length) || 0);
    }
    return xor === 0 && false; // Always false for length mismatch, but use xor to prevent optimization
  }
  let xor = 0;
  for (let i = 0; i < a.length; i++) {
    xor |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return xor === 0;
}

// Wallet signature config for ownership verification
const walletSignatureConfig: WalletSignatureConfig = {
  domain: "crucible.jejunetwork.org",
  validityWindowMs: 5 * 60 * 1000, // 5 minutes
};

/**
 * Verify that the caller owns or controls the specified agent.
 * Requires cryptographic signature verification via x-jeju-* headers.
 * Server's own wallet is also authorized for automated operations.
 */
async function verifyAgentOwnership(
  agentId: bigint,
  request: Request,
  agentSdkInstance: ReturnType<typeof createAgentSDK>,
  serverAccount: { address: `0x${string}` } | null,
): Promise<{ authorized: boolean; reason?: string }> {
  // Extract and validate wallet signature from headers
  const headers = extractAuthHeaders(request.headers);
  const signatureResult = await validateWalletSignatureFromHeaders(
    headers,
    walletSignatureConfig,
  );

  if (!signatureResult.valid) {
    return {
      authorized: false,
      reason:
        signatureResult.error ??
        "Wallet signature verification failed. Required headers: x-jeju-address, x-jeju-timestamp, x-jeju-signature",
    };
  }

  const callerAddress = signatureResult.user?.address;
  if (!callerAddress) {
    return {
      authorized: false,
      reason: "Could not extract address from signature",
    };
  }

  // Get agent from SDK to check ownership
  const agent = await agentSdkInstance.getAgent(agentId);
  if (!agent) {
    return { authorized: false, reason: "Agent not found" };
  }

  const callerLower = callerAddress.toLowerCase();
  const ownerLower = agent.owner.toLowerCase();

  // Check if caller is the owner
  if (callerLower === ownerLower) {
    return { authorized: true };
  }

  // Also allow the server's own wallet (for automated operations)
  if (serverAccount && callerLower === serverAccount.address.toLowerCase()) {
    return { authorized: true };
  }

  return { authorized: false, reason: "Not authorized to modify this agent" };
}

// Metrics tracking
const metrics = {
  requests: { total: 0, success: 0, error: 0 },
  agents: { registered: 0, executions: 0 },
  rooms: { created: 0, messages: 0 },
  latency: { sum: 0, count: 0 },
  startTime: Date.now(),
};

// Rate limiting configuration - uses distributed cache
import { type CacheClient, getCacheClient } from "@jejunetwork/shared";

const RATE_LIMIT_WINDOW_MS = 60_000; // 1 minute
const RATE_LIMIT_MAX_REQUESTS = crucibleConfig.rateLimitMaxRequests;

// Distributed cache for rate limiting
let rateLimitCache: CacheClient | null = null;
function getRateLimitCache(): CacheClient {
  if (!rateLimitCache) {
    rateLimitCache = getCacheClient("crucible-ratelimit");
  }
  return rateLimitCache;
}

// CORS configuration - restrict to allowed origins
const ALLOWED_ORIGINS = crucibleConfig.corsAllowedOrigins
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

// Default to requiring auth on non-localnet (testnet/mainnet)
const NETWORK = crucibleConfig.network;
const REQUIRE_AUTH = crucibleConfig.requireAuth;

// API key loaded lazily from secrets module
let cachedApiKey: string | null = null;

/**
 * Get API key for authentication.
 * Uses KMS SecretVault in production, env vars in localnet.
 */
async function getApiKeyValue(): Promise<string | null> {
  if (cachedApiKey !== null) return cachedApiKey || null;

  try {
    const key = await getApiKey(SERVER_ADDRESS);
    cachedApiKey = key ?? "";
    return key;
  } catch {
    cachedApiKey = "";
    return null;
  }
}

// Paths that don't require authentication
const PUBLIC_PATHS = ["/health", "/metrics", "/.well-known"];

// Paths that don't require rate limiting
const RATE_LIMIT_EXEMPT_PATHS = ["/health", "/metrics"];

function getRequiredEnv(key: string, defaultValue?: string): string {
  const value = process.env[key] ?? defaultValue;
  if (!value) {
    throw new Error(`Required environment variable ${key} is not set`);
  }
  return value;
}

function getOptionalAddress(
  key: string,
  defaultValue: `0x${string}`,
): `0x${string}` {
  // This function is used for contract addresses that may come from env
  // For now, we'll keep it but it should be refactored to use config
  const value = process.env[key];
  if (value && /^0x[a-fA-F0-9]{40}$/.test(value)) {
    return value as `0x${string}`;
  }
  return defaultValue;
}

function getNetwork(): "localnet" | "testnet" | "mainnet" {
  const network = getCurrentNetwork();
  if (
    network !== "localnet" &&
    network !== "testnet" &&
    network !== "mainnet"
  ) {
    throw new Error(
      `Invalid NETWORK: ${network}. Must be one of: localnet, testnet, mainnet`,
    );
  }
  return network;
}

// Localnet default addresses - uses env vars or placeholder zeros
const LOCALNET_DEFAULTS = {
  rpcUrl: getRpcUrl("localnet"),
  agentVault:
    getContractSafe("agents", "vault", "localnet") ||
    "0x0000000000000000000000000000000000000000",
  roomRegistry:
    getContractSafe("agents", "roomRegistry", "localnet") ||
    "0x0000000000000000000000000000000000000000",
  triggerRegistry:
    getContractSafe("agents", "triggerRegistry", "localnet") ||
    "0x0000000000000000000000000000000000000000",
  identityRegistry:
    getContractSafe("registry", "identity", "localnet") ||
    "0x0000000000000000000000000000000000000000",
  serviceRegistry:
    getContractSafe("registry", "service", "localnet") ||
    "0x0000000000000000000000000000000000000000",
  computeMarketplace: getServiceUrl("compute", "marketplace", "localnet"),
  storageApi: getServiceUrl("storage", "api", "localnet"),
  ipfsGateway: getServiceUrl("storage", "ipfsGateway", "localnet"),
  indexerGraphql: getServiceUrl("indexer", "graphql", "localnet"),
} as const satisfies {
  rpcUrl: string;
  agentVault: `0x${string}`;
  roomRegistry: `0x${string}`;
  triggerRegistry: `0x${string}`;
  identityRegistry: `0x${string}`;
  serviceRegistry: `0x${string}`;
  computeMarketplace: string;
  storageApi: string;
  ipfsGateway: string;
  indexerGraphql: string;
};

// Agent private key access via secrets module
// NOTE: This address is only used for secret access verification
const SERVER_ADDRESS = "0x0000000000000000000000000000000000000001" as const;

// Lazy-loaded private key cache (only populated on first access)
let cachedAgentPrivateKey: `0x${string}` | null = null;

/**
 * Get the agent private key for on-chain operations.
 * Uses KMS SecretVault in production, env vars in localnet.
 *
 * SECURITY: Private key is accessed via the secrets module which
 * properly gates access based on network (localnet vs production).
 */
async function getAgentPrivateKey(): Promise<`0x${string}` | undefined> {
  if (cachedAgentPrivateKey) return cachedAgentPrivateKey;

  try {
    cachedAgentPrivateKey = await getPrivateKey(SERVER_ADDRESS);
    return cachedAgentPrivateKey ?? undefined;
  } catch (err) {
    log.error("Failed to get agent private key", {
      error: err instanceof Error ? err.message : String(err),
    });
    return undefined;
  }
}

const config: CrucibleConfig = {
  rpcUrl: getRequiredEnv("RPC_URL", LOCALNET_DEFAULTS.rpcUrl),
  kmsKeyId: getRequiredEnv("KMS_KEY_ID", "default"),
  contracts: {
    agentVault: getOptionalAddress(
      "AGENT_VAULT_ADDRESS",
      LOCALNET_DEFAULTS.agentVault,
    ),
    roomRegistry: getOptionalAddress(
      "ROOM_REGISTRY_ADDRESS",
      LOCALNET_DEFAULTS.roomRegistry,
    ),
    triggerRegistry: getOptionalAddress(
      "TRIGGER_REGISTRY_ADDRESS",
      LOCALNET_DEFAULTS.triggerRegistry,
    ),
    identityRegistry: getOptionalAddress(
      "IDENTITY_REGISTRY_ADDRESS",
      LOCALNET_DEFAULTS.identityRegistry,
    ),
    serviceRegistry: getOptionalAddress(
      "SERVICE_REGISTRY_ADDRESS",
      LOCALNET_DEFAULTS.serviceRegistry,
    ),
    autocratTreasury:
      crucibleConfig.autocratTreasuryAddress &&
      isValidAddress(crucibleConfig.autocratTreasuryAddress)
        ? crucibleConfig.autocratTreasuryAddress
        : undefined,
  },
  services: (() => {
    const servicesConfig = getServicesConfig();
    return {
      computeMarketplace:
        crucibleConfig.computeMarketplaceUrl ??
        servicesConfig.compute.marketplace,
      storageApi: servicesConfig.storage.api,
      ipfsGateway: servicesConfig.storage.ipfsGateway,
      indexerGraphql: servicesConfig.indexer.graphql,
      sqlitEndpoint:
        crucibleConfig.sqlitEndpoint ?? servicesConfig.sqlit.blockProducer,
      dexCacheUrl: crucibleConfig.dexCacheUrl,
    };
  })(),
  network: getNetwork(),
};

const chain =
  config.network === "mainnet"
    ? mainnet
    : config.network === "testnet"
      ? sepolia
      : localhost;

const publicClient = createPublicClient({
  chain,
  transport: http(config.rpcUrl),
});

// KMS signer for threshold signing
const kmsSigner = createKMSSigner(config.rpcUrl, chain.id, {
  threshold: NETWORK === "mainnet" ? 3 : 2,
  totalParties: NETWORK === "mainnet" ? 5 : 3,
});

// Initialize KMS signer asynchronously with fallback support for localnet
(async () => {
  // On localnet, load the fallback private key before initializing
  // This enables signing even when KMS service is unavailable
  if (config.network === "localnet") {
    try {
      const fallbackKey = await getAgentPrivateKey();
      if (fallbackKey) {
        kmsSigner.setFallbackPrivateKey(fallbackKey);
        log.info("Fallback private key loaded for localnet");
      }
    } catch (err) {
      log.warn("Could not load fallback private key", {
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  // Now initialize the KMS signer
  kmsSigner
    .initialize()
    .then(() => {
      log.info("KMS signer initialized", {
        address: kmsSigner.getAddress(),
        keyId: kmsSigner.getKeyId(),
      });
    })
    .catch((err) => {
      log.error("Failed to initialize KMS signer", { error: String(err) });
      // Don't throw - server can still serve read-only endpoints
    });
})();

const storage = createStorage({
  apiUrl: config.services.storageApi,
  ipfsGateway: config.services.ipfsGateway,
});

const compute = createCompute({
  marketplaceUrl: config.services.computeMarketplace,
  rpcUrl: config.rpcUrl,
  defaultModel: "llama-3.1-8b",
});

const agentSdk = createAgentSDK({
  crucibleConfig: config,
  storage,
  compute,
  publicClient,
  kmsSigner,
});

const roomSdk = createRoomSDK({
  crucibleConfig: config,
  storage,
  publicClient,
  kmsSigner,
});

// Bot initialization
let botInitializer: BotInitializer | null = null;
let tradingBots: Map<bigint, TradingBot> = new Map();

// Seed default agents on startup
async function seedDefaultAgents(): Promise<void> {
  // Check if DWS is available
  const dwsAvailable = await checkDWSHealth();
  if (!dwsAvailable) {
    log.warn("DWS not available - agent seeding skipped");
    return;
  }

  // Only seed agents if KMS is available (we need to sign transactions)
  if (!kmsSigner.isInitialized()) {
    log.warn("KMS not initialized - agent seeding skipped");
    return;
  }

  // Get default characters to seed
  const coreAgentIds = [
    "project-manager",
    "community-manager",
    "devrel",
    "liaison",
    "moderator",
  ];

  log.info("Seeding default agents", { count: coreAgentIds.length });

  for (const agentId of coreAgentIds) {
    const character = characters[agentId];
    if (!character) {
      log.warn("Character not found", { agentId });
      continue;
    }

    // Initialize runtime for this character
    try {
      const existing = runtimeManager.getRuntime(agentId);
      if (existing) {
        log.debug("Agent runtime already exists", { agentId });
        continue;
      }

      const agentPrivateKey = await getAgentPrivateKey();
      const _runtime = await runtimeManager.createRuntime({
        agentId,
        character,
        privateKey: agentPrivateKey,
        network: config.network,
      });
      log.info("Agent runtime seeded", { agentId, name: character.name });
    } catch (err) {
      log.error("Failed to seed agent runtime", {
        agentId,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  log.info("Agent seeding complete", {
    runtimes: runtimeManager.getAllRuntimes().length,
  });
}

// Initialize bot handler if KMS is configured
if (kmsSigner) {
  botInitializer = new BotInitializer({
    crucibleConfig: config,
    agentSdk,
    publicClient,
    kmsSigner,
    treasuryAddress: config.contracts.autocratTreasury,
  });

  // Seed default agents, then initialize bots
  seedDefaultAgents()
    .then(() => {
      if (crucibleConfig.botsEnabled && botInitializer) {
        return botInitializer.initializeDefaultBots();
      }
      return new Map<bigint, TradingBot>();
    })
    .then((bots) => {
      tradingBots = bots;
      log.info("Default bots initialized", { count: bots.size });
    })
    .catch((err) =>
      log.error("Failed to initialize bots", { error: String(err) }),
    );
}

const app = new Elysia();

// CORS - restrict to configured origins in production
// SECURITY: Wildcard '*' is ONLY honored in localnet to prevent misconfiguration
app.use(
  cors({
    origin: (request) => {
      const origin = request.headers.get("origin");
      // In development (localnet), allow all origins including wildcard
      if (config.network === "localnet") return true;
      // Allow same-origin requests (no origin header) and non-browser requests
      if (!origin) return true;
      // Check against configured origins
      if (ALLOWED_ORIGINS.includes(origin)) return true;
      // Allow any *.jejunetwork.org domain (JNS-resolved apps)
      if (origin.endsWith(".jejunetwork.org")) return true;
      // Log rejected origins for debugging (but don't expose in response)
      log.debug("CORS rejected origin", { origin, allowed: ALLOWED_ORIGINS });
      return false;
    },
    credentials: true,
    allowedHeaders: [
      "Content-Type",
      "Authorization",
      "X-API-Key",
      "X-Jeju-Address",
      "X-Jeju-Timestamp",
      "X-Jeju-Signature",
    ],
    maxAge: 86400,
  }),
);

// Rate limiting middleware with atomic increment pattern
app.onBeforeHandle(
  async ({ request, set }): Promise<{ error: string } | undefined> => {
    const url = new URL(request.url);
    const path = url.pathname;

    // Skip rate limiting for exempt paths
    if (RATE_LIMIT_EXEMPT_PATHS.some((p) => path.startsWith(p))) {
      return undefined;
    }

    // Use IP or wallet address as rate limit key
    // Note: wallet address is not verified here (would be expensive), IP is primary
    const clientIp =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ??
      request.headers.get("x-real-ip") ??
      "unknown";
    const walletAddress = request.headers.get("x-jeju-address") ?? "";
    const key = clientIp || walletAddress || "unknown";

    const now = Date.now();
    const cache = getRateLimitCache();
    const cacheKey = `crucible-rl:${key}`;

    // Get rate limit record from distributed cache
    const cached = await cache.get(cacheKey);
    let record: { count: number; resetAt: number } | null = cached
      ? JSON.parse(cached)
      : null;

    if (!record || record.resetAt < now) {
      // Create new record
      record = { count: 1, resetAt: now + RATE_LIMIT_WINDOW_MS };
    } else {
      // Increment count before checking limit
      record.count++;

      if (record.count > RATE_LIMIT_MAX_REQUESTS) {
        // Store the updated record
        const ttl = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
        await cache.set(cacheKey, JSON.stringify(record), ttl);

        set.headers["X-RateLimit-Limit"] = RATE_LIMIT_MAX_REQUESTS.toString();
        set.headers["X-RateLimit-Remaining"] = "0";
        set.headers["X-RateLimit-Reset"] = Math.ceil(
          record.resetAt / 1000,
        ).toString();
        set.status = 429;
        return { error: "Rate limit exceeded" };
      }
    }

    // Store updated record with TTL
    const ttl = Math.max(1, Math.ceil((record.resetAt - now) / 1000));
    await cache.set(cacheKey, JSON.stringify(record), ttl);

    set.headers["X-RateLimit-Limit"] = RATE_LIMIT_MAX_REQUESTS.toString();
    set.headers["X-RateLimit-Remaining"] = Math.max(
      0,
      RATE_LIMIT_MAX_REQUESTS - record.count,
    ).toString();
    set.headers["X-RateLimit-Reset"] = Math.ceil(
      record.resetAt / 1000,
    ).toString();
    return undefined;
  },
);

// API Key authentication middleware (when enabled)
app.onBeforeHandle(
  async ({ request, set }): Promise<{ error: string } | undefined> => {
    const url = new URL(request.url);
    const path = url.pathname;

    // Skip auth for public paths
    if (PUBLIC_PATHS.some((p) => path.startsWith(p))) {
      return undefined;
    }

    // Skip auth if not required
    if (!REQUIRE_AUTH) {
      return undefined;
    }

    // Get API key from secrets (cached after first load)
    const apiKey = await getApiKeyValue();
    if (!apiKey) {
      // No API key configured - skip auth
      return undefined;
    }

    const providedKey =
      request.headers.get("x-api-key") ??
      request.headers.get("authorization")?.replace("Bearer ", "");

    if (!providedKey || !constantTimeCompare(providedKey, apiKey)) {
      set.status = 401;
      return { error: "Unauthorized" };
    }
    return undefined;
  },
);

// Ban check middleware
app.use(banCheckMiddleware());

// Metrics middleware
app.onBeforeHandle(() => {
  metrics.requests.total++;
});

app.onAfterHandle(({ set }) => {
  const statusNum =
    typeof set.status === "number" ? set.status : Number(set.status) || 200;
  if (statusNum >= 400) metrics.requests.error++;
  else metrics.requests.success++;
});

// Global error handler - prevents stack trace leakage in production
app.onError(({ error, set, request }) => {
  // Log full error for debugging
  const errorObj = error instanceof Error ? error : new Error(String(error));
  const errorLog: Record<string, string> = {
    message: errorObj.message,
    name: errorObj.name,
    path: new URL(request.url).pathname,
    method: request.method,
  };
  if (NETWORK === "localnet" && errorObj.stack) {
    errorLog.stack = errorObj.stack;
  }
  log.error("Unhandled error", errorLog);

  // Return sanitized error to client
  set.status = 500;
  return {
    error: "Internal server error",
    // Only include message in localnet for debugging
    message: NETWORK === "localnet" ? errorObj.message : undefined,
  };
});

// Root endpoint - API info
app.get("/", () => ({
  service: "crucible",
  version: "1.0.0",
  description: "Decentralized agent orchestration platform",
  docs: "/api/v1",
  endpoints: {
    health: "/health",
    info: "/info",
    metrics: "/metrics",
    characters: "/api/v1/characters",
    chat: "/api/v1/chat/:characterId",
    agents: "/api/v1/agents",
    rooms: "/api/v1/rooms",
    execute: "/api/v1/execute",
    bots: "/api/v1/bots",
    autonomous: "/api/v1/autonomous",
  },
}));

// Health & Info
app.get("/health", () => ({
  status: "healthy",
  service: "crucible",
  network: config.network,
  timestamp: new Date().toISOString(),
}));

app.get("/info", async ({ request }) => {
  const dwsAvailable = await checkDWSHealth();

  // Get room count
  let rooms = 0;
  try {
    const roomResult = await roomSdk.searchRooms({ limit: 1 });
    rooms = roomResult.total;
  } catch {
    // Room registry may not be available
  }

  // Check if request is authenticated (has valid API key)
  const providedKey =
    request.headers.get("x-api-key") ??
    request.headers.get("authorization")?.replace("Bearer ", "");
  const apiKey = await getApiKeyValue();
  const isAuthenticated = !!(
    apiKey &&
    providedKey &&
    constantTimeCompare(providedKey, apiKey)
  );

  // Basic info for unauthenticated requests
  const basicInfo = {
    service: "crucible",
    version: "1.0.0",
    network: config.network,
    hasSigner: kmsSigner.isInitialized(),
    dwsAvailable,
    runtimes: runtimeManager.getAllRuntimes().length,
    rooms,
    actionsToday: actionCounter.getTodayCount(),
  };

  // Return full info only for authenticated requests
  if (isAuthenticated) {
    return {
      ...basicInfo,
      contracts: config.contracts,
      services: config.services,
    };
  }

  return basicInfo;
});

// Activity feed endpoint
app.get("/api/v1/activity", ({ query }) => {
  const limit = Math.min(Math.max(1, Number(query.limit) || 10), 50);
  return { events: activityStore.getRecent(limit) };
});

// Agent Chat API - ElizaOS + @jejunetwork/eliza-plugin (60+ actions)

// Chat with an agent
app.post("/api/v1/chat/:characterId", async ({ params, body }) => {
  const characterId = params.characterId;
  const character = getCharacter(characterId);

  if (!character) {
    return { error: `Character not found: ${characterId}` };
  }

  const parsedBody = parseOrThrow(ChatRequestSchema, body, "Chat request");

  // Get or create runtime for this character
  let runtime = runtimeManager.getRuntime(characterId);
  if (!runtime) {
    const agentPrivateKey = await getAgentPrivateKey();
    runtime = await runtimeManager.createRuntime({
      agentId: characterId,
      character,
      privateKey: agentPrivateKey,
      network: config.network,
    });
  }

  const messageText = parsedBody.text ?? parsedBody.message ?? "";
  const message: RuntimeMessage = {
    id: crypto.randomUUID(),
    userId: parsedBody.userId ?? "anonymous",
    roomId: parsedBody.roomId ?? "default",
    content: { text: messageText, source: "api" },
    createdAt: Date.now(),
  };

  const response = await runtime.processMessage(message);
  metrics.agents.executions++;

  return {
    text: response.text,
    action: response.action,
    actions: response.actions,
    character: characterId,
  };
});

// List available characters with runtime status
app.get("/api/v1/chat/characters", () => {
  const characterList = listCharacters().map((id) => {
    const char = getCharacter(id);
    const runtime = runtimeManager.getRuntime(id);
    return {
      id,
      name: char?.name,
      description: char?.description,
      hasRuntime: !!runtime,
    };
  });
  return { characters: characterList };
});

// Initialize all character runtimes
app.post("/api/v1/chat/init", async () => {
  const results: Record<string, { success: boolean; error?: string }> = {};

  const agentPrivateKey = await getAgentPrivateKey();
  for (const [id, character] of Object.entries(characters)) {
    try {
      await runtimeManager.createRuntime({
        agentId: id,
        character,
        privateKey: agentPrivateKey,
        network: config.network,
      });
      results[id] = { success: true };
    } catch (e) {
      results[id] = {
        success: false,
        error: e instanceof Error ? e.message : String(e),
      };
    }
  }

  return {
    initialized: Object.values(results).filter((r) => r.success).length,
    total: Object.keys(characters).length,
    results,
  };
});

// Prometheus Metrics
app.get("/metrics", ({ set }) => {
  const uptimeSeconds = Math.floor((Date.now() - metrics.startTime) / 1000);
  const avgLatency =
    metrics.latency.count > 0 ? metrics.latency.sum / metrics.latency.count : 0;

  // Get autonomous agent metrics
  const autonomousStatus = autonomousRunner?.getStatus();
  const autonomousAgents = autonomousStatus?.agents ?? [];
  const totalTicks = autonomousAgents.reduce((sum, a) => sum + a.tickCount, 0);

  const lines = [
    "# HELP crucible_requests_total Total HTTP requests",
    "# TYPE crucible_requests_total counter",
    `crucible_requests_total{status="success"} ${metrics.requests.success}`,
    `crucible_requests_total{status="error"} ${metrics.requests.error}`,
    "",
    "# HELP crucible_agents_registered_total Total agents registered",
    "# TYPE crucible_agents_registered_total counter",
    `crucible_agents_registered_total ${metrics.agents.registered}`,
    "",
    "# HELP crucible_agent_executions_total Total agent executions",
    "# TYPE crucible_agent_executions_total counter",
    `crucible_agent_executions_total ${metrics.agents.executions}`,
    "",
    "# HELP crucible_rooms_created_total Total rooms created",
    "# TYPE crucible_rooms_created_total counter",
    `crucible_rooms_created_total ${metrics.rooms.created}`,
    "",
    "# HELP crucible_room_messages_total Total room messages",
    "# TYPE crucible_room_messages_total counter",
    `crucible_room_messages_total ${metrics.rooms.messages}`,
    "",
    "# HELP crucible_request_latency_avg_ms Average request latency in milliseconds",
    "# TYPE crucible_request_latency_avg_ms gauge",
    `crucible_request_latency_avg_ms ${avgLatency.toFixed(2)}`,
    "",
    "# HELP crucible_uptime_seconds Server uptime in seconds",
    "# TYPE crucible_uptime_seconds gauge",
    `crucible_uptime_seconds ${uptimeSeconds}`,
    "",
    "# HELP crucible_autonomous_enabled Whether autonomous mode is enabled",
    "# TYPE crucible_autonomous_enabled gauge",
    `crucible_autonomous_enabled ${autonomousRunner ? 1 : 0}`,
    "",
    "# HELP crucible_autonomous_agents_count Number of autonomous agents",
    "# TYPE crucible_autonomous_agents_count gauge",
    `crucible_autonomous_agents_count ${autonomousAgents.length}`,
    "",
    "# HELP crucible_autonomous_ticks_total Total autonomous agent ticks",
    "# TYPE crucible_autonomous_ticks_total counter",
    `crucible_autonomous_ticks_total ${totalTicks}`,
    "",
  ];

  // Add per-agent tick metrics
  for (const agent of autonomousAgents) {
    lines.push(
      `crucible_autonomous_agent_ticks{agent="${agent.id}",character="${agent.character}"} ${agent.tickCount}`,
    );
  }
  if (autonomousAgents.length > 0) {
    lines.push("");
  }

  lines.push(
    "# HELP crucible_info Service info",
    "# TYPE crucible_info gauge",
    `crucible_info{version="1.0.0",network="${config.network}"} 1`,
    "",
  );

  set.headers["Content-Type"] = "text/plain; version=0.0.4; charset=utf-8";
  return lines.join("\n");
});

// Character Templates
app.get("/api/v1/characters", () => {
  const characterList = listCharacters()
    .map((id) => {
      const char = getCharacter(id);
      return char
        ? { id: char.id, name: char.name, description: char.description }
        : null;
    })
    .filter(Boolean);
  return { characters: characterList };
});

app.get("/api/v1/characters/:id", ({ params }) => {
  const id = params.id;
  expect(id, "Character ID is required");
  const character = expect(getCharacter(id), `Character not found: ${id}`);
  return { character };
});

// Agent Management
app.post("/api/v1/agents", async ({ body }) => {
  const parsedBody = parseOrThrow(
    RegisterAgentRequestSchema,
    body,
    "Register agent request",
  );
  // Create minimal AgentCharacter from registration data
  const character: AgentCharacter = {
    id: crypto.randomUUID(),
    name: parsedBody.character?.name ?? parsedBody.name,
    description: parsedBody.character?.description ?? "",
    system: "",
    bio: [],
    messageExamples: [],
    topics: [],
    adjectives: [],
    style: { all: [], chat: [], post: [] },
    capabilities: parsedBody.capabilities,
  };
  log.info("Registering agent", { name: character.name });

  const result = await agentSdk.registerAgent(character, {
    initialFunding: parsedBody.initialFunding
      ? BigInt(parsedBody.initialFunding)
      : undefined,
  });
  metrics.agents.registered++;

  // Track agent creation activity
  activityStore.add({
    type: "agent_created",
    actor: character.name,
    description: `Agent "${character.name}" deployed`,
    metadata: { agentId: result.agentId.toString() },
  });

  return {
    agentId: result.agentId.toString(),
    vaultAddress: result.vaultAddress,
    characterCid: result.characterCid,
    stateCid: result.stateCid,
  };
});

app.get("/api/v1/agents/:agentId", async ({ params }) => {
  const parsedParams = parseOrThrow(
    AgentIdParamSchema,
    params,
    "Agent ID parameter",
  );
  const agentId = BigInt(parsedParams.agentId);
  const agent = await agentSdk.getAgent(agentId);
  const validAgent = expect(agent, `Agent not found: ${parsedParams.agentId}`);

  // Load capabilities from character if available
  let capabilities = validAgent.capabilities;
  if (validAgent.characterCid && !capabilities) {
    try {
      const character = await agentSdk.loadCharacter(agentId);
      capabilities = character.capabilities ?? undefined;
    } catch {
      // Character load failed, continue without capabilities
    }
  }

  return {
    agent: {
      ...validAgent,
      agentId: validAgent.agentId.toString(),
      capabilities,
    },
  };
});

app.get("/api/v1/agents/:agentId/character", async ({ params, set }) => {
  const parsedParams = parseOrThrow(
    AgentIdParamSchema,
    params,
    "Agent ID parameter",
  );
  try {
    const character = await agentSdk.loadCharacter(
      BigInt(parsedParams.agentId),
    );
    return { character };
  } catch (error) {
    set.status = 404;
    return { error: String(error) };
  }
});

app.get("/api/v1/agents/:agentId/state", async ({ params }) => {
  const parsedParams = parseOrThrow(
    AgentIdParamSchema,
    params,
    "Agent ID parameter",
  );
  const state = await agentSdk.loadState(BigInt(parsedParams.agentId));
  return { state };
});

app.get("/api/v1/agents/:agentId/balance", async ({ params }) => {
  const parsedParams = parseOrThrow(
    AgentIdParamSchema,
    params,
    "Agent ID parameter",
  );
  const balance = await agentSdk.getVaultBalance(BigInt(parsedParams.agentId));
  return { balance: balance.toString() };
});

app.post("/api/v1/agents/:agentId/fund", async ({ params, body, set }) => {
  const parsedParams = parseOrThrow(
    AgentIdParamSchema,
    params,
    "Agent ID parameter",
  );
  const parsedBody = parseOrThrow(
    FundAgentRequestSchema,
    body,
    "Fund agent request",
  );
  const agentId = BigInt(parsedParams.agentId);
  try {
    const txHash = await agentSdk.fundVault(agentId, BigInt(parsedBody.amount));
    return { txHash };
  } catch (error) {
    set.status = 400;
    return { error: String(error) };
  }
});

app.post(
  "/api/v1/agents/:agentId/memory",
  async ({ params, body, request, set }) => {
    const parsedParams = parseOrThrow(
      AgentIdParamSchema,
      params,
      "Agent ID parameter",
    );
    const parsedBody = parseOrThrow(
      AddMemoryRequestSchema,
      body,
      "Add memory request",
    );
    const agentId = BigInt(parsedParams.agentId);

    // SECURITY: Verify caller owns this agent before allowing memory injection
    const authResult = await verifyAgentOwnership(
      agentId,
      request,
      agentSdk,
      kmsSigner.isInitialized() ? { address: kmsSigner.getAddress() } : null,
    );
    if (!authResult.authorized) {
      set.status = 403;
      return { error: authResult.reason };
    }

    const memory = await agentSdk.addMemory(agentId, parsedBody.content, {
      importance: parsedBody.importance ?? undefined,
      roomId: parsedBody.roomId ?? undefined,
      userId: parsedBody.userId ?? undefined,
    });
    return { memory };
  },
);

// Room Management

// List/search rooms
app.get("/api/v1/rooms", async ({ query }) => {
  const filters = {
    name: query.name as string | undefined,
    roomType: query.roomType as
      | "collaboration"
      | "adversarial"
      | "debate"
      | "board"
      | undefined,
    active:
      query.active === "true"
        ? true
        : query.active === "false"
          ? false
          : undefined,
    limit: query.limit ? parseInt(query.limit as string, 10) : 20,
    offset: query.offset ? parseInt(query.offset as string, 10) : 0,
  };

  // Fetch on-chain rooms (may fail in localnet if contract not deployed)
  let onchainRooms: Array<{
    roomId: string;
    name: string;
    description: string;
    owner: string;
    stateCid: string;
    members: Array<{ agentId: string; role: string; joinedAt: number }>;
    roomType: string;
    config: { maxMembers: number; turnBased: boolean; turnTimeout?: number; visibility: string };
    active: boolean;
    createdAt: number;
    source: "onchain";
  }> = [];
  let onchainTotal = 0;
  let onchainHasMore = false;

  try {
    const result = await roomSdk.searchRooms(filters);
    onchainRooms = result.items.map((room) => ({
      ...room,
      roomId: room.roomId.toString(),
      members: room.members.map((m) => ({
        ...m,
        agentId: m.agentId.toString(),
      })),
      source: "onchain" as const,
    }));
    onchainTotal = result.total;
    onchainHasMore = result.hasMore;
  } catch (err) {
    log.warn("Failed to fetch on-chain rooms", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Fetch off-chain rooms from SQLite
  let offchainRooms: Array<{
    roomId: string;
    name: string;
    description: string;
    owner: string;
    stateCid: string;
    members: Array<{ agentId: string; role: string; joinedAt: number }>;
    roomType: string;
    config: { maxMembers: number; turnBased: boolean; turnTimeout?: number; visibility: string };
    active: boolean;
    createdAt: number;
    source: "offchain";
  }> = [];

  try {
    const db = getDatabase();
    const dbRooms = await db.listRooms(100);
    offchainRooms = dbRooms.map((r) => ({
      roomId: r.room_id,
      name: r.name,
      description: "",
      owner: "0x0000000000000000000000000000000000000000",
      stateCid: r.state_cid ?? "",
      members: [],
      roomType: r.room_type ?? "collaboration",
      config: { maxMembers: 100, turnBased: false, turnTimeout: 300, visibility: "public" },
      active: true,
      createdAt: r.created_at * 1000,
      source: "offchain" as const,
    }));
  } catch (err) {
    log.warn("Failed to fetch off-chain rooms", {
      error: err instanceof Error ? err.message : String(err),
    });
  }

  // Merge: off-chain first, then on-chain
  const allRooms = [...offchainRooms, ...onchainRooms];

  return {
    rooms: allRooms,
    total: onchainTotal + offchainRooms.length,
    hasMore: onchainHasMore,
  };
});

app.post("/api/v1/rooms", async ({ body }) => {
  const parsedBody = parseOrThrow(
    CreateRoomRequestSchema,
    body,
    "Create room request",
  );
  log.info("Creating room", {
    name: parsedBody.name,
    roomType: parsedBody.roomType,
  });

  const result = await roomSdk.createRoom(
    parsedBody.name,
    parsedBody.description ?? "",
    parsedBody.roomType,
    {
      maxMembers: parsedBody.config?.maxMembers ?? 10,
      turnBased: parsedBody.config?.turnBased ?? false,
      turnTimeout: parsedBody.config?.turnTimeout ?? 300,
      visibility: "public" as const,
    },
  );
  metrics.rooms.created++;

  // Track room creation activity
  activityStore.add({
    type: "room_created",
    actor: "System",
    description: `Room "${parsedBody.name}" created`,
    metadata: {
      roomId: result.roomId.toString(),
      roomType: parsedBody.roomType,
    },
  });

  return { roomId: result.roomId.toString(), stateCid: result.stateCid };
});

app.get("/api/v1/rooms/:roomId", async ({ params }) => {
  const roomId = params.roomId;
  const isNumericId = /^\d+$/.test(roomId);

  if (isNumericId) {
    // On-chain room
    const parsedParams = parseOrThrow(
      RoomIdParamSchema,
      params,
      "Room ID parameter",
    );
    const room = await roomSdk.getRoom(BigInt(parsedParams.roomId));
    const validRoom = expect(room, `Room not found: ${parsedParams.roomId}`);
    return {
      room: {
        ...validRoom,
        roomId: validRoom.roomId.toString(),
        members: validRoom.members.map((m) => ({
          ...m,
          agentId: m.agentId.toString(),
        })),
        source: "onchain",
      },
    };
  }

  // Off-chain room (SQLite)
  const db = getDatabase();
  const dbRoom = await db.getRoom(roomId);
  const validRoom = expect(dbRoom, `Room not found: ${roomId}`);
  return {
    room: {
      roomId: validRoom.room_id,
      name: validRoom.name,
      description: "",
      owner: "0x0000000000000000000000000000000000000000",
      stateCid: validRoom.state_cid ?? "",
      members: [],
      roomType: validRoom.room_type ?? "collaboration",
      config: {
        maxMembers: 100,
        turnBased: false,
        turnTimeout: 300,
        visibility: "public",
      },
      active: true,
      createdAt: validRoom.created_at * 1000,
      source: "offchain",
    },
  };
});

app.post("/api/v1/rooms/:roomId/join", async ({ params, body }) => {
  const parsedParams = parseOrThrow(
    RoomIdParamSchema,
    params,
    "Room ID parameter",
  );
  const parsedBody = parseOrThrow(
    JoinRoomRequestSchema,
    body,
    "Join room request",
  );
  await roomSdk.joinRoom(
    BigInt(parsedParams.roomId),
    BigInt(parsedBody.agentId),
    parsedBody.role,
  );
  return { success: true };
});

app.post("/api/v1/rooms/:roomId/leave", async ({ params, body }) => {
  const parsedParams = parseOrThrow(
    RoomIdParamSchema,
    params,
    "Room ID parameter",
  );
  const parsedBody = parseOrThrow(
    LeaveRoomRequestSchema,
    body,
    "Leave room request",
  );
  await roomSdk.leaveRoom(
    BigInt(parsedParams.roomId),
    BigInt(parsedBody.agentId),
  );
  return { success: true };
});

app.post("/api/v1/rooms/:roomId/message", async ({ params, body }) => {
  const parsedParams = parseOrThrow(
    RoomIdParamSchema,
    params,
    "Room ID parameter",
  );
  const parsedBody = parseOrThrow(
    PostMessageRequestSchema,
    body,
    "Post message request",
  );
  const message = await roomSdk.postMessage(
    BigInt(parsedParams.roomId),
    parsedBody.agentId,
    parsedBody.content,
    parsedBody.action ?? undefined,
  );
  metrics.rooms.messages++;

  // Track message activity
  activityStore.add({
    type: "message_sent",
    actor: `Agent ${parsedBody.agentId}`,
    description: `Message in room ${parsedParams.roomId}`,
    metadata: { roomId: parsedParams.roomId, agentId: parsedBody.agentId },
  });

  return { message };
});

app.get("/api/v1/rooms/:roomId/messages", async ({ params, query, set }) => {
  const roomId = params.roomId;
  const isNumericId = /^\d+$/.test(roomId);
  const limitStr = query.limit;
  const limit = limitStr
    ? parseOrThrow(
        z.number().int().min(1).max(1000),
        parseInt(limitStr, 10),
        "Limit query parameter",
      )
    : 50;

  if (isNumericId) {
    // On-chain room
    try {
      const messages = await roomSdk.getMessages(BigInt(roomId), limit);
      return { messages };
    } catch (error) {
      set.status = 404;
      return { error: String(error) };
    }
  }

  // Off-chain room (SQLite)
  try {
    const db = getDatabase();
    const dbMessages = await db.getMessages(roomId, { limit });
    // Reverse to get oldest-first (chat order)
    const messages = dbMessages
      .map((m) => ({
        id: m.id,
        agentId: m.agent_id,
        content: m.content,
        action: m.action,
        timestamp: m.created_at * 1000,
      }))
      .reverse();
    return { messages };
  } catch (error) {
    set.status = 404;
    return { error: String(error) };
  }
});

app.post("/api/v1/rooms/:roomId/phase", async ({ params, body }) => {
  const parsedParams = parseOrThrow(
    RoomIdParamSchema,
    params,
    "Room ID parameter",
  );
  const parsedBody = parseOrThrow(
    SetPhaseRequestSchema,
    body,
    "Set phase request",
  );
  await roomSdk.setPhase(BigInt(parsedParams.roomId), parsedBody.phase);
  return { success: true };
});

// Execution
app.post("/api/v1/execute", async ({ body }) => {
  if (!kmsSigner.isInitialized()) {
    throw new Error("Executor not configured - KMS signer not initialized");
  }

  const parsedBody = parseOrThrow(
    ExecuteRequestSchema,
    body,
    "Execute request",
  );

  log.info("Executing agent", { agentId: parsedBody.agentId });

  const executorAddress = kmsSigner.getAddress();

  const executorSdk = createExecutorSDK({
    crucibleConfig: config,
    storage,
    compute,
    agentSdk,
    roomSdk,
    publicClient,
    kmsSigner,
    executorAddress,
  });

  const agentId = expect(
    parsedBody.agentId,
    "Agent ID is required for execution",
  );
  const inputContext: JsonObject | null = parsedBody.input.context ?? null;
  const request: ExecutionRequest = {
    agentId: BigInt(agentId),
    triggerId: parsedBody.triggerId ?? undefined,
    input: {
      message: parsedBody.input.message ?? null,
      roomId: parsedBody.input.roomId ?? null,
      userId: parsedBody.input.userId ?? null,
      context: inputContext,
    },
    options: parsedBody.options
      ? {
          ...parsedBody.options,
          maxCost: parsedBody.options.maxCost
            ? BigInt(parsedBody.options.maxCost)
            : undefined,
        }
      : undefined,
  };

  const result = await executorSdk.execute(request);
  metrics.agents.executions++;

  // Track action execution activity
  const actions = result.output?.actions ?? [];
  for (const action of actions) {
    actionCounter.increment();
    activityStore.add({
      type: "action_executed",
      actor: `Agent ${parsedBody.agentId}`,
      description: `${action.type}: ${action.success ? "success" : "failed"}`,
      metadata: {
        agentId: parsedBody.agentId,
        actionType: action.type,
        success: action.success ? 1 : 0,
      },
    });
  }

  return {
    result: {
      ...result,
      agentId: result.agentId.toString(),
      cost: {
        ...result.cost,
        total: result.cost.total.toString(),
        inference: result.cost.inference.toString(),
        storage: result.cost.storage.toString(),
        executionFee: result.cost.executionFee.toString(),
      },
    },
  };
});

// Bot Management
app.get("/api/v1/bots", () => {
  const bots = Array.from(tradingBots.entries()).map(([agentId, bot]) => ({
    agentId: agentId.toString(),
    metrics: bot.getMetrics(),
    healthy: bot.isHealthy(),
  }));
  return { bots };
});

app.get("/api/v1/bots/:botId/metrics", ({ params }) => {
  const parsedParams = parseOrThrow(
    BotIdParamSchema,
    params,
    "Bot ID parameter",
  );
  const agentId = BigInt(parsedParams.botId);
  const bot = expect(
    tradingBots.get(agentId),
    `Bot not found: ${parsedParams.botId}`,
  );
  return { metrics: bot.getMetrics() };
});

app.post("/api/v1/bots/:botId/stop", async ({ params, request, set }) => {
  const parsedParams = parseOrThrow(
    BotIdParamSchema,
    params,
    "Bot ID parameter",
  );
  const agentId = BigInt(parsedParams.botId);

  // SECURITY: Verify caller owns this bot's agent
  const authResult = await verifyAgentOwnership(
    agentId,
    request,
    agentSdk,
    kmsSigner.isInitialized() ? { address: kmsSigner.getAddress() } : null,
  );
  if (!authResult.authorized) {
    set.status = 403;
    return { error: authResult.reason };
  }

  const bot = expect(
    tradingBots.get(agentId),
    `Bot not found: ${parsedParams.botId}`,
  );
  await bot.stop();
  tradingBots.delete(agentId);
  return { success: true };
});

app.post("/api/v1/bots/:botId/start", async ({ params, request, set }) => {
  const parsedParams = parseOrThrow(
    BotIdParamSchema,
    params,
    "Bot ID parameter",
  );
  const agentId = BigInt(parsedParams.botId);

  // SECURITY: Verify caller owns this bot's agent
  const authResult = await verifyAgentOwnership(
    agentId,
    request,
    agentSdk,
    kmsSigner.isInitialized() ? { address: kmsSigner.getAddress() } : null,
  );
  if (!authResult.authorized) {
    set.status = 403;
    return { error: authResult.reason };
  }

  const bot = expect(
    tradingBots.get(agentId),
    `Bot not found: ${parsedParams.botId}`,
  );
  await bot.start();
  return { success: true };
});

// Autonomous Agents API

import { type AutonomousAgentRunner, createAgentRunner } from "./autonomous";

// Global autonomous runner (started if AUTONOMOUS_ENABLED=true)
export let autonomousRunner: AutonomousAgentRunner | null = null;

if (crucibleConfig.autonomousEnabled) {
  // Initialize autonomous runner with async private key loading
  getAgentPrivateKey()
    .then((agentPrivateKey) => {
      autonomousRunner = createAgentRunner({
        enableBuiltinCharacters: crucibleConfig.enableBuiltinCharacters,
        defaultTickIntervalMs: crucibleConfig.defaultTickIntervalMs,
        maxConcurrentAgents: crucibleConfig.maxConcurrentAgents,
        privateKey: agentPrivateKey,
        network: config.network,
        enableTrajectoryRecording: true,
      });
      autonomousRunner
        .start()
        .then(async () => {
          log.info("Autonomous agent runner started");

          // Room configuration for agent coordination - derived from AUTONOMOUS_AGENTS config
          const COORDINATION_ROOMS = [
            { id: "base-contract-reviews", name: "Base Contract Reviews" },
            { id: "infra-monitoring", name: "Infrastructure Monitoring" },
            { id: "endpoint-monitoring", name: "Endpoint Monitoring" },
          ];

          // Ensure coordination rooms exist for agent communication
          try {
            const { getDatabase } = await import("./sdk/database");
            const db = getDatabase();
            for (const room of COORDINATION_ROOMS) {
              const existingRoom = await db.getRoom(room.id);
              if (!existingRoom) {
                await db.createRoom({
                  roomId: room.id,
                  name: room.name,
                  roomType: "collaboration",
                });
                log.info("Created coordination room", { roomId: room.id });
              }
            }
          } catch (err) {
            log.warn("Failed to create coordination rooms", {
              error: err instanceof Error ? err.message : String(err),
            });
          }

          // Register agents from AUTONOMOUS_AGENTS config (single source of truth)
          for (const [characterId, overrides] of Object.entries(
            AUTONOMOUS_AGENTS,
          )) {
            const character = getCharacter(characterId);
            if (!character) {
              log.warn("[autonomous] Character not found", { characterId });
              continue;
            }

            try {
              await autonomousRunner?.registerAgent({
                ...DEFAULT_AUTONOMOUS_CONFIG,
                agentId: `autonomous-${characterId}`,
                character,
                ...overrides,
                capabilities: {
                  ...DEFAULT_AUTONOMOUS_CONFIG.capabilities,
                  ...overrides.capabilities,
                },
              });
              log.info("Auto-registered autonomous agent", {
                agentId: characterId,
              });
            } catch (err) {
              log.warn("Failed to auto-register agent", {
                agentId: characterId,
                error: err instanceof Error ? err.message : String(err),
              });
            }
          }
        })
        .catch((err) => {
          log.error("Failed to start autonomous runner", {
            error: String(err),
          });
        });
    })
    .catch((err) => {
      log.error("Failed to get private key for autonomous runner", {
        error: String(err),
      });
    });
}

// Get autonomous runner status
app.get("/api/v1/autonomous/status", () => {
  if (!autonomousRunner) {
    return {
      enabled: false,
      message:
        "Autonomous mode not enabled. Set AUTONOMOUS_ENABLED=true to enable.",
    };
  }
  return {
    enabled: true,
    ...autonomousRunner.getStatus(),
  };
});

// Get detailed autonomous agent activity
app.get("/api/v1/autonomous/activity", () => {
  if (!autonomousRunner) {
    return {
      enabled: false,
      agents: [],
      summary: {
        totalAgents: 0,
        totalTicks: 0,
        totalErrors: 0,
        uptime: 0,
      },
    };
  }

  const status = autonomousRunner.getStatus();
  const uptimeMs = Date.now() - metrics.startTime;

  return {
    enabled: true,
    summary: {
      totalAgents: status.agentCount,
      totalTicks: status.agents.reduce((sum, a) => sum + a.tickCount, 0),
      avgTicksPerAgent:
        status.agentCount > 0
          ? status.agents.reduce((sum, a) => sum + a.tickCount, 0) /
            status.agentCount
          : 0,
      uptimeMs,
      uptimeHours: Math.round((uptimeMs / (1000 * 60 * 60)) * 100) / 100,
    },
    agents: status.agents.map((agent) => ({
      ...agent,
      lastTickAgo: agent.lastTick > 0 ? Date.now() - agent.lastTick : null,
      tickRate:
        agent.lastTick > 0 && uptimeMs > 0
          ? Math.round((agent.tickCount / (uptimeMs / 1000 / 60)) * 100) / 100 // ticks per minute
          : 0,
    })),
    network: config.network,
    actionsToday: actionCounter.getTodayCount(),
  };
});

// Start autonomous runner (if not already running)
app.post("/api/v1/autonomous/start", async () => {
  if (!autonomousRunner) {
    const agentPrivateKey = await getAgentPrivateKey();
    autonomousRunner = createAgentRunner({
      privateKey: agentPrivateKey,
      network: config.network,
    });
  }
  await autonomousRunner.start();
  return { success: true, status: autonomousRunner.getStatus() };
});

// Stop autonomous runner
app.post("/api/v1/autonomous/stop", async ({ set }) => {
  if (!autonomousRunner) {
    set.status = 400;
    return { success: false, message: "Runner not started" };
  }
  await autonomousRunner.stop();
  return { success: true };
});

// Register an agent for autonomous mode
app.post("/api/v1/autonomous/agents", async ({ body, set }) => {
  if (!autonomousRunner) {
    set.status = 400;
    return { error: "Autonomous runner not started" };
  }

  const parsedBody = parseOrThrow(
    AgentStartRequestSchema,
    body,
    "Agent start request",
  );

  const characterId = parsedBody.characterId ?? parsedBody.characterCid;
  if (!characterId) {
    set.status = 400;
    return { error: "characterId or characterCid is required" };
  }

  const character = getCharacter(characterId);
  if (!character) {
    set.status = 404;
    return { error: `Character not found: ${characterId}` };
  }

  // Get overrides from AUTONOMOUS_AGENTS config (includes executionMode, codeFirstConfig, etc.)
  const overrides = AUTONOMOUS_AGENTS[characterId] ?? {};

  await autonomousRunner.registerAgent({
    ...DEFAULT_AUTONOMOUS_CONFIG,
    agentId: `autonomous-${characterId}`,
    character,
    ...overrides,
    tickIntervalMs:
      parsedBody.tickIntervalMs ?? overrides.tickIntervalMs ?? DEFAULT_AUTONOMOUS_CONFIG.tickIntervalMs,
    capabilities: {
      ...DEFAULT_AUTONOMOUS_CONFIG.capabilities,
      ...overrides.capabilities,
      ...parsedBody.capabilities,
    },
  });

  return { success: true, agentId: `autonomous-${characterId}` };
});

// Remove an agent from autonomous mode
app.delete("/api/v1/autonomous/agents/:agentId", ({ params, set }) => {
  if (!autonomousRunner) {
    set.status = 400;
    return { error: "Autonomous runner not started" };
  }
  const agentId = params.agentId;
  autonomousRunner.unregisterAgent(agentId);
  return { success: true };
});

// Cron routes (for DWS scheduled triggers)
app.use(cronRoutes);

// Search
app.get("/api/v1/search/agents", async ({ query, set }) => {
  try {
    const parsedQuery = AgentSearchQuerySchema.parse(query);
    const ownerAddress =
      parsedQuery.owner && isValidAddress(parsedQuery.owner)
        ? parsedQuery.owner
        : undefined;
    const result = await agentSdk.searchAgents({
      name: parsedQuery.name ?? undefined,
      owner: ownerAddress,
      active: parsedQuery.active,
      limit: parsedQuery.limit ?? 20,
    });
    return {
      agents: result.items.map((a) => ({
        ...a,
        agentId: a.agentId.toString(),
      })),
      total: result.total,
      hasMore: result.hasMore,
    };
  } catch (error) {
    set.status = 400;
    return { error: String(error) };
  }
});

const port = crucibleConfig.apiPort;
if (Number.isNaN(port) || port <= 0 || port > 65535) {
  throw new Error(`Invalid PORT: ${port}. Must be a valid port number`);
}

// Mask signer address in logs (show first 6 and last 4 chars)
const signerAddr = kmsSigner.isInitialized() ? kmsSigner.getAddress() : null;
const maskedSigner = signerAddr
  ? `${signerAddr.slice(0, 6)}...${signerAddr.slice(-4)}`
  : "not initialized";
log.info("Starting server", {
  port,
  network: config.network,
  signer: maskedSigner,
});

// Initialize config from environment variables at startup
// NOTE: Secrets (apiKey, cronSecret, privateKey) are NOT stored in config
// They are accessed on-demand through the secrets module
configureCrucible({
  network: getCurrentNetwork(),
  apiPort: getEnvNumber("API_PORT"),
  requireAuth: getEnvVar("REQUIRE_AUTH") === "true",
  rateLimitMaxRequests: getEnvNumber("RATE_LIMIT_MAX_REQUESTS"),
  corsAllowedOrigins: getEnvVar("CORS_ALLOWED_ORIGINS"),
  autocratTreasuryAddress: getEnvVar("AUTOCRAT_TREASURY_ADDRESS"),
  computeMarketplaceUrl: getEnvVar("COMPUTE_MARKETPLACE_URL"),
  sqlitEndpoint: getEnvVar("SQLIT_ENDPOINT"),
  dexCacheUrl: getEnvVar("DEX_CACHE_URL"),
  botsEnabled: getEnvVar("BOTS_ENABLED") !== "false",
  autonomousEnabled: getEnvVar("AUTONOMOUS_ENABLED") === "true",
  enableBuiltinCharacters: getEnvVar("ENABLE_BUILTIN_CHARACTERS") !== "false",
  defaultTickIntervalMs: getEnvNumber("TICK_INTERVAL_MS"),
  maxConcurrentAgents: getEnvNumber("MAX_CONCURRENT_AGENTS"),
  farcasterHubUrl: getEnvVar("FARCASTER_HUB_URL"),
  dwsUrl: getEnvVar("DWS_URL"),
  ipfsGateway: getEnvVar("IPFS_GATEWAY"),
  banManagerAddress: getEnvVar("MODERATION_BAN_MANAGER"),
  moderationMarketplaceAddress: getEnvVar("MODERATION_MARKETPLACE_ADDRESS"),
});

// Start server - set port on the app object so Bun's auto-serve uses the right port
// Don't call app.listen() directly as Bun will auto-serve the exported default
const server = app.listen(port);

// Export for testing, but don't export as default to avoid Bun auto-serve conflict
export { app, server };
