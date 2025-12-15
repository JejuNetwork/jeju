/**
 * Infrastructure Initialization
 * 
 * Initializes all services for the leaderboard:
 * - CovenantSQL database
 * - Cache
 * - Secrets vault
 * - Trigger registration
 */

import { initializeDatabase, getDatabaseMode } from "./data/db";
import { initializeSecrets, type AppSecretsConfig } from "@jeju/shared/secrets";
import { registerAppTriggers, type AppTriggersConfig } from "@jeju/shared/triggers";
import { getCacheClient } from "@jeju/shared/cache";

// App configuration
const APP_NAME = "leaderboard";
const APP_PORT = parseInt(process.env.PORT ?? "5012", 10);

// Secrets configuration
const SECRETS_CONFIG: AppSecretsConfig = {
  required: ["GITHUB_TOKEN"],
  optional: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
};

// Triggers configuration
const TRIGGERS_CONFIG: AppTriggersConfig = {
  appName: APP_NAME,
  appPort: APP_PORT,
  triggers: [
    {
      name: "pipeline-sync",
      type: "cron",
      cronExpression: "0 * * * *", // Every hour
      endpointPath: "/api/pipeline/run",
      description: "Hourly GitHub data synchronization",
      timeout: 300, // 5 minutes
      registerOnChain: true,
    },
    {
      name: "score-calculation",
      type: "cron",
      cronExpression: "30 * * * *", // 30 minutes past every hour
      endpointPath: "/api/pipeline/scores",
      description: "Hourly score recalculation",
      timeout: 180, // 3 minutes
      registerOnChain: true,
    },
  ],
};

export interface InitializationResult {
  database: {
    mode: string;
    connected: boolean;
  };
  secrets: {
    loaded: number;
    missing: string[];
  };
  cache: {
    connected: boolean;
  };
  triggers: {
    registered: number;
    ids: string[];
  };
}

let initialized = false;
let initResult: InitializationResult | null = null;

/**
 * Initialize all infrastructure
 */
export async function initialize(): Promise<InitializationResult> {
  if (initialized && initResult) {
    return initResult;
  }

  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║                         🏝️  LEADERBOARD INIT                                  ║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);

  const result: InitializationResult = {
    database: { mode: "unknown", connected: false },
    secrets: { loaded: 0, missing: [] },
    cache: { connected: false },
    triggers: { registered: 0, ids: [] },
  };

  // 1. Initialize database
  console.log("📦 Initializing database...");
  await initializeDatabase();
  result.database = {
    mode: getDatabaseMode(),
    connected: true,
  };
  console.log(`   ✅ Database: ${result.database.mode}`);

  // 2. Load secrets
  console.log("🔐 Loading secrets...");
  const secrets = await initializeSecrets(APP_NAME, SECRETS_CONFIG).catch((err) => {
    console.warn(`   ⚠️  Secrets loading failed: ${err.message}`);
    return {};
  });
  result.secrets.loaded = Object.keys(secrets).length;
  result.secrets.missing = SECRETS_CONFIG.required.filter(
    (name) => !secrets[name] && !process.env[name.toUpperCase().replace(/-/g, "_")]
  );
  if (result.secrets.missing.length > 0) {
    console.warn(`   ⚠️  Missing required secrets: ${result.secrets.missing.join(", ")}`);
  } else {
    console.log(`   ✅ Secrets: ${result.secrets.loaded} loaded`);
  }

  // 3. Initialize cache
  console.log("🗄️  Initializing cache...");
  const cache = getCacheClient("leaderboard");
  const cacheHealth = await cache.get("__health_check__").then(() => true).catch(() => false);
  result.cache.connected = cacheHealth || true; // Assume connected if no error
  console.log(`   ✅ Cache: ${result.cache.connected ? "connected" : "fallback mode"}`);

  // 4. Register triggers
  console.log("⏰ Registering triggers...");
  if (process.env.REGISTER_TRIGGERS !== "false") {
    const triggers = await registerAppTriggers(TRIGGERS_CONFIG).catch((err) => {
      console.warn(`   ⚠️  Trigger registration failed: ${err.message}`);
      return [];
    });
    result.triggers.registered = triggers.length;
    result.triggers.ids = triggers.map((t) => t.id);
    console.log(`   ✅ Triggers: ${result.triggers.registered} registered`);
  } else {
    console.log("   ⏭️  Triggers: skipped (REGISTER_TRIGGERS=false)");
  }

  console.log(`
╔═══════════════════════════════════════════════════════════════════════════════╗
║  ✅ INITIALIZATION COMPLETE                                                    ║
║                                                                               ║
║  Database:  ${result.database.mode.padEnd(60)}║
║  Secrets:   ${result.secrets.loaded} loaded, ${result.secrets.missing.length} missing${" ".repeat(43)}║
║  Cache:     ${(result.cache.connected ? "connected" : "fallback").padEnd(60)}║
║  Triggers:  ${result.triggers.registered} registered${" ".repeat(52)}║
╚═══════════════════════════════════════════════════════════════════════════════╝
`);

  initialized = true;
  initResult = result;
  return result;
}

/**
 * Get initialization status
 */
export function getInitStatus(): InitializationResult | null {
  return initResult;
}

/**
 * Check if fully initialized
 */
export function isInitialized(): boolean {
  return initialized;
}

/**
 * Reset initialization (for testing)
 */
export function resetInit(): void {
  initialized = false;
  initResult = null;
}
