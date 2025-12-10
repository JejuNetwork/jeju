/**
 * RPC Proxy Service
 * Forwards JSON-RPC requests to appropriate chain endpoints with failover
 */

import { CHAINS, getChain, isChainSupported, type ChainConfig } from '../config/chains';

interface JsonRpcRequest {
  jsonrpc: string;
  id: number | string;
  method: string;
  params?: unknown[];
}

interface JsonRpcResponse {
  jsonrpc: string;
  id: number | string;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

interface ProxyResult {
  response: JsonRpcResponse;
  latencyMs: number;
  endpoint: string;
  usedFallback: boolean;
}

// Track endpoint health
interface EndpointHealth {
  failures: number;
  lastFailure: number;
  isHealthy: boolean;
}

const endpointHealth = new Map<string, EndpointHealth>();

// Mark endpoint as unhealthy after 3 failures in 5 minutes
const FAILURE_THRESHOLD = 3;
const HEALTH_WINDOW_MS = 5 * 60 * 1000;
const HEALTH_RECOVERY_MS = 60 * 1000; // Try again after 1 minute

/**
 * Check if an endpoint is healthy
 */
function isEndpointHealthy(url: string): boolean {
  const health = endpointHealth.get(url);
  if (!health) return true;

  // Recover after timeout
  if (!health.isHealthy && Date.now() - health.lastFailure > HEALTH_RECOVERY_MS) {
    health.isHealthy = true;
    health.failures = 0;
    return true;
  }

  return health.isHealthy;
}

/**
 * Record endpoint failure
 */
function recordFailure(url: string): void {
  let health = endpointHealth.get(url);
  if (!health) {
    health = { failures: 0, lastFailure: 0, isHealthy: true };
    endpointHealth.set(url, health);
  }

  const now = Date.now();
  
  // Reset if outside window
  if (now - health.lastFailure > HEALTH_WINDOW_MS) {
    health.failures = 0;
  }

  health.failures++;
  health.lastFailure = now;

  if (health.failures >= FAILURE_THRESHOLD) {
    health.isHealthy = false;
    console.warn(`[RPC Proxy] Endpoint marked unhealthy: ${url}`);
  }
}

/**
 * Record endpoint success
 */
function recordSuccess(url: string): void {
  const health = endpointHealth.get(url);
  if (health) {
    health.failures = 0;
    health.isHealthy = true;
  }
}

/**
 * Make a JSON-RPC request to an endpoint
 */
async function makeRpcRequest(
  url: string,
  request: JsonRpcRequest,
  timeout: number = 30000
): Promise<JsonRpcResponse> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(request),
    signal: controller.signal,
  });

  clearTimeout(timeoutId);

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
  }

  return response.json() as Promise<JsonRpcResponse>;
}

/**
 * Proxy a JSON-RPC request to the appropriate chain
 */
export async function proxyRequest(
  chainId: number,
  request: JsonRpcRequest
): Promise<ProxyResult> {
  if (!isChainSupported(chainId)) {
    return {
      response: {
        jsonrpc: '2.0',
        id: request.id,
        error: {
          code: -32001,
          message: `Unsupported chain: ${chainId}`,
        },
      },
      latencyMs: 0,
      endpoint: '',
      usedFallback: false,
    };
  }

  const chain = getChain(chainId);
  const endpoints = [chain.rpcUrl, ...chain.fallbackRpcs].filter(isEndpointHealthy);

  if (endpoints.length === 0) {
    // All endpoints unhealthy, try primary anyway
    endpoints.push(chain.rpcUrl);
  }

  let lastError: Error | null = null;
  let usedFallback = false;

  for (let i = 0; i < endpoints.length; i++) {
    const endpoint = endpoints[i];
    const startTime = Date.now();

    try {
      const response = await makeRpcRequest(endpoint, request);
      recordSuccess(endpoint);

      return {
        response,
        latencyMs: Date.now() - startTime,
        endpoint,
        usedFallback: i > 0,
      };
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
      recordFailure(endpoint);
      usedFallback = true;
      console.error(`[RPC Proxy] ${chain.name} endpoint failed: ${endpoint}`, lastError.message);
    }
  }

  // All endpoints failed
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
    usedFallback,
  };
}

/**
 * Proxy a batch of JSON-RPC requests
 */
export async function proxyBatchRequest(
  chainId: number,
  requests: JsonRpcRequest[]
): Promise<ProxyResult[]> {
  // For simplicity, execute in parallel
  // In production, could batch to single request
  return Promise.all(requests.map(req => proxyRequest(chainId, req)));
}

/**
 * Get health status of all endpoints
 */
export function getEndpointHealth(): Record<string, { healthy: boolean; failures: number }> {
  const status: Record<string, { healthy: boolean; failures: number }> = {};

  for (const chain of Object.values(CHAINS)) {
    const urls = [chain.rpcUrl, ...chain.fallbackRpcs];
    for (const url of urls) {
      const health = endpointHealth.get(url);
      status[url] = {
        healthy: health?.isHealthy ?? true,
        failures: health?.failures ?? 0,
      };
    }
  }

  return status;
}

/**
 * Get chain statistics
 */
export function getChainStats(): {
  supported: number;
  mainnet: number;
  testnet: number;
  chains: Array<{ chainId: number; name: string; isTestnet: boolean }>;
} {
  const chains = Object.values(CHAINS);
  return {
    supported: chains.length,
    mainnet: chains.filter(c => !c.isTestnet).length,
    testnet: chains.filter(c => c.isTestnet).length,
    chains: chains.map(c => ({
      chainId: c.chainId,
      name: c.name,
      isTestnet: c.isTestnet,
    })),
  };
}
