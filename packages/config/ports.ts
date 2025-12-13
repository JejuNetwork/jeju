/**
 * @fileoverview Centralized Port Allocation for Jeju Network
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

// ============================================================================
// Core Apps (4000-4999 range)
// ============================================================================

export const CORE_PORTS = {
  /** Gateway Portal - Bridge tokens, deploy paymasters, earn LP rewards */
  GATEWAY: {
    DEFAULT: 4001,
    ENV_VAR: 'GATEWAY_PORT',
    get: () => parseInt(process.env.GATEWAY_PORT || process.env.PAYMASTER_DASHBOARD_PORT || '4001')
  },

  /** Node Explorer API - Node operator tracking backend */
  NODE_EXPLORER_API: {
    DEFAULT: 4002,
    ENV_VAR: 'NODE_EXPLORER_API_PORT',
    get: () => parseInt(process.env.NODE_EXPLORER_API_PORT || '4002')
  },

  /** Node Explorer UI - Node operator dashboard frontend */
  NODE_EXPLORER_UI: {
    DEFAULT: 4003,
    ENV_VAR: 'NODE_EXPLORER_UI_PORT',
    get: () => parseInt(process.env.NODE_EXPLORER_UI_PORT || '4003')
  },

  /** Documentation - VitePress docs site */
  DOCUMENTATION: {
    DEFAULT: 4004,
    ENV_VAR: 'DOCUMENTATION_PORT',
    get: () => parseInt(process.env.DOCUMENTATION_PORT || '4004')
  },

  /** Predimarket - Prediction market platform */
  PREDIMARKET: {
    DEFAULT: 4005,
    ENV_VAR: 'PREDIMARKET_PORT',
    get: () => parseInt(process.env.PREDIMARKET_PORT || '4005')
  },

  /** Bazaar - DeFi + NFT Marketplace */
  BAZAAR: {
    DEFAULT: 4006,
    ENV_VAR: 'BAZAAR_PORT',
    get: () => parseInt(process.env.BAZAAR_PORT || '4006')
  },

  /** Compute Marketplace - Decentralized AI inference marketplace */
  COMPUTE: {
    DEFAULT: 4007,
    ENV_VAR: 'COMPUTE_PORT',
    get: () => parseInt(process.env.COMPUTE_PORT || '4007')
  },

  /** Compute Node API - Provider node endpoint */
  COMPUTE_NODE_API: {
    DEFAULT: 4008,
    ENV_VAR: 'COMPUTE_NODE_API_PORT',
    get: () => parseInt(process.env.COMPUTE_NODE_API_PORT || '4008')
  },

  /** IPFS Storage Service - Decentralized file storage with x402 payments */
  IPFS: {
    DEFAULT: 3100,
    ENV_VAR: 'IPFS_PORT',
    get: () => parseInt(process.env.IPFS_PORT || '3100')
  },

  /** IPFS Node (Kubo) - IPFS daemon API */
  IPFS_NODE: {
    DEFAULT: 4100,
    ENV_VAR: 'IPFS_NODE_PORT',
    get: () => parseInt(process.env.IPFS_NODE_PORT || '4100')
  },

  /** Indexer GraphQL - Subsquid data indexing */
  INDEXER_GRAPHQL: {
    DEFAULT: 4350,
    ENV_VAR: 'INDEXER_GRAPHQL_PORT',
    get: () => parseInt(process.env.INDEXER_GRAPHQL_PORT || '4350')
  },

  /** Indexer Database - PostgreSQL */
  INDEXER_DATABASE: {
    DEFAULT: 23798,
    ENV_VAR: 'INDEXER_DB_PORT',
    get: () => parseInt(process.env.INDEXER_DB_PORT || '23798')
  },

  /** x402 Facilitator - Payment verification and settlement service */
  FACILITATOR: {
    DEFAULT: 3402,
    ENV_VAR: 'FACILITATOR_PORT',
    get: () => parseInt(process.env.FACILITATOR_PORT || '3402')
  },
} as const;

// ============================================================================
// Vendor Apps (5000-5999 range)
// ============================================================================

export const VENDOR_PORTS = {
  /** 
   * Hyperscape Client - 3D on-chain RPG (Vite dev server)
   * Standalone: 3333 (default)
   * Jeju mode: 5013 (set via VITE_PORT in jeju-manifest.json)
   */
  HYPERSCAPE_CLIENT: {
    DEFAULT: 3333,
    JEJU: 5013,
    ENV_VAR: 'VITE_PORT',
    get: () => parseInt(process.env.VITE_PORT || process.env.VENDOR_HYPERSCAPE_CLIENT_PORT || '3333')
  },

  /** 
   * Hyperscape Server - Game server (Fastify + WebSockets)
   * Standalone: 5555 (default)
   * Jeju mode: 5014 (set via PORT in jeju-manifest.json)
   */
  HYPERSCAPE_SERVER: {
    DEFAULT: 5555,
    JEJU: 5014,
    ENV_VAR: 'PORT',
    get: () => parseInt(process.env.PORT || process.env.VENDOR_HYPERSCAPE_SERVER_PORT || '5555')
  },

  /** Launchpad Frontend - Token launchpad UI */
  LAUNCHPAD_FRONTEND: {
    DEFAULT: 5003,
    ENV_VAR: 'VENDOR_LAUNCHPAD_FRONTEND_PORT',
    get: () => parseInt(process.env.VENDOR_LAUNCHPAD_FRONTEND_PORT || '5003')
  },

  /** Launchpad Backend - Token launchpad API */
  LAUNCHPAD_BACKEND: {
    DEFAULT: 5004,
    ENV_VAR: 'VENDOR_LAUNCHPAD_BACKEND_PORT',
    get: () => parseInt(process.env.VENDOR_LAUNCHPAD_BACKEND_PORT || '5004')
  },

  /** OTC Trading Desk (TheDesk) - AI-powered OTC trading agent */
  OTC_DESK: {
    DEFAULT: 5005,
    ENV_VAR: 'VENDOR_OTC_DESK_PORT',
    get: () => parseInt(process.env.VENDOR_OTC_DESK_PORT || process.env.VENDOR_THEDESK_PORT || '5005')
  },

  /** OTC Trading Desk Database (PostgreSQL) */
  OTC_DESK_DB: {
    DEFAULT: 5439,
    ENV_VAR: 'VENDOR_OTC_DESK_DB_PORT',
    get: () => parseInt(process.env.VENDOR_OTC_DESK_DB_PORT || '5439')
  },

  /** OTC Trading Desk Worker */
  OTC_DESK_WORKER: {
    DEFAULT: 3137,
    ENV_VAR: 'VENDOR_OTC_DESK_WORKER_PORT',
    get: () => parseInt(process.env.VENDOR_OTC_DESK_WORKER_PORT || '3137')
  },

  /** Cloud - Jeju cloud dashboard */
  CLOUD: {
    DEFAULT: 5006,
    ENV_VAR: 'VENDOR_CLOUD_PORT',
    get: () => parseInt(process.env.VENDOR_CLOUD_PORT || '5006')
  },

  /** Caliguland Frontend */
  CALIGULAND_FRONTEND: {
    DEFAULT: 5007,
    ENV_VAR: 'VENDOR_CALIGULAND_FRONTEND_PORT',
    get: () => parseInt(process.env.VENDOR_CALIGULAND_FRONTEND_PORT || '5007')
  },

  /** Caliguland Game Server */
  CALIGULAND_GAME: {
    DEFAULT: 5008,
    ENV_VAR: 'VENDOR_CALIGULAND_GAME_PORT',
    get: () => parseInt(process.env.VENDOR_CALIGULAND_GAME_PORT || '5008')
  },

  /** Caliguland Auth */
  CALIGULAND_AUTH: {
    DEFAULT: 5009,
    ENV_VAR: 'VENDOR_CALIGULAND_AUTH_PORT',
    get: () => parseInt(process.env.VENDOR_CALIGULAND_AUTH_PORT || '5009')
  },

  /** redteam */
  ELIZAGOTCHI: {
    DEFAULT: 5010,
    ENV_VAR: 'VENDOR_ELIZAGOTCHI_PORT',
    get: () => parseInt(process.env.VENDOR_ELIZAGOTCHI_PORT || '5010')
  },
} as const;

// ============================================================================
// Infrastructure Ports (8000-9999 range)
// ============================================================================

export const INFRA_PORTS = {
  /** L1 RPC (Geth) - Static port for wallet compatibility */
  L1_RPC: {
    DEFAULT: 8545,
    ENV_VAR: 'L1_RPC_PORT',
    get: () => parseInt(process.env.L1_RPC_PORT || '8545')
  },

  /** L2 RPC (OP-Geth) - Static port for wallet compatibility */
  L2_RPC: {
    DEFAULT: 9545,
    ENV_VAR: 'L2_RPC_PORT',
    get: () => parseInt(process.env.L2_RPC_PORT || '9545')
  },

  /** L2 WebSocket */
  L2_WS: {
    DEFAULT: 9546,
    ENV_VAR: 'L2_WS_PORT',
    get: () => parseInt(process.env.L2_WS_PORT || '9546')
  },

  /** Prometheus */
  PROMETHEUS: {
    DEFAULT: 9090,
    ENV_VAR: 'PROMETHEUS_PORT',
    get: () => parseInt(process.env.PROMETHEUS_PORT || '9090')
  },

  /** Grafana */
  GRAFANA: {
    DEFAULT: 4010,
    ENV_VAR: 'GRAFANA_PORT',
    get: () => parseInt(process.env.GRAFANA_PORT || '4010')
  },

  /** Kurtosis UI */
  KURTOSIS_UI: {
    DEFAULT: 9711,
    ENV_VAR: 'KURTOSIS_UI_PORT',
    get: () => parseInt(process.env.KURTOSIS_UI_PORT || '9711')
  },
} as const;

// ============================================================================
// URL Builders
// ============================================================================

/**
 * Build URL for a core app service
 * Checks environment for full URL override, then port override, then uses default
 */
export function getCoreAppUrl(
  appName: keyof typeof CORE_PORTS,
  protocol: 'http' | 'ws' = 'http'
): string {
  const portConfig = CORE_PORTS[appName];
  const urlEnvVar = `${portConfig.ENV_VAR.replace('_PORT', '_URL')}`;
  
  // 1. Check for full URL override
  if (process.env[urlEnvVar]) {
    return process.env[urlEnvVar]!;
  }
  
  // 2. Build URL from port (with port override support)
  const port = portConfig.get();
  const host = process.env.HOST || 'localhost';
  return `${protocol}://${host}:${port}`;
}

/**
 * Build URL for a vendor app service
 */
export function getVendorAppUrl(
  appName: keyof typeof VENDOR_PORTS,
  protocol: 'http' | 'ws' = 'http'
): string {
  const portConfig = VENDOR_PORTS[appName];
  const urlEnvVar = `${portConfig.ENV_VAR.replace('_PORT', '_URL')}`;
  
  // 1. Check for full URL override
  if (process.env[urlEnvVar]) {
    return process.env[urlEnvVar]!;
  }
  
  // 2. Build URL from port
  const port = portConfig.get();
  const host = process.env.HOST || 'localhost';
  return `${protocol}://${host}:${port}`;
}

/**
 * Build URL for infrastructure service
 */
export function getInfraUrl(
  serviceName: keyof typeof INFRA_PORTS,
  protocol: 'http' | 'ws' = 'http'
): string {
  const portConfig = INFRA_PORTS[serviceName];
  const urlEnvVar = `${portConfig.ENV_VAR.replace('_PORT', '_URL')}`;
  
  // 1. Check for full URL override
  if (process.env[urlEnvVar]) {
    return process.env[urlEnvVar]!;
  }
  
  // 2. Build URL from port
  const port = portConfig.get();
  const host = process.env.HOST || 'localhost';
  return `${protocol}://${host}:${port}`;
}

// ============================================================================
// Convenience Exports
// ============================================================================

/** Get all ports for a specific category */
export function getAllCorePorts(): Record<string, number> {
  return Object.fromEntries(
    Object.entries(CORE_PORTS).map(([key, config]) => [key, config.get()])
  );
}

export function getAllVendorPorts(): Record<string, number> {
  return Object.fromEntries(
    Object.entries(VENDOR_PORTS).map(([key, config]) => [key, config.get()])
  );
}

export function getAllInfraPorts(): Record<string, number> {
  return Object.fromEntries(
    Object.entries(INFRA_PORTS).map(([key, config]) => [key, config.get()])
  );
}

/** Print all port allocations (useful for debugging) */
export function printPortAllocation(): void {
  console.log('\n📊 Port Allocation:');
  console.log('\n🔧 Core Apps (4000-4999):');
  Object.entries(CORE_PORTS).forEach(([name, config]) => {
    console.log(`  ${name.padEnd(25)} ${config.get().toString().padStart(5)} (${config.ENV_VAR})`);
  });
  
  console.log('\n📦 Vendor Apps (5000-5999):');
  Object.entries(VENDOR_PORTS).forEach(([name, config]) => {
    console.log(`  ${name.padEnd(25)} ${config.get().toString().padStart(5)} (${config.ENV_VAR})`);
  });
  
  console.log('\n🏗️  Infrastructure (8000-9999):');
  Object.entries(INFRA_PORTS).forEach(([name, config]) => {
    console.log(`  ${name.padEnd(25)} ${config.get().toString().padStart(5)} (${config.ENV_VAR})`);
  });
  console.log('');
}

/** Check for port conflicts */
export function checkPortConflicts(): { hasConflicts: boolean; conflicts: string[] } {
  const usedPorts = new Map<number, string[]>();
  const conflicts: string[] = [];
  
  // Collect all ports
  const allPorts = {
    ...getAllCorePorts(),
    ...getAllVendorPorts(),
    ...getAllInfraPorts(),
  };
  
  // Check for duplicates
  Object.entries(allPorts).forEach(([name, port]) => {
    if (!usedPorts.has(port)) {
      usedPorts.set(port, []);
    }
    usedPorts.get(port)!.push(name);
  });
  
  // Find conflicts
  usedPorts.forEach((services, port) => {
    if (services.length > 1) {
      conflicts.push(`Port ${port}: ${services.join(', ')}`);
    }
  });
  
  return {
    hasConflicts: conflicts.length > 0,
    conflicts,
  };
}

