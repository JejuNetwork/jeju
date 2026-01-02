import { getCacheClient } from '@jejunetwork/cache'
import {
  RPC_CHAINS as CHAINS,
  getRpcChain as getChain,
  isRpcChainSupported as isChainSupported,
} from '@jejunetwork/config'
import type {
  EndpointHealth,
  JsonRpcRequest,
  JsonRpcResponse,
  ProxyResult,
} from '@jejunetwork/types'
import { JsonRpcResponseSchema } from '../../../lib/validation'

const endpointHealth = new Map<string, EndpointHealth>()
const FAILURE_THRESHOLD = 3
const HEALTH_WINDOW_MS = 5 * 60 * 1000
const HEALTH_RECOVERY_MS = 60 * 1000

// Cacheable RPC methods with their TTLs in seconds
const CACHEABLE_METHODS: Record<string, number> = {
  eth_chainId: 3600, // 1 hour - never changes
  net_version: 3600, // 1 hour - never changes
  eth_blockNumber: 2, // 2 seconds - changes frequently
  eth_gasPrice: 5, // 5 seconds - changes frequently
  eth_getCode: 3600, // 1 hour - contract code doesn't change
  eth_call: 15, // 15 seconds - depends on block
  eth_getBalance: 15, // 15 seconds
  eth_getStorageAt: 15, // 15 seconds
  eth_getTransactionCount: 15, // 15 seconds
}

// DWS cache for RPC responses
function getRpcCache() {
  return getCacheClient('gateway-rpc')
}

// Create cache key from request
function getCacheKey(chainId: number, request: JsonRpcRequest): string {
  const paramsHash = JSON.stringify(request.params ?? [])
  return `rpc:${chainId}:${request.method}:${paramsHash.slice(0, 64)}`
}

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
  const data = await response.json()
  const parsed = JsonRpcResponseSchema.safeParse(data)
  if (!parsed.success) {
    throw new Error(`Invalid JSON-RPC response: ${parsed.error.message}`)
  }
  return parsed.data as JsonRpcResponse
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

  // Check if method is cacheable
  const cacheTtl = CACHEABLE_METHODS[request.method]
  if (cacheTtl) {
    const cacheKey = getCacheKey(chainId, request)
    const cache = getRpcCache()

    const cached = await cache.get(cacheKey).catch(() => null)
    if (cached) {
      const cachedResponse = JSON.parse(cached) as JsonRpcResponse
      // Update the ID to match the request
      cachedResponse.id = request.id
      return {
        response: cachedResponse,
        latencyMs: 0,
        endpoint: 'cache',
        usedFallback: false,
      }
    }
  }

  const chain = getChain(chainId)
  const endpoints = [chain.rpcUrl, ...chain.fallbackRpcs].filter(
    isEndpointHealthy,
  )
  if (endpoints.length === 0) {
    throw new Error(`No healthy RPC endpoints available for ${chain.name}`)
  }

  let lastError: Error | null = null

  for (let i = 0; i < endpoints.length; i++) {
    const endpoint = endpoints[i]
    const startTime = Date.now()
    try {
      const response = await makeRpcRequest(endpoint, request)
      recordSuccess(endpoint)

      // Cache successful response if method is cacheable
      if (cacheTtl && !('error' in response)) {
        const cacheKey = getCacheKey(chainId, request)
        const cache = getRpcCache()
        cache.set(cacheKey, JSON.stringify(response), cacheTtl).catch(() => {})
      }

      return {
        response,
        latencyMs: Date.now() - startTime,
        endpoint,
        usedFallback: i > 0,
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
