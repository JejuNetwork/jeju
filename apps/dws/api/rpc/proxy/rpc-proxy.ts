/**
 * RPC Proxy Service
 *
 * Routes JSON-RPC requests to appropriate chain endpoints.
 *
 * Priority Order:
 * 1. DWS-provisioned nodes (fully decentralized)
 * 2. Configured external RPCs (fallback only if DWS nodes unavailable)
 *
 * The goal is to be fully permissionless - DWS nodes are provisioned on-demand
 * and registered on-chain. External RPCs are only used as bootstrap/fallback.
 */

import {
  RPC_CHAINS as CHAINS,
  getRpcChain as getChain,
  isRpcChainSupported as isChainSupported,
} from '@jejunetwork/config'
import {
  type EndpointHealth,
  type JsonRpcRequest,
  type JsonRpcResponse,
  JsonRpcResponseSchema,
  type ProxyResult,
} from '@jejunetwork/types'
import { getExternalRPCNodeService } from '../../external-chains'

export type { JsonRpcRequest, JsonRpcResponse }

const endpointHealth = new Map<string, EndpointHealth>()
const FAILURE_THRESHOLD = 3
const HEALTH_WINDOW_MS = 5 * 60 * 1000
const HEALTH_RECOVERY_MS = 60 * 1000

function isEndpointHealthy(url: string): boolean {
  const health = endpointHealth.get(url)
  if (!health) return true
  if (
    !health.isHealthy &&
    Date.now() - health.lastFailure > HEALTH_RECOVERY_MS
  ) {
    health.isHealthy = true
    health.failures = 0
    return true
  }
  return health.isHealthy
}

function recordFailure(url: string): void {
  let health = endpointHealth.get(url)
  if (!health) {
    health = { failures: 0, lastFailure: 0, isHealthy: true }
    endpointHealth.set(url, health)
  }
  const now = Date.now()
  if (now - health.lastFailure > HEALTH_WINDOW_MS) health.failures = 0
  health.failures++
  health.lastFailure = now
  if (health.failures >= FAILURE_THRESHOLD) {
    health.isHealthy = false
    console.warn(`[RPC Proxy] Endpoint marked unhealthy: ${url}`)
  }
}

function recordSuccess(url: string): void {
  const health = endpointHealth.get(url)
  if (health) {
    health.failures = 0
    health.isHealthy = true
  }
}

async function makeRpcRequest(
  url: string,
  request: JsonRpcRequest,
  timeout = 30000,
): Promise<JsonRpcResponse> {
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeout)
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
    signal: controller.signal,
  })
  clearTimeout(timeoutId)
  if (!response.ok)
    throw new Error(`HTTP ${response.status}: ${response.statusText}`)
  return JsonRpcResponseSchema.parse(await response.json())
}

/**
 * Get available endpoints for a chain, prioritizing DWS-provisioned nodes
 */
function getEndpointsForChain(chainId: number): string[] {
  const chain = getChain(chainId)
  const endpoints: string[] = []

  // Priority 1: DWS-provisioned nodes (fully decentralized)
  const externalNodes = getExternalRPCNodeService()
  const dwsEndpoint = externalNodes.getRpcEndpointByChainId(chainId)
  if (dwsEndpoint && isEndpointHealthy(dwsEndpoint)) {
    endpoints.push(dwsEndpoint)
  }

  // Priority 2: Configured external RPCs (fallback)
  // Only used if DWS nodes are not available
  if (endpoints.length === 0) {
    const fallbackEndpoints = [chain.rpcUrl, ...chain.fallbackRpcs].filter(
      isEndpointHealthy,
    )
    endpoints.push(...fallbackEndpoints)
  }

  return endpoints
}

export async function proxyRequest(
  chainId: number,
  request: JsonRpcRequest,
): Promise<ProxyResult> {
  if (!isChainSupported(chainId)) {
    return {
      response: {
        jsonrpc: '2.0',
        id: request.id,
        error: { code: -32001, message: `Unsupported chain: ${chainId}` },
      },
      latencyMs: 0,
      endpoint: '',
      usedFallback: false,
    }
  }

  const chain = getChain(chainId)
  const endpoints = getEndpointsForChain(chainId)

  if (endpoints.length === 0) {
    // No endpoints available - return error
    // This is intentional: we don't want to silently fall back
    console.warn(
      `[RPC Proxy] No endpoints available for ${chain.name} (chainId: ${chainId})`,
    )
    return {
      response: {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32603,
          message: `No RPC nodes available for ${chain.name}. Provision nodes via DWS.`,
        },
      },
      latencyMs: 0,
      endpoint: '',
      usedFallback: false,
    }
  }

  let lastError: Error | null = null
  const usedDWS = endpoints[0].includes('localhost') ?? false

  for (let i = 0; i < endpoints.length; i++) {
    const endpoint = endpoints[i]
    const startTime = Date.now()
    try {
      const response = await makeRpcRequest(endpoint, request)
      recordSuccess(endpoint)
      return {
        response,
        latencyMs: Date.now() - startTime,
        endpoint,
        usedFallback: i > 0 || !usedDWS,
      }
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error))
      recordFailure(endpoint)
      console.error(
        `[RPC Proxy] ${chain.name} endpoint failed: ${endpoint}`,
        lastError.message,
      )
    }
  }

  return {
    response: {
      jsonrpc: '2.0',
      id: request.id,
      error: {
        code: -32603,
        message: `All RPC endpoints failed for ${chain.name}`,
        data: lastError?.message,
      },
    },
    latencyMs: 0,
    endpoint: '',
    usedFallback: true,
  }
}

export async function proxyBatchRequest(
  chainId: number,
  requests: JsonRpcRequest[],
): Promise<ProxyResult[]> {
  return Promise.all(requests.map((req) => proxyRequest(chainId, req)))
}

export function getEndpointHealth(): Record<
  string,
  { healthy: boolean; failures: number }
> {
  const status: Record<string, { healthy: boolean; failures: number }> = {}
  for (const chain of Object.values(CHAINS)) {
    const urls = [chain.rpcUrl, ...chain.fallbackRpcs]
    for (const url of urls) {
      const health = endpointHealth.get(url)
      status[url] = {
        healthy: health?.isHealthy ?? true,
        failures: health?.failures ?? 0,
      }
    }
  }
  return status
}

export function getChainStats(): {
  supported: number
  mainnet: number
  testnet: number
  chains: Array<{ chainId: number; name: string; isTestnet: boolean }>
} {
  const chains = Object.values(CHAINS)
  return {
    supported: chains.length,
    mainnet: chains.filter((c) => !c.isTestnet).length,
    testnet: chains.filter((c) => c.isTestnet).length,
    chains: chains.map((c) => ({
      chainId: c.chainId,
      name: c.name,
      isTestnet: c.isTestnet,
    })),
  }
}

/**
 * Get DWS-provisioned node status for all chains
 */
export function getDWSNodeStatus(): {
  evmNodesReady: boolean
  chains: Record<
    number,
    { hasDWSNode: boolean; endpoint: string | null; healthy: boolean }
  >
} {
  const externalNodes = getExternalRPCNodeService()
  const evmChainIds = [1, 42161, 10, 8453] // ETH, ARB, OP, BASE
  const chains: Record<
    number,
    { hasDWSNode: boolean; endpoint: string | null; healthy: boolean }
  > = {}

  for (const chainId of evmChainIds) {
    const endpoint = externalNodes.getRpcEndpointByChainId(chainId)
    chains[chainId] = {
      hasDWSNode: !!endpoint,
      endpoint,
      healthy: endpoint ? isEndpointHealthy(endpoint) : false,
    }
  }

  return {
    evmNodesReady: externalNodes.areEVMNodesReady(),
    chains,
  }
}
