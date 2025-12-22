/**
 * RPC Gateway SDK
 * Client library for accessing Network RPC Gateway
 */

import { getRpcGatewayUrl } from '@jejunetwork/config/ports'
import { type Chain, createPublicClient, http, type PublicClient } from 'viem'
import {
  expectValid,
  type JsonValue,
  RpcChainsResponseSchema,
  type RpcParamValue,
} from './validation.js'

export interface RPCClientConfig {
  gatewayUrl?: string
  apiKey?: string
  walletAddress?: string
  timeout?: number
  maxRetries?: number
}

/**
 * JSON-RPC request structure per JSON-RPC 2.0 spec.
 * Params can be any JSON-serializable values.
 */
export interface JsonRpcRequest {
  jsonrpc: string
  id: number | string
  method: string
  params?: RpcParamValue[]
}

/**
 * JSON-RPC response structure per JSON-RPC 2.0 spec.
 * Error data can be any JSON-serializable value per the spec.
 */
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
  limit: number | string
  remaining: number | string
  resetAt: number
}

const DEFAULT_GATEWAY_URL = getRpcGatewayUrl()
const DEFAULT_TIMEOUT = 30000
const DEFAULT_MAX_RETRIES = 3

const FALLBACK_RPCS: Record<number, string[]> = {
  1: ['https://eth.llamarpc.com', 'https://rpc.ankr.com/eth'],
  8453: ['https://mainnet.base.org', 'https://base.llamarpc.com'],
  42161: ['https://arb1.arbitrum.io/rpc', 'https://arbitrum.llamarpc.com'],
  10: ['https://mainnet.optimism.io', 'https://optimism.llamarpc.com'],
  11155111: ['https://ethereum-sepolia-rpc.publicnode.com'],
  84532: ['https://sepolia.base.org'],
}

export class RPCClient {
  private config: Required<RPCClientConfig>
  private requestId = 0
  private gatewayAvailable = true
  private lastGatewayCheck = 0
  private readonly GATEWAY_CHECK_INTERVAL = 60000

  constructor(config: RPCClientConfig = {}) {
    this.config = {
      gatewayUrl: config.gatewayUrl || DEFAULT_GATEWAY_URL,
      apiKey: config.apiKey || '',
      walletAddress: config.walletAddress || '',
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

    if (await this.isGatewayAvailable()) {
      const response = await this.requestViaGateway<T>(chainId, request)
      if (!response.error) {
        if (response.result === undefined) {
          throw new Error(`RPC response missing result for method ${method}`)
        }
        return response.result
      }
    }

    const response = await this.requestViaFallback<T>(chainId, request)
    if (response.error) throw new Error(`RPC Error: ${response.error.message}`)
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

    const data = await response.json()
    return data as JsonRpcResponse<T>
  }

  private async requestViaFallback<T>(
    chainId: number,
    request: JsonRpcRequest,
  ): Promise<JsonRpcResponse<T>> {
    const fallbacks = FALLBACK_RPCS[chainId]
    if (!fallbacks || fallbacks.length === 0)
      throw new Error(`No fallback RPC for chain ${chainId}`)

    let lastError: Error | null = null

    for (const rpcUrl of fallbacks) {
      const controller = new AbortController()
      const timeoutId = setTimeout(
        () => controller.abort(),
        this.config.timeout,
      )

      const response = await fetch(rpcUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(request),
        signal: controller.signal,
      })

      clearTimeout(timeoutId)

      if (response.ok) {
        const data = await response.json()
        return data as JsonRpcResponse<T>
      }
      lastError = new Error(`Fallback ${rpcUrl} failed: ${response.status}`)
    }

    throw lastError || new Error('All fallback RPCs failed')
  }

  private async isGatewayAvailable(): Promise<boolean> {
    const now = Date.now()
    if (now - this.lastGatewayCheck < this.GATEWAY_CHECK_INTERVAL)
      return this.gatewayAvailable

    this.lastGatewayCheck = now

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)

    const response = await fetch(`${this.config.gatewayUrl}/health`, {
      signal: controller.signal,
    })
    clearTimeout(timeoutId)

    this.gatewayAvailable = response.ok
    return this.gatewayAvailable
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
    const data = await response.json()
    return data as RateLimitInfo
  }

  createClient(chainId: number): PublicClient {
    const url = `${this.config.gatewayUrl}/v1/rpc/${chainId}`
    const chain = { id: chainId, name: 'custom' } as Chain
    return createPublicClient({
      chain,
      transport: http(url),
    })
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

export function getInternalRPCClient(): RPCClient {
  return createRPCClient({
    apiKey: process.env.JEJU_INTERNAL_RPC_KEY,
    walletAddress: process.env.JEJU_INTERNAL_WALLET,
  })
}

export const CLOUD_RPC_CONFIG = {
  gatewayUrl: getRpcGatewayUrl(),
  internalApiKey: process.env.JEJU_INTERNAL_RPC_KEY || '',
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
