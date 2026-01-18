/**
 * @fileoverview Test Configuration Utility
 * @module config/test-config
 *
 * Provides test environment configuration based on target network.
 * Used by Playwright configs to determine baseURL and whether to start local servers.
 *
 * Usage in playwright.config.ts:
 * ```ts
 * import { getTestConfig } from '@jejunetwork/config/test-config'
 * const config = getTestConfig('dws')
 * export default defineConfig({
 *   use: { baseURL: config.baseURL },
 *   webServer: config.skipWebServer ? undefined : { ... }
 * })
 * ```
 */

import { getCurrentNetwork, getServicesConfig } from './index'
import { CORE_PORTS } from './ports'
import type { NetworkType } from './schemas'

/** App name type for type safety */
export type AppName =
  | 'dws'
  | 'crucible'
  | 'bazaar'
  | 'factory'
  | 'gateway'
  | 'autocrat'
  | 'monitoring'
  | 'oauth3'
  | 'vpn'
  | 'node'
  | 'indexer'
  | 'wallet'
  | 'otto'
  | 'example'
  | 'documentation'

/** Test configuration returned by getTestConfig */
export interface TestConfig {
  /** Base URL for Playwright tests */
  baseURL: string
  /** API URL for backend tests (if different from frontend) */
  apiURL: string
  /** Current network being tested */
  network: NetworkType
  /** Whether testing against a remote network (testnet/mainnet) */
  isRemote: boolean
  /** Whether to skip starting local webserver */
  skipWebServer: boolean
  /** Chain ID for the target network */
  chainId: number
  /** RPC URL for blockchain interactions */
  rpcURL: string
}

/**
 * Local port mappings for each app's frontend.
 * These are the ports where the frontend dev server runs.
 * Derived from jeju-manifest.json "ports" configuration.
 */
const LOCAL_FRONTEND_PORTS: Record<AppName, number> = {
  dws: CORE_PORTS.DWS_INFERENCE.DEFAULT, // 4031
  crucible: CORE_PORTS.CRUCIBLE_API.DEFAULT, // 4020
  bazaar: CORE_PORTS.BAZAAR.DEFAULT, // 4006
  factory: CORE_PORTS.FACTORY.DEFAULT, // 4009
  gateway: 4014, // Frontend dev server, not GATEWAY port (4013)
  autocrat: CORE_PORTS.AUTOCRAT_WEB.DEFAULT, // 4042
  monitoring: CORE_PORTS.MONITORING.DEFAULT, // 3002
  oauth3: 4201, // Frontend port
  vpn: CORE_PORTS.VPN_WEB.DEFAULT, // 1421
  node: CORE_PORTS.NODE_API.DEFAULT, // 4080 (Tauri app port)
  indexer: 4355, // Indexer frontend
  wallet: CORE_PORTS.WALLET.DEFAULT, // 4015
  otto: CORE_PORTS.OTTO.DEFAULT, // 4060
  example: CORE_PORTS.EXAMPLE.DEFAULT, // 4500
  documentation: 4055, // Vocs docs
}

/**
 * Local API port mappings for apps that have separate API servers.
 */
const LOCAL_API_PORTS: Record<AppName, number> = {
  dws: CORE_PORTS.DWS_API.DEFAULT, // 4030
  crucible: CORE_PORTS.CRUCIBLE_EXECUTOR.DEFAULT, // 4021
  bazaar: CORE_PORTS.BAZAAR_API.DEFAULT, // 4007
  factory: CORE_PORTS.FACTORY.DEFAULT, // 4009 (same as frontend)
  gateway: CORE_PORTS.GATEWAY.DEFAULT, // 4013
  autocrat: CORE_PORTS.AUTOCRAT_API.DEFAULT, // 4040
  monitoring: CORE_PORTS.MONITORING.DEFAULT, // 3002
  oauth3: CORE_PORTS.OAUTH3_API.DEFAULT, // 4200
  vpn: CORE_PORTS.VPN_API.DEFAULT, // 4023
  node: CORE_PORTS.NODE_API.DEFAULT, // 4080
  indexer: CORE_PORTS.INDEXER_REST.DEFAULT, // 4352
  wallet: CORE_PORTS.WALLET.DEFAULT, // 4015
  otto: CORE_PORTS.OTTO.DEFAULT, // 4060
  example: CORE_PORTS.EXAMPLE.DEFAULT, // 4500
  documentation: 4055, // Same as frontend
}

/** Chain IDs for each network */
const CHAIN_IDS: Record<NetworkType, number> = {
  localnet: 31337,
  testnet: 420690,
  mainnet: 420691,
}

/**
 * Get the frontend URL for an app on a remote network (testnet/mainnet).
 * Pattern: https://{app}.testnet.jejunetwork.org or https://{app}.jejunetwork.org
 */
function getRemoteFrontendURL(
  app: AppName,
  network: 'testnet' | 'mainnet',
): string {
  const services = getServicesConfig(network)

  // Map app names to their service config keys
  // Some apps use their API URL as the frontend (DWS pattern)
  switch (app) {
    case 'dws':
      return services.dws.api
    case 'crucible':
      return services.crucible.api
    case 'bazaar':
      return services.bazaar
    case 'factory':
      return services.factory.ui
    case 'gateway':
      return services.gateway.ui
    case 'autocrat':
      return services.autocrat.api
    case 'monitoring':
      return (
        services.monitoring.api ??
        `https://monitoring.${network === 'testnet' ? 'testnet.' : ''}jejunetwork.org`
      )
    case 'oauth3':
      return (
        services.oauth3?.api ??
        `https://oauth3.${network === 'testnet' ? 'testnet.' : ''}jejunetwork.org`
      )
    case 'indexer':
      return services.indexer.api ?? services.indexer.graphql
    case 'node':
      return (
        services.node?.api ??
        `https://node.${network === 'testnet' ? 'testnet.' : ''}jejunetwork.org`
      )
    case 'wallet':
      // Wallet is typically served from gateway or its own subdomain
      return `https://wallet.${network === 'testnet' ? 'testnet.' : ''}jejunetwork.org`
    case 'vpn':
      return (
        services.node?.vpn ??
        `https://vpn.${network === 'testnet' ? 'testnet.' : ''}jejunetwork.org`
      )
    case 'otto':
      return `https://otto.${network === 'testnet' ? 'testnet.' : ''}jejunetwork.org`
    case 'example':
      return `https://example.${network === 'testnet' ? 'testnet.' : ''}jejunetwork.org`
    case 'documentation':
      return `https://docs.${network === 'testnet' ? 'testnet.' : ''}jejunetwork.org`
  }
}

/**
 * Get the API URL for an app on a remote network.
 */
function getRemoteApiURL(app: AppName, network: 'testnet' | 'mainnet'): string {
  const services = getServicesConfig(network)

  switch (app) {
    case 'dws':
      return services.dws.api
    case 'crucible':
      return services.crucible.executor
    case 'bazaar':
      return `${services.bazaar}/api`
    case 'factory':
      return services.factory.api
    case 'gateway':
      return services.gateway.api
    case 'autocrat':
      return services.autocrat.api
    case 'monitoring':
      return (
        services.monitoring.api ??
        `https://monitoring.${network === 'testnet' ? 'testnet.' : ''}jejunetwork.org/api`
      )
    case 'oauth3':
      return (
        services.oauth3?.api ??
        `https://oauth3.${network === 'testnet' ? 'testnet.' : ''}jejunetwork.org`
      )
    case 'indexer':
      return services.indexer.api ?? services.indexer.graphql
    case 'node':
      return (
        services.node?.api ??
        `https://node.${network === 'testnet' ? 'testnet.' : ''}jejunetwork.org`
      )
    case 'wallet':
      return services.gateway.api // Wallet typically uses gateway API
    case 'vpn':
      return (
        services.node?.vpn ??
        `https://vpn.${network === 'testnet' ? 'testnet.' : ''}jejunetwork.org`
      )
    case 'otto':
      return `https://otto.${network === 'testnet' ? 'testnet.' : ''}jejunetwork.org`
    case 'example':
      return `https://example.${network === 'testnet' ? 'testnet.' : ''}jejunetwork.org`
    case 'documentation':
      return `https://docs.${network === 'testnet' ? 'testnet.' : ''}jejunetwork.org`
  }
}

/**
 * Get test configuration for a specific app.
 *
 * @param app - The app name (e.g., 'dws', 'crucible', 'bazaar')
 * @param networkOverride - Override the network (default: from JEJU_NETWORK env var)
 * @returns Test configuration with baseURL, apiURL, and network info
 *
 * @example
 * ```ts
 * // In playwright.config.ts
 * import { getTestConfig } from '@jejunetwork/config/test-config'
 *
 * const config = getTestConfig('dws')
 *
 * export default defineConfig({
 *   use: { baseURL: config.baseURL },
 *   webServer: config.skipWebServer ? undefined : {
 *     command: 'bun run dev',
 *     url: config.baseURL,
 *   }
 * })
 * ```
 */
export function getTestConfig(
  app: AppName,
  networkOverride?: NetworkType,
): TestConfig {
  const network = networkOverride ?? getCurrentNetwork()
  const isRemote = network !== 'localnet'
  const services = getServicesConfig(network)

  let baseURL: string
  let apiURL: string

  if (isRemote) {
    // Remote network (testnet/mainnet) - use deployed URLs
    baseURL = getRemoteFrontendURL(app, network as 'testnet' | 'mainnet')
    apiURL = getRemoteApiURL(app, network as 'testnet' | 'mainnet')
  } else {
    // Localnet - use local ports
    const frontendPort = LOCAL_FRONTEND_PORTS[app]
    const apiPort = LOCAL_API_PORTS[app]
    baseURL = `http://localhost:${frontendPort}`
    apiURL = `http://localhost:${apiPort}`
  }

  return {
    baseURL,
    apiURL,
    network,
    isRemote,
    skipWebServer: isRemote || process.env.SKIP_WEBSERVER === '1', // Skip when testing remote OR when env is set
    chainId: CHAIN_IDS[network],
    rpcURL: services.rpc.l2,
  }
}

/**
 * Check if a remote service is accessible.
 * Useful for preflight checks before running tests.
 *
 * @param url - URL to check
 * @param timeout - Timeout in milliseconds (default: 10000)
 * @returns true if service responded with 2xx/3xx status
 */
export async function checkServiceHealth(
  url: string,
  timeout = 10000,
): Promise<boolean> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)

  const response = await fetch(url, {
    method: 'GET',
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutId))

  return response.ok || response.status < 400
}

/**
 * Verify all required services for an app are accessible.
 * Call this before running tests against remote networks.
 *
 * @param app - The app to verify
 * @param network - Target network
 * @throws Error if required services are not accessible
 */
export async function verifyTestnetServices(
  app: AppName,
  network: NetworkType = 'testnet',
): Promise<void> {
  if (network === 'localnet') {
    return // Skip verification for local
  }

  const config = getTestConfig(app, network)

  // Check frontend is accessible
  const frontendHealthy = await checkServiceHealth(config.baseURL)
  if (!frontendHealthy) {
    throw new Error(
      `Frontend not accessible for ${app} on ${network}: ${config.baseURL}\n` +
        `Make sure the app is deployed and accessible.`,
    )
  }

  // Check API is accessible (try /health endpoint)
  const apiHealthUrl = `${config.apiURL}/health`
  const apiHealthy = await checkServiceHealth(apiHealthUrl)
  if (!apiHealthy) {
    // Try base API URL as fallback
    const apiBaseHealthy = await checkServiceHealth(config.apiURL)
    if (!apiBaseHealthy) {
      throw new Error(
        `API not accessible for ${app} on ${network}: ${config.apiURL}\n` +
          `Make sure the backend is deployed and accessible.`,
      )
    }
  }

  // Check RPC is accessible
  const rpcHealthy = await checkRpcHealth(config.rpcURL)
  if (!rpcHealthy) {
    throw new Error(
      `RPC not accessible for ${network}: ${config.rpcURL}\n` +
        `Make sure the chain is running and accessible.`,
    )
  }
}

/**
 * Check if an RPC endpoint is healthy.
 */
async function checkRpcHealth(rpcUrl: string): Promise<boolean> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), 10000)

  const response = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_chainId',
      params: [],
      id: 1,
    }),
    signal: controller.signal,
  }).finally(() => clearTimeout(timeoutId))

  if (!response.ok) return false

  const data = (await response.json()) as { result?: string; error?: unknown }
  return Boolean(data.result && !data.error)
}

/**
 * Get environment variables to set for test processes.
 * These ensure child processes (like playwright) use the correct network.
 */
export function getTestEnvVars(network: NetworkType): Record<string, string> {
  const services = getServicesConfig(network)

  return {
    JEJU_NETWORK: network,
    RPC_URL: services.rpc.l2,
    JEJU_RPC_URL: services.rpc.l2,
    L2_RPC_URL: services.rpc.l2,
    L1_RPC_URL: services.rpc.l1,
    WS_URL: services.rpc.ws,
    CHAIN_ID: String(CHAIN_IDS[network]),
    INDEXER_URL: services.indexer.graphql,
    EXPLORER_URL: services.explorer,
    // Skip local webserver when testing remote
    SKIP_WEBSERVER: network !== 'localnet' ? '1' : '',
  }
}
