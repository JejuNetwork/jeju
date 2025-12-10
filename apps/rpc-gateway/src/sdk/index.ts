/**
 * RPC Gateway SDK
 * Client library for accessing Jeju RPC Gateway
 * 
 * Usage:
 *   import { createRPCClient } from '@jeju/rpc-gateway/sdk';
 *   const client = createRPCClient({ apiKey: 'jrpc_...' });
 *   const result = await client.request(1, 'eth_blockNumber', []);
 */

import { ethers } from 'ethers';

// ============================================================================
// Types
// ============================================================================

export interface RPCClientConfig {
  gatewayUrl?: string;
  apiKey?: string;
  walletAddress?: string;
  timeout?: number;
  maxRetries?: number;
}

export interface JsonRpcRequest {
  jsonrpc: string;
  id: number | string;
  method: string;
  params?: unknown[];
}

export interface JsonRpcResponse<T = unknown> {
  jsonrpc: string;
  id: number | string;
  result?: T;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface ChainInfo {
  chainId: number;
  name: string;
  shortName: string;
  rpcEndpoint: string;
  explorerUrl: string;
  isTestnet: boolean;
  nativeCurrency: {
    name: string;
    symbol: string;
    decimals: number;
  };
}

export interface RateLimitInfo {
  tier: string;
  limit: number | string;
  remaining: number | string;
  resetAt: number;
}

// ============================================================================
// Constants
// ============================================================================

const DEFAULT_GATEWAY_URL = process.env.JEJU_RPC_GATEWAY_URL || 'http://localhost:4004';
const DEFAULT_TIMEOUT = 30000;
const DEFAULT_MAX_RETRIES = 3;

// Fallback RPC providers (used if gateway is unavailable)
const FALLBACK_RPCS: Record<number, string[]> = {
  1: ['https://eth.llamarpc.com', 'https://rpc.ankr.com/eth'],
  8453: ['https://mainnet.base.org', 'https://base.llamarpc.com'],
  42161: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum.llamarpc.com'],
  10: ['https://mainnet.optimism.io', 'https://optimism.llamarpc.com'],
  11155111: ['https://ethereum-sepolia-rpc.publicnode.com'],
  84532: ['https://sepolia.base.org'],
};

// ============================================================================
// RPC Client
// ============================================================================

export class RPCClient {
  private config: Required<RPCClientConfig>;
  private requestId: number = 0;
  private gatewayAvailable: boolean = true;
  private lastGatewayCheck: number = 0;
  private readonly GATEWAY_CHECK_INTERVAL = 60000; // 1 minute

  constructor(config: RPCClientConfig = {}) {
    this.config = {
      gatewayUrl: config.gatewayUrl || DEFAULT_GATEWAY_URL,
      apiKey: config.apiKey || '',
      walletAddress: config.walletAddress || '',
      timeout: config.timeout || DEFAULT_TIMEOUT,
      maxRetries: config.maxRetries || DEFAULT_MAX_RETRIES,
    };
  }

  /**
   * Make an RPC request to a specific chain
   */
  async request<T = unknown>(
    chainId: number,
    method: string,
    params: unknown[] = []
  ): Promise<T> {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: ++this.requestId,
      method,
      params,
    };

    // Try gateway first
    if (await this.isGatewayAvailable()) {
      const response = await this.requestViaGateway<T>(chainId, request);
      if (!response.error) {
        return response.result as T;
      }
    }

    // Fall back to direct RPC
    const response = await this.requestViaFallback<T>(chainId, request);
    if (response.error) {
      throw new Error(`RPC Error: ${response.error.message}`);
    }
    return response.result as T;
  }

  /**
   * Make request via Jeju RPC Gateway
   */
  private async requestViaGateway<T>(
    chainId: number,
    request: JsonRpcRequest
  ): Promise<JsonRpcResponse<T>> {
    const url = `${this.config.gatewayUrl}/v1/rpc/${chainId}`;
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };

    if (this.config.apiKey) {
      headers['X-Api-Key'] = this.config.apiKey;
    }
    if (this.config.walletAddress) {
      headers['X-Wallet-Address'] = this.config.walletAddress;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      if (response.status === 429) {
        // Rate limited - could implement backoff here
        throw new Error('Rate limit exceeded');
      }
      throw new Error(`Gateway error: ${response.status}`);
    }

    return response.json() as Promise<JsonRpcResponse<T>>;
  }

  /**
   * Make request via fallback RPC
   */
  private async requestViaFallback<T>(
    chainId: number,
    request: JsonRpcRequest
  ): Promise<JsonRpcResponse<T>> {
    const fallbacks = FALLBACK_RPCS[chainId];
    if (!fallbacks || fallbacks.length === 0) {
      throw new Error(`No fallback RPC for chain ${chainId}`);
    }

    let lastError: Error | null = null;

    for (const rpcUrl of fallbacks) {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), this.config.timeout);

      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (response.ok) {
        return response.json() as Promise<JsonRpcResponse<T>>;
      }
      lastError = new Error(`Fallback ${rpcUrl} failed: ${response.status}`);
    }

    throw lastError || new Error('All fallback RPCs failed');
  }

  /**
   * Check if gateway is available
   */
  private async isGatewayAvailable(): Promise<boolean> {
    const now = Date.now();
    if (now - this.lastGatewayCheck < this.GATEWAY_CHECK_INTERVAL) {
      return this.gatewayAvailable;
    }

    this.lastGatewayCheck = now;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const response = await fetch(`${this.config.gatewayUrl}/health`, {
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    this.gatewayAvailable = response.ok;
    return this.gatewayAvailable;
  }

  /**
   * Get all supported chains
   */
  async getChains(): Promise<ChainInfo[]> {
    const response = await fetch(`${this.config.gatewayUrl}/v1/chains`);
    if (!response.ok) throw new Error('Failed to fetch chains');
    const data = await response.json() as { chains: ChainInfo[] };
    return data.chains;
  }

  /**
   * Get rate limit info
   */
  async getRateLimits(): Promise<RateLimitInfo> {
    const headers: Record<string, string> = {};
    if (this.config.apiKey) headers['X-Api-Key'] = this.config.apiKey;
    if (this.config.walletAddress) headers['X-Wallet-Address'] = this.config.walletAddress;

    const response = await fetch(`${this.config.gatewayUrl}/v1/usage`, { headers });
    if (!response.ok) throw new Error('Failed to fetch rate limits');
    return response.json() as Promise<RateLimitInfo>;
  }

  /**
   * Create an ethers provider for a chain
   */
  createProvider(chainId: number): ethers.JsonRpcProvider {
    const url = `${this.config.gatewayUrl}/v1/rpc/${chainId}`;
    return new ethers.JsonRpcProvider(url, chainId, {
      staticNetwork: true,
      batchMaxCount: 10,
    });
  }
}

// ============================================================================
// Factory Function
// ============================================================================

/**
 * Create an RPC client
 */
export function createRPCClient(config?: RPCClientConfig): RPCClient {
  return new RPCClient(config);
}

/**
 * Create a simple ethers provider using the gateway
 */
export function createGatewayProvider(
  chainId: number,
  config?: RPCClientConfig
): ethers.JsonRpcProvider {
  const client = createRPCClient(config);
  return client.createProvider(chainId);
}

// ============================================================================
// Internal App Helper
// ============================================================================

/**
 * Get RPC client configured for internal use (unlimited access)
 */
export function getInternalRPCClient(): RPCClient {
  const internalKey = process.env.JEJU_INTERNAL_RPC_KEY;
  return createRPCClient({
    apiKey: internalKey,
    walletAddress: process.env.JEJU_INTERNAL_WALLET,
  });
}

// ============================================================================
// Cloud Integration
// ============================================================================

/**
 * Cloud RPC configuration for use in cloud apps
 */
export const CLOUD_RPC_CONFIG = {
  gatewayUrl: process.env.JEJU_RPC_GATEWAY_URL || 'http://localhost:4004',
  // Cloud apps use unlimited internal access
  internalApiKey: process.env.JEJU_INTERNAL_RPC_KEY || '',
  
  // Supported chains for cloud apps
  chains: {
    jeju: 420691,
    jejuTestnet: 420690,
    ethereum: 1,
    sepolia: 11155111,
    base: 8453,
    baseSepolia: 84532,
    arbitrum: 42161,
    arbitrumSepolia: 421614,
    optimism: 10,
    optimismSepolia: 11155420,
  },
  
  // RPC endpoints
  endpoints: {
    jeju: '/v1/rpc/420691',
    jejuTestnet: '/v1/rpc/420690',
    ethereum: '/v1/rpc/1',
    base: '/v1/rpc/8453',
    arbitrum: '/v1/rpc/42161',
    optimism: '/v1/rpc/10',
  },
};

export default RPCClient;
