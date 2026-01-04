import { getRpcGatewayUrl, isProductionEnv } from '@jejunetwork/config'
import { getSecretVault } from '@jejunetwork/kms'
import { expectValid, type JsonValue } from '@jejunetwork/types'
import {
  type Chain,
  createPublicClient,
  http,
  type PublicClient,
  zeroAddress,
} from 'viem'
import { z } from 'zod'
import { RpcChainsResponseSchema, type RpcParamValue } from './validation'

// Validation schemas for RPC responses
const JsonRpcResponseSchema = z.object({
  jsonrpc: z.string(),
  id: z.union([z.number(), z.string()]),
  result: z.unknown().optional(),
  error: z
    .object({
      code: z.number(),
      message: z.string(),
      data: z.unknown().optional(),
    })
    .optional(),
})

const RateLimitInfoSchema = z.object({
  tier: z.string(),
  limit: z.union([z.number(), z.string()]).optional(),
  remaining: z.union([z.number(), z.string()]).optional(),
  resetAt: z.union([z.number(), z.string()]).optional(),
})

export interface RPCClientConfig {
  gatewayUrl?: string
  apiKey?: string
  walletAddress?: string
  timeout?: number
  maxRetries?: number
}

export interface JsonRpcRequest {
  jsonrpc: string
  id: number | string
  method: string
  params?: RpcParamValue[]
}

export interface JsonRpcResponse<T = JsonValue> {
  jsonrpc: string
  id: number | string
  result?: T
  error?: { code: number; message: string; data?: JsonValue }
}

export interface ChainInfo {
  chainId: number
  name: string
  shortName: string
  rpcEndpoint: string
  explorerUrl: string
  isTestnet: boolean
  nativeCurrency: { name: string; symbol: string; decimals: number }
}

export interface RateLimitInfo {
  tier: string
  limit?: number | string
  remaining?: number | string
  resetAt?: number | string
}

const DEFAULT_GATEWAY_URL = getRpcGatewayUrl()
const DEFAULT_TIMEOUT = 30000
const DEFAULT_MAX_RETRIES = 3

export class RPCClient {
  private config: Required<RPCClientConfig>
  private requestId = 0

  constructor(config: RPCClientConfig = {}) {
    this.config = {
      gatewayUrl: config.gatewayUrl || DEFAULT_GATEWAY_URL,
      apiKey: config.apiKey ?? '',
      walletAddress: config.walletAddress ?? '',
      timeout: config.timeout || DEFAULT_TIMEOUT,
      maxRetries: config.maxRetries || DEFAULT_MAX_RETRIES,
    }
  }

  async request<T = JsonValue>(
    chainId: number,
    method: string,
    params: RpcParamValue[] = [],
  ): Promise<T> {
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id: ++this.requestId,
      method,
      params,
    }

    const response = await this.requestViaGateway<T>(chainId, request)
    if (response.error) {
      throw new Error(`RPC Error: ${response.error.message}`)
    }
    if (response.result === undefined) {
      throw new Error(`RPC response missing result for method ${method}`)
    }
    return response.result
  }

  private async requestViaGateway<T>(
    chainId: number,
    request: JsonRpcRequest,
  ): Promise<JsonRpcResponse<T>> {
    const url = `${this.config.gatewayUrl}/v1/rpc/${chainId}`
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }

    if (this.config.apiKey) headers['X-Api-Key'] = this.config.apiKey
    if (this.config.walletAddress)
      headers['X-Wallet-Address'] = this.config.walletAddress

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.config.timeout)

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(request),
      signal: controller.signal,
    })

    clearTimeout(timeoutId)

    if (!response.ok) {
      if (response.status === 429) throw new Error('Rate limit exceeded')
      throw new Error(`Gateway error: ${response.status}`)
    }

    const data = JsonRpcResponseSchema.parse(await response.json())
    return data as JsonRpcResponse<T>
  }

  async getChains(): Promise<ChainInfo[]> {
    const response = await fetch(`${this.config.gatewayUrl}/v1/chains`)
    if (!response.ok) throw new Error('Failed to fetch chains')
    const data = expectValid(
      RpcChainsResponseSchema,
      await response.json(),
      'chains response',
    )
    return data.chains
  }

  async getRateLimits(): Promise<RateLimitInfo> {
    const headers: Record<string, string> = {}
    if (this.config.apiKey) headers['X-Api-Key'] = this.config.apiKey
    if (this.config.walletAddress)
      headers['X-Wallet-Address'] = this.config.walletAddress

    const response = await fetch(`${this.config.gatewayUrl}/v1/usage`, {
      headers,
    })
    if (!response.ok) throw new Error('Failed to fetch rate limits')
    return RateLimitInfoSchema.parse(await response.json())
  }

  createClient(chainId: number): PublicClient {
    const url = `${this.config.gatewayUrl}/v1/rpc/${chainId}`
    const chain = { id: chainId, name: 'custom' } as Chain
    return createPublicClient({
      chain,
      transport: http(url),
    }) as PublicClient
  }
}

export function createRPCClient(config?: RPCClientConfig): RPCClient {
  return new RPCClient(config)
}

export function createRpcGatewayClient(
  chainId: number,
  config?: RPCClientConfig,
): PublicClient {
  return createRPCClient(config).createClient(chainId)
}

/**
 * Get internal RPC API key from KMS vault
 *
 * SECURITY: Internal API keys are stored in KMS SecretVault.
 * In development, falls back to environment variable for local testing only.
 */
let cachedInternalApiKey: string | null = null
let internalApiKeyLoaded = false

async function getInternalApiKeyFromKMS(): Promise<string | null> {
  if (internalApiKeyLoaded) {
    return cachedInternalApiKey
  }

  try {
    const vault = getSecretVault()
    await vault.initialize()
    cachedInternalApiKey = await vault.getSecret(
      'internal-rpc-api-key',
      zeroAddress, // System accessor for internal API key
    )
    internalApiKeyLoaded = true
    return cachedInternalApiKey
  } catch {
    // In development only, allow falling back (but log warning)
    if (!isProductionEnv()) {
      console.warn(
        '[RPC] Internal API key not found in KMS vault. Internal RPC calls may fail.',
      )
      internalApiKeyLoaded = true
      return null
    }
    throw new Error('Internal RPC API key not configured in KMS vault')
  }
}

/**
 * Create an RPC client with internal API key from KMS
 *
 * SECURITY: This function is async because it retrieves the API key from KMS.
 * The key is cached after first retrieval.
 */
export async function getInternalRPCClient(): Promise<RPCClient> {
  const apiKey = await getInternalApiKeyFromKMS()
  return createRPCClient({
    apiKey: apiKey ?? undefined,
    walletAddress: undefined,
  })
}

/**
 * @deprecated Use getInternalRPCClient() instead - this returns null API key
 * Synchronous version that doesn't fetch from KMS (for backwards compat during migration)
 */
export function getInternalRPCClientSync(): RPCClient {
  if (isProductionEnv()) {
    console.warn(
      '[RPC] getInternalRPCClientSync() called in production - use async getInternalRPCClient()',
    )
  }
  return createRPCClient({
    apiKey: cachedInternalApiKey ?? undefined,
    walletAddress: undefined,
  })
}

export const CLOUD_RPC_CONFIG = {
  gatewayUrl: getRpcGatewayUrl(),
  // SECURITY: API key is no longer exposed in static config
  // Use getInternalRPCClient() to get a client with the API key
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
  endpoints: {
    jeju: '/v1/rpc/420691',
    jejuTestnet: '/v1/rpc/420690',
    ethereum: '/v1/rpc/1',
    base: '/v1/rpc/8453',
    arbitrum: '/v1/rpc/42161',
    optimism: '/v1/rpc/10',
  },
}

export default RPCClient
