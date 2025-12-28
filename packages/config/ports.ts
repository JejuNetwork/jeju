/**
 * @fileoverview Centralized Port Allocation for the network
 * @module config/ports
 *
 * Port Ranges (guidelines, not strict):
 * - 3100-3199: Storage services (IPFS)
 * - 4000-4399: Core app frontends/APIs
 * - 4350-4399: Indexer services
 * - 5000-5599: Vendor app frontends/APIs
 * - 8545-9999: Infrastructure (RPC, metrics, Kurtosis)
 * - 23798: Indexer database (PostgreSQL)
 *
 * Environment Variable Naming Convention:
 * - Core apps: {APP_NAME}_{SERVICE}_PORT (e.g., NODE_EXPLORER_API_PORT)
 * - Core apps URLs: {APP_NAME}_{SERVICE}_URL (e.g., NODE_EXPLORER_API_URL)
 * - Vendor apps: VENDOR_{APP_NAME}_{SERVICE}_PORT
 * - Vendor apps URLs: VENDOR_{APP_NAME}_{SERVICE}_URL
 *
 * This ensures:
 * - No collisions between apps and vendors
 * - Easy to override any port via environment
 * - Clear naming convention
 */

/**
 * Safely parse a port number from environment variable
 * Returns the default if the env var is not set, empty, or invalid
 * @param envValue - The environment variable value to parse
 * @param defaultPort - The default port to use if parsing fails
 */
function safeParsePort(
  envValue: string | undefined,
  defaultPort: number,
): number {
  if (!envValue) return defaultPort
  const parsed = parseInt(envValue, 10)
  // Check for NaN or invalid port numbers
  if (Number.isNaN(parsed) || parsed < 0 || parsed > 65535) {
    return defaultPort
  }
  return parsed
}

// Core Apps (4000-4999 range)

export const CORE_PORTS = {
  /** Block Explorer - Blockchain explorer UI */
  EXPLORER: {
    DEFAULT: 4000,
    ENV_VAR: 'EXPLORER_PORT',
    get: () => safeParsePort(process.env.EXPLORER_PORT, 4000),
  },

  /** Gateway - Bridge tokens, deploy paymasters, earn LP rewards */
  GATEWAY: {
    DEFAULT: 4013,
    ENV_VAR: 'GATEWAY_PORT',
    get: () =>
      safeParsePort(
        process.env.GATEWAY_PORT ?? process.env.PAYMASTER_DASHBOARD_PORT,
        4013,
      ),
  },

  /** Node Explorer API - Node operator tracking backend */
  NODE_EXPLORER_API: {
    DEFAULT: 4002,
    ENV_VAR: 'NODE_EXPLORER_API_PORT',
    get: () => safeParsePort(process.env.NODE_EXPLORER_API_PORT, 4002),
  },

  /** Node Explorer UI - Node operator dashboard frontend */
  NODE_EXPLORER_UI: {
    DEFAULT: 4003,
    ENV_VAR: 'NODE_EXPLORER_UI_PORT',
    get: () => safeParsePort(process.env.NODE_EXPLORER_UI_PORT, 4003),
  },

  /** Documentation - VitePress docs site */
  DOCUMENTATION: {
    DEFAULT: 4004,
    ENV_VAR: 'DOCUMENTATION_PORT',
    get: () => safeParsePort(process.env.DOCUMENTATION_PORT, 4004),
  },

  /** Documentation A2A - Agent-to-Agent protocol for docs search */
  DOCUMENTATION_A2A: {
    DEFAULT: 7778,
    ENV_VAR: 'DOCUMENTATION_A2A_PORT',
    get: () => safeParsePort(process.env.DOCUMENTATION_A2A_PORT, 7778),
  },

  /** Bazaar - DeFi + NFT Marketplace + Prediction Markets */
  BAZAAR: {
    DEFAULT: 4006,
    ENV_VAR: 'BAZAAR_PORT',
    get: () => safeParsePort(process.env.BAZAAR_PORT, 4006),
  },

  /** Bazaar API - Bazaar backend API server */
  BAZAAR_API: {
    DEFAULT: 4007,
    ENV_VAR: 'BAZAAR_API_PORT',
    get: () => safeParsePort(process.env.BAZAAR_API_PORT, 4007),
  },

  /** Compute Marketplace - Decentralized AI inference marketplace */
  COMPUTE: {
    DEFAULT: 4015,
    ENV_VAR: 'COMPUTE_PORT',
    get: () => safeParsePort(process.env.COMPUTE_PORT, 4015),
  },

  /** Compute Node API - Provider node endpoint */
  COMPUTE_NODE_API: {
    DEFAULT: 4008,
    ENV_VAR: 'COMPUTE_NODE_API_PORT',
    get: () => safeParsePort(process.env.COMPUTE_NODE_API_PORT, 4008),
  },

  /** IPFS Storage Service - Decentralized file storage with x402 payments */
  IPFS: {
    DEFAULT: 3100,
    ENV_VAR: 'IPFS_PORT',
    get: () => safeParsePort(process.env.IPFS_PORT, 3100),
  },

  /** IPFS Node (Kubo) - IPFS daemon API */
  IPFS_NODE: {
    DEFAULT: 4100,
    ENV_VAR: 'IPFS_NODE_PORT',
    get: () => safeParsePort(process.env.IPFS_NODE_PORT, 4100),
  },

  /** IPFS API - Standard Kubo HTTP API (port 5001) for local development */
  IPFS_API: {
    DEFAULT: 5001,
    ENV_VAR: 'IPFS_API_PORT',
    get: () => safeParsePort(process.env.IPFS_API_PORT, 5001),
  },

  /** Indexer GraphQL - Subsquid data indexing */
  INDEXER_GRAPHQL: {
    DEFAULT: 4350,
    ENV_VAR: 'INDEXER_GRAPHQL_PORT',
    get: () => safeParsePort(process.env.INDEXER_GRAPHQL_PORT, 4350),
  },

  /** Indexer A2A - Agent-to-Agent protocol endpoint */
  INDEXER_A2A: {
    DEFAULT: 4351,
    ENV_VAR: 'INDEXER_A2A_PORT',
    get: () => safeParsePort(process.env.INDEXER_A2A_PORT, 4351),
  },

  /** Indexer REST - REST API endpoint */
  INDEXER_REST: {
    DEFAULT: 4352,
    ENV_VAR: 'INDEXER_REST_PORT',
    get: () => safeParsePort(process.env.INDEXER_REST_PORT, 4352),
  },

  /** Indexer MCP - Model Context Protocol endpoint */
  INDEXER_MCP: {
    DEFAULT: 4353,
    ENV_VAR: 'INDEXER_MCP_PORT',
    get: () => safeParsePort(process.env.INDEXER_MCP_PORT, 4353),
  },

  /** Indexer Database - PostgreSQL */
  INDEXER_DATABASE: {
    DEFAULT: 23798,
    ENV_VAR: 'INDEXER_DB_PORT',
    get: () => safeParsePort(process.env.INDEXER_DB_PORT, 23798),
  },

  /** x402 Facilitator - Payment verification and settlement service */
  FACILITATOR: {
    DEFAULT: 3402,
    ENV_VAR: 'FACILITATOR_PORT',
    get: () => safeParsePort(process.env.FACILITATOR_PORT, 3402),
  },

  /** Factory - Agent and app factory platform */
  FACTORY: {
    DEFAULT: 4009,
    ENV_VAR: 'FACTORY_PORT',
    get: () => safeParsePort(process.env.FACTORY_PORT, 4009),
  },

  /** OIF Aggregator - Open Intents Framework aggregator */
  OIF_AGGREGATOR: {
    DEFAULT: 4011,
    ENV_VAR: 'OIF_AGGREGATOR_PORT',
    get: () => safeParsePort(process.env.OIF_AGGREGATOR_PORT, 4011),
  },

  /** RPC Gateway - Load-balanced RPC endpoint */
  RPC_GATEWAY: {
    DEFAULT: 4012,
    ENV_VAR: 'RPC_GATEWAY_PORT',
    get: () => safeParsePort(process.env.RPC_GATEWAY_PORT, 4012),
  },

  /** Crucible API - Bot execution and strategy platform */
  CRUCIBLE_API: {
    DEFAULT: 4020,
    ENV_VAR: 'CRUCIBLE_PORT',
    get: () => safeParsePort(process.env.CRUCIBLE_PORT, 4020),
  },

  /** Crucible Executor - Bot execution worker */
  CRUCIBLE_EXECUTOR: {
    DEFAULT: 4021,
    ENV_VAR: 'CRUCIBLE_EXECUTOR_PORT',
    get: () => safeParsePort(process.env.CRUCIBLE_EXECUTOR_PORT, 4021),
  },

  /** Crucible Bots API - Bot REST/A2A/MCP endpoints */
  CRUCIBLE_BOTS: {
    DEFAULT: 4022,
    ENV_VAR: 'CRUCIBLE_BOTS_PORT',
    get: () => safeParsePort(process.env.CRUCIBLE_BOTS_PORT, 4022),
  },

  /** DWS API - Decentralized Web Services main API */
  DWS_API: {
    DEFAULT: 4030,
    ENV_VAR: 'DWS_PORT',
    get: () => safeParsePort(process.env.DWS_PORT, 4030),
  },

  /** DWS Inference - Local inference server */
  DWS_INFERENCE: {
    DEFAULT: 4031,
    ENV_VAR: 'INFERENCE_PORT',
    get: () => safeParsePort(process.env.INFERENCE_PORT, 4031),
  },

  /** DWS Gateway - CDN and edge gateway */
  DWS_GATEWAY: {
    DEFAULT: 4032,
    ENV_VAR: 'DWS_GATEWAY_PORT',
    get: () => safeParsePort(process.env.DWS_GATEWAY_PORT, 4032),
  },

  /** DWS Triggers - Compute trigger service */
  DWS_TRIGGERS: {
    DEFAULT: 4016,
    ENV_VAR: 'TRIGGER_PORT',
    get: () => safeParsePort(process.env.TRIGGER_PORT, 4016),
  },

  /** Autocrat API - DAO governance API */
  AUTOCRAT_API: {
    DEFAULT: 4040,
    ENV_VAR: 'AUTOCRAT_PORT',
    get: () => safeParsePort(process.env.AUTOCRAT_PORT, 4040),
  },

  /** Autocrat CEO - CEO agent server */
  AUTOCRAT_AGENT: {
    DEFAULT: 4041,
    ENV_VAR: 'AUTOCRAT_AGENT_PORT',
    get: () => safeParsePort(process.env.AUTOCRAT_AGENT_PORT, 4041),
  },

  AUTOCRAT_WEB: {
    DEFAULT: 4042,
    ENV_VAR: 'AUTOCRAT_WEB_PORT',
    get: () => safeParsePort(process.env.AUTOCRAT_WEB_PORT, 4042),
  },

  /** KMS API - Key Management Service */
  KMS_API: {
    DEFAULT: 4050,
    ENV_VAR: 'KMS_PORT',
    get: () => safeParsePort(process.env.KMS_PORT, 4050),
  },

  /** OAuth3 API - Decentralized identity service */
  OAUTH3_API: {
    DEFAULT: 4200,
    ENV_VAR: 'OAUTH3_PORT',
    get: () => safeParsePort(process.env.OAUTH3_PORT, 4200),
  },

  /** Oracle API - Price feed oracle */
  ORACLE_API: {
    DEFAULT: 4070,
    ENV_VAR: 'ORACLE_PORT',
    get: () => safeParsePort(process.env.ORACLE_PORT, 4070),
  },

  /** Node API - Network node management */
  NODE_API: {
    DEFAULT: 4080,
    ENV_VAR: 'NODE_PORT',
    get: () => safeParsePort(process.env.NODE_PORT, 4080),
  },

  /** Leaderboard API - Agent leaderboard */
  LEADERBOARD_API: {
    DEFAULT: 4090,
    ENV_VAR: 'LEADERBOARD_PORT',
    get: () => safeParsePort(process.env.LEADERBOARD_PORT, 4090),
  },

  /** Monitoring - Infrastructure monitoring service */
  MONITORING: {
    DEFAULT: 3002,
    ENV_VAR: 'MONITORING_PORT',
    get: () => safeParsePort(process.env.MONITORING_PORT, 3002),
  },

  /** VPN Web Frontend - Decentralized VPN UI */
  VPN_WEB: {
    DEFAULT: 1421,
    ENV_VAR: 'VPN_WEB_PORT',
    get: () => safeParsePort(process.env.VPN_WEB_PORT, 1421),
  },

  /** VPN API - Decentralized VPN backend */
  VPN_API: {
    DEFAULT: 4023,
    ENV_VAR: 'VPN_API_PORT',
    get: () => safeParsePort(process.env.VPN_API_PORT, 4023),
  },

  /** Wallet Frontend - Multi-chain agentic wallet */
  WALLET: {
    DEFAULT: 4015,
    ENV_VAR: 'WALLET_PORT',
    get: () => safeParsePort(process.env.WALLET_PORT, 4015),
  },

  /** Wallet WebSocket - Wallet real-time updates */
  WALLET_WS: {
    DEFAULT: 4017,
    ENV_VAR: 'WALLET_WS_PORT',
    get: () => safeParsePort(process.env.WALLET_WS_PORT, 4017),
  },

  /** Example App - Demo/example application */
  EXAMPLE: {
    DEFAULT: 4500,
    ENV_VAR: 'EXAMPLE_PORT',
    get: () => safeParsePort(process.env.EXAMPLE_PORT, 4500),
  },

  /** Bridge Relayer - Cross-chain transfer orchestration */
  BRIDGE_RELAYER: {
    DEFAULT: 8081,
    ENV_VAR: 'BRIDGE_RELAYER_PORT',
    get: () => safeParsePort(process.env.BRIDGE_RELAYER_PORT, 8081),
  },

  /** Bridge Prover - ZK proof generation service */
  BRIDGE_PROVER: {
    DEFAULT: 8082,
    ENV_VAR: 'BRIDGE_PROVER_PORT',
    get: () => safeParsePort(process.env.BRIDGE_PROVER_PORT, 8082),
  },

  /** Bridge Health - Health monitoring service */
  BRIDGE_HEALTH: {
    DEFAULT: 8083,
    ENV_VAR: 'BRIDGE_HEALTH_PORT',
    get: () => safeParsePort(process.env.BRIDGE_HEALTH_PORT, 8083),
  },
} as const

// Vendor Apps (5000-5999 range)

export const VENDOR_PORTS = {
  /** Launchpad Frontend - Token launchpad UI */
  LAUNCHPAD_FRONTEND: {
    DEFAULT: 5003,
    ENV_VAR: 'VENDOR_LAUNCHPAD_FRONTEND_PORT',
    get: () => safeParsePort(process.env.VENDOR_LAUNCHPAD_FRONTEND_PORT, 5003),
  },

  /** Launchpad Backend - Token launchpad API */
  LAUNCHPAD_BACKEND: {
    DEFAULT: 5004,
    ENV_VAR: 'VENDOR_LAUNCHPAD_BACKEND_PORT',
    get: () => safeParsePort(process.env.VENDOR_LAUNCHPAD_BACKEND_PORT, 5004),
  },

  /** OTC Trading Desk (TheDesk) - AI-powered OTC trading agent */
  OTC_DESK: {
    DEFAULT: 5005,
    ENV_VAR: 'VENDOR_OTC_DESK_PORT',
    get: () =>
      safeParsePort(
        process.env.VENDOR_OTC_DESK_PORT ?? process.env.VENDOR_THEDESK_PORT,
        5005,
      ),
  },

  /** OTC Trading Desk Database (PostgreSQL) */
  OTC_DESK_DB: {
    DEFAULT: 5439,
    ENV_VAR: 'VENDOR_OTC_DESK_DB_PORT',
    get: () => safeParsePort(process.env.VENDOR_OTC_DESK_DB_PORT, 5439),
  },

  /** OTC Trading Desk Worker */
  OTC_DESK_WORKER: {
    DEFAULT: 3137,
    ENV_VAR: 'VENDOR_OTC_DESK_WORKER_PORT',
    get: () => safeParsePort(process.env.VENDOR_OTC_DESK_WORKER_PORT, 3137),
  },

  /** Cloud - cloud dashboard */
  CLOUD: {
    DEFAULT: 5006,
    ENV_VAR: 'VENDOR_CLOUD_PORT',
    get: () => safeParsePort(process.env.VENDOR_CLOUD_PORT, 5006),
  },

  /** Caliguland Frontend */
  CALIGULAND_FRONTEND: {
    DEFAULT: 5007,
    ENV_VAR: 'VENDOR_CALIGULAND_FRONTEND_PORT',
    get: () => safeParsePort(process.env.VENDOR_CALIGULAND_FRONTEND_PORT, 5007),
  },

  /** Caliguland Game Server */
  CALIGULAND_GAME: {
    DEFAULT: 5011,
    ENV_VAR: 'VENDOR_CALIGULAND_GAME_PORT',
    get: () => safeParsePort(process.env.VENDOR_CALIGULAND_GAME_PORT, 5011),
  },

  /** Caliguland Auth */
  CALIGULAND_AUTH: {
    DEFAULT: 5012,
    ENV_VAR: 'VENDOR_CALIGULAND_AUTH_PORT',
    get: () => safeParsePort(process.env.VENDOR_CALIGULAND_AUTH_PORT, 5012),
  },

  /** redteam */
  ELIZAGOTCHI: {
    DEFAULT: 5010,
    ENV_VAR: 'VENDOR_ELIZAGOTCHI_PORT',
    get: () => safeParsePort(process.env.VENDOR_ELIZAGOTCHI_PORT, 5010),
  },
} as const

// Infrastructure Ports (6xxx range for Jeju chain, 9xxx for other infra)

export const INFRA_PORTS = {
  /** EQLite - Decentralized SQL database (block producer) */
  EQLite: {
    DEFAULT: 4661,
    ENV_VAR: 'EQLITE_PORT',
    get: () => safeParsePort(process.env.EQLITE_PORT, 4661),
  },

  /** L1 RPC - Jeju localnet L1. Port 6545 avoids conflicts with Anvil/Hardhat default (8545) */
  L1_RPC: {
    DEFAULT: 6545,
    ENV_VAR: 'L1_RPC_PORT',
    get: () => safeParsePort(process.env.L1_RPC_PORT, 6545),
  },

  /** L2 RPC - Jeju localnet L2 (main chain). Port 6546 avoids conflicts with standard Anvil (8545) */
  L2_RPC: {
    DEFAULT: 6546,
    ENV_VAR: 'L2_RPC_PORT',
    get: () => safeParsePort(process.env.L2_RPC_PORT, 6546),
  },

  /** L2 WebSocket */
  L2_WS: {
    DEFAULT: 6547,
    ENV_VAR: 'L2_WS_PORT',
    get: () => safeParsePort(process.env.L2_WS_PORT, 6547),
  },

  /** Prometheus */
  PROMETHEUS: {
    DEFAULT: 9090,
    ENV_VAR: 'PROMETHEUS_PORT',
    get: () => safeParsePort(process.env.PROMETHEUS_PORT, 9090),
  },

  /** Grafana */
  GRAFANA: {
    DEFAULT: 4010,
    ENV_VAR: 'GRAFANA_PORT',
    get: () => safeParsePort(process.env.GRAFANA_PORT, 4010),
  },

  /** Kurtosis UI */
  KURTOSIS_UI: {
    DEFAULT: 9711,
    ENV_VAR: 'KURTOSIS_UI_PORT',
    get: () => safeParsePort(process.env.KURTOSIS_UI_PORT, 9711),
  },
} as const

// URL Builders

/** Port configuration interface used by all port registries */
interface PortConfig {
  DEFAULT: number
  ENV_VAR: string
  get: () => number
}

/**
 * Get the localhost host address for building local service URLs
 */
export function getLocalhostHost(): string {
  return (
    process.env.HOST ||
    process.env.RPC_HOST ||
    process.env.LOCALHOST_HOST ||
    '127.0.0.1'
  )
}

/**
 * Generic URL builder for any port config
 * Checks environment for full URL override, then port override, then uses default
 */
function buildUrl(
  portConfig: PortConfig,
  protocol: 'http' | 'ws' = 'http',
): string {
  const urlEnvVar = portConfig.ENV_VAR.replace('_PORT', '_URL')

  // Check for full URL override
  const envUrl = process.env[urlEnvVar]
  if (envUrl) {
    return envUrl
  }

  // Build URL from port (with port override support)
  const port = portConfig.get()
  const host = getLocalhostHost()
  return `${protocol}://${host}:${port}`
}

/**
 * Build URL for a core app service
 */
export function getCoreAppUrl(
  appName: keyof typeof CORE_PORTS,
  protocol: 'http' | 'ws' = 'http',
): string {
  return buildUrl(CORE_PORTS[appName], protocol)
}

/**
 * Build URL for a vendor app service
 */
export function getVendorAppUrl(
  appName: keyof typeof VENDOR_PORTS,
  protocol: 'http' | 'ws' = 'http',
): string {
  return buildUrl(VENDOR_PORTS[appName], protocol)
}

/**
 * Build URL for infrastructure service
 */
export function getInfraUrl(
  serviceName: keyof typeof INFRA_PORTS,
  protocol: 'http' | 'ws' = 'http',
): string {
  return buildUrl(INFRA_PORTS[serviceName], protocol)
}

// Convenience Exports

/** Get all ports for a specific category */
export function getAllCorePorts(): Record<string, number> {
  return Object.fromEntries(
    Object.entries(CORE_PORTS).map(([key, config]) => [key, config.get()]),
  )
}

export function getAllVendorPorts(): Record<string, number> {
  return Object.fromEntries(
    Object.entries(VENDOR_PORTS).map(([key, config]) => [key, config.get()]),
  )
}

export function getAllInfraPorts(): Record<string, number> {
  return Object.fromEntries(
    Object.entries(INFRA_PORTS).map(([key, config]) => [key, config.get()]),
  )
}

/** Print all port allocations (useful for debugging) */
export function printPortAllocation(): void {
  console.log('\n📊 Port Allocation:')
  console.log('\n🔧 Core Apps (4000-4999):')
  Object.entries(CORE_PORTS).forEach(([name, config]) => {
    console.log(
      `  ${name.padEnd(25)} ${config.get().toString().padStart(5)} (${config.ENV_VAR})`,
    )
  })

  console.log('\n📦 Vendor Apps (5000-5999):')
  Object.entries(VENDOR_PORTS).forEach(([name, config]) => {
    console.log(
      `  ${name.padEnd(25)} ${config.get().toString().padStart(5)} (${config.ENV_VAR})`,
    )
  })

  console.log('\n🏗️  Infrastructure (8000-9999):')
  Object.entries(INFRA_PORTS).forEach(([name, config]) => {
    console.log(
      `  ${name.padEnd(25)} ${config.get().toString().padStart(5)} (${config.ENV_VAR})`,
    )
  })
  console.log('')
}

/** Check for port conflicts */
export function checkPortConflicts(): {
  hasConflicts: boolean
  conflicts: string[]
} {
  const usedPorts = new Map<number, string[]>()
  const conflicts: string[] = []

  // Collect all ports
  const allPorts = {
    ...getAllCorePorts(),
    ...getAllVendorPorts(),
    ...getAllInfraPorts(),
  }

  // Check for duplicates
  Object.entries(allPorts).forEach(([name, port]) => {
    const existing = usedPorts.get(port)
    if (existing) {
      existing.push(name)
    } else {
      usedPorts.set(port, [name])
    }
  })

  // Find conflicts
  usedPorts.forEach((services, port) => {
    if (services.length > 1) {
      conflicts.push(`Port ${port}: ${services.join(', ')}`)
    }
  })

  return {
    hasConflicts: conflicts.length > 0,
    conflicts,
  }
}

// RPC URL Helpers - Use these instead of hardcoding ports

/**
 * Get the localnet L1 RPC URL
 * Respects environment variable overrides: L1_RPC_URL, then L1_RPC_PORT
 */
export function getL1RpcUrl(): string {
  if (process.env.L1_RPC_URL) return process.env.L1_RPC_URL
  const port = INFRA_PORTS.L1_RPC.get()
  const host = getLocalhostHost()
  return `http://${host}:${port}`
}

/**
 * Get the localnet L2 RPC URL (main Jeju chain)
 * Respects environment variable overrides: L2_RPC_URL, JEJU_RPC_URL, RPC_URL, then L2_RPC_PORT
 */
export function getL2RpcUrl(): string {
  if (process.env.L2_RPC_URL) return process.env.L2_RPC_URL
  if (process.env.JEJU_RPC_URL) return process.env.JEJU_RPC_URL
  if (process.env.RPC_URL) return process.env.RPC_URL
  const port = INFRA_PORTS.L2_RPC.get()
  const host = getLocalhostHost()
  return `http://${host}:${port}`
}

/**
 * Get the localnet L2 WebSocket URL
 * Respects environment variable overrides: L2_WS_URL, then L2_WS_PORT
 */
export function getL2WsUrl(): string {
  if (process.env.L2_WS_URL) return process.env.L2_WS_URL
  const port = INFRA_PORTS.L2_WS.get()
  const host = getLocalhostHost()
  return `ws://${host}:${port}`
}

/**
 * Alias for getL2RpcUrl - the "default" Jeju RPC
 */
export const getJejuRpcUrl = getL2RpcUrl

/**
 * Get the Bridge Relayer URL
 * Respects environment variable overrides: BRIDGE_RELAYER_URL, then BRIDGE_RELAYER_PORT
 */
export function getBridgeRelayerUrl(): string {
  if (process.env.BRIDGE_RELAYER_URL) return process.env.BRIDGE_RELAYER_URL
  const port = CORE_PORTS.BRIDGE_RELAYER.get()
  const host = getLocalhostHost()
  return `http://${host}:${port}`
}

/**
 * Get the Bridge Prover URL
 * Respects environment variable overrides: BRIDGE_PROVER_URL, then BRIDGE_PROVER_PORT
 */
export function getBridgeProverUrl(): string {
  if (process.env.BRIDGE_PROVER_URL) return process.env.BRIDGE_PROVER_URL
  const port = CORE_PORTS.BRIDGE_PROVER.get()
  const host = getLocalhostHost()
  return `http://${host}:${port}`
}

/**
 * Get the Bridge Health monitoring URL
 * Respects environment variable overrides: BRIDGE_HEALTH_URL, then BRIDGE_HEALTH_PORT
 */
export function getBridgeHealthUrl(): string {
  if (process.env.BRIDGE_HEALTH_URL) return process.env.BRIDGE_HEALTH_URL
  const port = CORE_PORTS.BRIDGE_HEALTH.get()
  const host = getLocalhostHost()
  return `http://${host}:${port}`
}

/**
 * Get the IPFS API URL (Kubo daemon HTTP API)
 * Respects environment variable overrides: IPFS_API_URL, then IPFS_API_PORT
 * Default: http://127.0.0.1:5001
 */
export function getIpfsApiUrl(): string {
  if (process.env.IPFS_API_URL) return process.env.IPFS_API_URL
  const port = CORE_PORTS.IPFS_API.get()
  const host = getLocalhostHost()
  return `http://${host}:${port}`
}

/**
 * Check if a URL points to localnet
 */
export function isLocalnet(rpcUrl: string): boolean {
  const l1Port = INFRA_PORTS.L1_RPC.get()
  const l2Port = INFRA_PORTS.L2_RPC.get()
  const localhostHost = getLocalhostHost()
  return (
    rpcUrl.includes('localhost') ||
    rpcUrl.includes('127.0.0.1') ||
    rpcUrl.includes(localhostHost) ||
    rpcUrl.includes(`:${l1Port}`) ||
    rpcUrl.includes(`:${l2Port}`)
  )
}

/**
 * Get the EQLite block producer URL
 * Respects environment variable overrides: EQLITE_BLOCK_PRODUCER_ENDPOINT, EQLITE_URL, then EQLITE_PORT
 */
export function getEQLiteBlockProducerUrl(): string {
  if (process.env.EQLITE_BLOCK_PRODUCER_ENDPOINT)
    return process.env.EQLITE_BLOCK_PRODUCER_ENDPOINT
  if (process.env.EQLITE_URL) return process.env.EQLITE_URL
  const port = INFRA_PORTS.EQLite.get()
  const host = process.env.EQLITE_HOST || getLocalhostHost()
  return `http://${host}:${port}`
}

// Service URL Helpers

/**
 * Get the Indexer GraphQL URL
 * Prefers DWS-proxied endpoint for decentralized access when available
 */
export function getIndexerGraphqlUrl(): string {
  // Direct indexer URL takes precedence (for explicit configuration)
  if (process.env.INDEXER_GRAPHQL_URL) return process.env.INDEXER_GRAPHQL_URL

  // Prefer DWS-proxied endpoint for decentralized access
  if (process.env.INDEXER_DWS_URL) return process.env.INDEXER_DWS_URL
  if (process.env.USE_DWS_INDEXER === 'true') {
    const dwsPort = CORE_PORTS.DWS_API.get()
    const host = getLocalhostHost()
    return `http://${host}:${dwsPort}/indexer/graphql`
  }

  // Fallback to direct indexer endpoint
  const port = CORE_PORTS.INDEXER_GRAPHQL.get()
  const host = getLocalhostHost()
  return `http://${host}:${port}/graphql`
}

/**
 * Get the Indexer GraphQL URL via DWS proxy
 * Always returns the DWS-proxied endpoint for decentralized access
 */
export function getIndexerDwsUrl(): string {
  if (process.env.INDEXER_DWS_URL) return process.env.INDEXER_DWS_URL
  const port = CORE_PORTS.DWS_API.get()
  const host = getLocalhostHost()
  return `http://${host}:${port}/indexer/graphql`
}

/**
 * Get the Indexer REST API URL
 */
export function getIndexerRestUrl(): string {
  if (process.env.INDEXER_REST_URL) return process.env.INDEXER_REST_URL
  const port = CORE_PORTS.INDEXER_REST.get()
  const host = getLocalhostHost()
  return `http://${host}:${port}/api`
}

/**
 * Get the Indexer A2A URL
 */
export function getIndexerA2AUrl(): string {
  if (process.env.INDEXER_A2A_URL) return process.env.INDEXER_A2A_URL
  const port = CORE_PORTS.INDEXER_A2A.get()
  const host = getLocalhostHost()
  return `http://${host}:${port}/api/a2a`
}

/**
 * Get the Indexer MCP URL
 */
export function getIndexerMcpUrl(): string {
  if (process.env.INDEXER_MCP_URL) return process.env.INDEXER_MCP_URL
  const port = CORE_PORTS.INDEXER_MCP.get()
  const host = getLocalhostHost()
  return `http://${host}:${port}`
}

/**
 * Get the RPC Gateway URL
 */
export function getRpcGatewayUrl(): string {
  if (process.env.RPC_GATEWAY_URL) return process.env.RPC_GATEWAY_URL
  const port = CORE_PORTS.RPC_GATEWAY.get()
  const host = getLocalhostHost()
  return `http://${host}:${port}`
}

/**
 * Get the IPFS service URL (x402 storage service)
 */
export function getIpfsUrl(): string {
  if (process.env.IPFS_URL) return process.env.IPFS_URL
  const port = CORE_PORTS.IPFS.get()
  const host = getLocalhostHost()
  return `http://${host}:${port}`
}

/**
 * Get the OIF Aggregator URL
 */
export function getOifAggregatorUrl(): string {
  if (process.env.OIF_AGGREGATOR_URL) return process.env.OIF_AGGREGATOR_URL
  const port = CORE_PORTS.OIF_AGGREGATOR.get()
  const host = getLocalhostHost()
  return `http://${host}:${port}/api`
}

/**
 * Get the Leaderboard API URL
 */
export function getLeaderboardUrl(): string {
  if (process.env.LEADERBOARD_URL) return process.env.LEADERBOARD_URL
  const port = CORE_PORTS.LEADERBOARD_API.get()
  const host = getLocalhostHost()
  return `http://${host}:${port}`
}

/**
 * Get the Explorer URL
 */
export function getExplorerUrl(): string {
  if (process.env.EXPLORER_URL) return process.env.EXPLORER_URL
  const port = CORE_PORTS.EXPLORER.get()
  const host = getLocalhostHost()
  return `http://${host}:${port}`
}

/**
 * Get the Documentation A2A URL
 */
export function getDocumentationA2AUrl(): string {
  if (process.env.DOCUMENTATION_A2A_URL)
    return process.env.DOCUMENTATION_A2A_URL
  const port = CORE_PORTS.DOCUMENTATION_A2A.get()
  const host = getLocalhostHost()
  return `http://${host}:${port}/api/a2a`
}

/**
 * Get the OAuth3 API URL
 */
export function getOAuth3Url(): string {
  if (process.env.OAUTH3_URL) return process.env.OAUTH3_URL
  const port = CORE_PORTS.OAUTH3_API.get()
  const host = getLocalhostHost()
  return `http://${host}:${port}`
}

/**
 * Get the Autocrat Web URL
 */
export function getAutocratWebUrl(): string {
  if (process.env.AUTOCRAT_WEB_URL) return process.env.AUTOCRAT_WEB_URL
  const port = CORE_PORTS.AUTOCRAT_WEB.get()
  const host = getLocalhostHost()
  return `http://${host}:${port}`
}

/**
 * Get the Autocrat API URL
 */
export function getAutocratApiUrl(): string {
  if (process.env.AUTOCRAT_API_URL) return process.env.AUTOCRAT_API_URL
  const port = CORE_PORTS.AUTOCRAT_API.get()
  const host = getLocalhostHost()
  return `http://${host}:${port}`
}

/**
 * Get the DWS API endpoint
 * Respects environment variable overrides: DWS_ENDPOINT, DWS_URL, then DWS_PORT
 */
export function getDWSEndpoint(): string {
  if (process.env.DWS_ENDPOINT) return process.env.DWS_ENDPOINT
  if (process.env.DWS_URL) return process.env.DWS_URL
  const port = CORE_PORTS.DWS_API.get()
  const host = getLocalhostHost()
  return `http://${host}:${port}`
}

/**
 * Get the KMS API endpoint
 * Respects environment variable overrides: KMS_ENDPOINT, KMS_URL, then KMS_PORT
 */
export function getKMSEndpoint(): string {
  if (process.env.KMS_ENDPOINT) return process.env.KMS_ENDPOINT
  if (process.env.KMS_URL) return process.env.KMS_URL
  const port = CORE_PORTS.KMS_API.get()
  const host = getLocalhostHost()
  return `http://${host}:${port}`
}
