/**
 * @fileoverview Centralized Port Allocation for Jeju Network
 * @module config/ports
 * 
 * Port Ranges:
 * - 4000-4999: Core apps (apps/ directory)
 * - 5000-5999: Vendor apps (vendor/ directory)
 * - 8000-9999: Infrastructure (RPC, databases, monitoring)
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

  /** Bazaar - Unified DeFi + NFT Marketplace */
  BAZAAR: {
    DEFAULT: 4006,
    ENV_VAR: 'BAZAAR_PORT',
    get: () => parseInt(process.env.BAZAAR_PORT || '4006')
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
} as const;

// ============================================================================
// Vendor Apps (5000-5999 range)
// ============================================================================

export const VENDOR_PORTS = {
  /** Hyperscape Client - 3D on-chain RPG */
  HYPERSCAPE_CLIENT: {
    DEFAULT: 5001,
    ENV_VAR: 'VENDOR_HYPERSCAPE_CLIENT_PORT',
    get: () => parseInt(process.env.VENDOR_HYPERSCAPE_CLIENT_PORT || '5001')
  },

  /** Hyperscape Server - Game server */
  HYPERSCAPE_SERVER: {
    DEFAULT: 5002,
    ENV_VAR: 'VENDOR_HYPERSCAPE_SERVER_PORT',
    get: () => parseInt(process.env.VENDOR_HYPERSCAPE_SERVER_PORT || '5002')
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

  /** TheDesk - OTC trading agent */
  THEDESK: {
    DEFAULT: 5005,
    ENV_VAR: 'VENDOR_THEDESK_PORT',
    get: () => parseInt(process.env.VENDOR_THEDESK_PORT || '5005')
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

  /** Elizagotchi */
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

