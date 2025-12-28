import { getCurrentNetwork, getRpcUrl } from '@jejunetwork/config'
import {
  type Address,
  type Chain,
  createPublicClient,
  formatEther,
  type Hex,
  http,
  type PublicClient,
  type Transport,
} from 'viem'
import { arbitrum, base, bsc, mainnet, optimism } from 'viem/chains'
import { getEnvOrDefault } from '../../../lib/env'

// Supported chains - unified view, no chain switching
export const SUPPORTED_CHAINS = {
  1: { ...mainnet, name: 'Ethereum' },
  8453: { ...base, name: 'Base' },
  42161: { ...arbitrum, name: 'Arbitrum' },
  10: { ...optimism, name: 'Optimism' },
  56: { ...bsc, name: 'BSC' },
} as const

export type SupportedChainId = keyof typeof SUPPORTED_CHAINS

// Type guard to check if a number is a valid SupportedChainId
export function isSupportedChainId(
  chainId: number,
): chainId is SupportedChainId {
  return chainId in SUPPORTED_CHAINS
}

// Get all supported chain IDs as properly typed array
export function getSupportedChainIds(): SupportedChainId[] {
  return Object.keys(SUPPORTED_CHAINS).map(Number).filter(isSupportedChainId)
}

// Network RPC endpoints - use config with PUBLIC_ env override
const JEJU_RPC_BASE = getEnvOrDefault(
  'PUBLIC_JEJU_RPC_URL',
  getRpcUrl(getCurrentNetwork()),
)

export function getNetworkRpc(chainId: SupportedChainId): string {
  const chainNames: Record<SupportedChainId, string> = {
    1: 'eth',
    8453: 'base',
    42161: 'arbitrum',
    10: 'optimism',
    56: 'bsc',
  }
  return `${JEJU_RPC_BASE}/${chainNames[chainId]}`
}

// Cache value types for RPC responses
type CacheableValue = bigint | string | number | boolean

interface CacheEntry<T extends CacheableValue> {
  data: T
  timestamp: number
}

// Maximum cache entries to prevent DoS via unbounded growth
const MAX_CACHE_ENTRIES = 500

class RPCService {
  private clients: Map<SupportedChainId, PublicClient<Transport, Chain>> =
    new Map()
  private requestCache: Map<string, CacheEntry<CacheableValue>> = new Map()
  private cacheKeyOrder: string[] = [] // Track insertion order for LRU eviction
  private cacheTTL = 5000 // 5 seconds

  getClient(chainId: SupportedChainId): PublicClient<Transport, Chain> {
    if (!this.clients.has(chainId)) {
      const chain = SUPPORTED_CHAINS[chainId]
      const client = createPublicClient({
        chain,
        transport: http(getNetworkRpc(chainId), {
          timeout: 10000,
          retryCount: 2,
          onFetchRequest: (request) => {
            // Add X402 payment headers if needed
            const headers = new Headers(request.headers)
            headers.set('X-Network-Client', 'wallet')
            return new Request(request.url, { ...request, headers })
          },
        }),
      })
      // Store with appropriate type - the chain differences don't matter for our use
      this.clients.set(chainId, client as PublicClient<Transport, Chain>)
    }
    const client = this.clients.get(chainId)
    if (!client) {
      throw new Error(`Failed to create client for chain ${chainId}`)
    }
    return client
  }

  async getBalance(
    chainId: SupportedChainId,
    address: Address,
  ): Promise<bigint> {
    const cacheKey = `balance:${chainId}:${address}`
    const cached = this.getFromCache<bigint>(cacheKey)
    if (cached !== null) return cached

    const client = this.getClient(chainId)
    const balance = await client.getBalance({ address })
    this.setCache(cacheKey, balance)
    return balance
  }

  async getTokenBalance(
    chainId: SupportedChainId,
    tokenAddress: Address,
    ownerAddress: Address,
  ): Promise<bigint> {
    const cacheKey = `tokenBalance:${chainId}:${tokenAddress}:${ownerAddress}`
    const cached = this.getFromCache<bigint>(cacheKey)
    if (cached !== null) return cached

    const client = this.getClient(chainId)
    // ABI specifies uint256 return type, so result is bigint
    const ERC20_BALANCE_ABI = [
      {
        name: 'balanceOf',
        type: 'function',
        inputs: [{ name: 'account', type: 'address' }],
        outputs: [{ name: 'balance', type: 'uint256' }],
        stateMutability: 'view',
      },
    ] as const
    const balance = await client.readContract({
      address: tokenAddress,
      abi: ERC20_BALANCE_ABI,
      functionName: 'balanceOf',
      args: [ownerAddress],
    })

    this.setCache(cacheKey, balance)
    return balance
  }

  async getGasPrice(chainId: SupportedChainId): Promise<bigint> {
    const cacheKey = `gasPrice:${chainId}`
    const cached = this.getFromCache<bigint>(cacheKey)
    if (cached !== null) return cached

    const client = this.getClient(chainId)
    const gasPrice = await client.getGasPrice()
    this.setCache(cacheKey, gasPrice, 3000) // 3s cache for gas
    return gasPrice
  }

  async estimateGas(
    chainId: SupportedChainId,
    tx: { to: Address; from: Address; data?: Hex; value?: bigint },
  ): Promise<bigint> {
    const client = this.getClient(chainId)
    return client.estimateGas(tx)
  }

  async sendRawTransaction(
    chainId: SupportedChainId,
    signedTx: Hex,
  ): Promise<Hex> {
    const client = this.getClient(chainId)
    return client.sendRawTransaction({ serializedTransaction: signedTx })
  }

  async getTransaction(chainId: SupportedChainId, hash: Hex) {
    const client = this.getClient(chainId)
    return client.getTransaction({ hash })
  }

  async getTransactionReceipt(chainId: SupportedChainId, hash: Hex) {
    const client = this.getClient(chainId)
    return client.getTransactionReceipt({ hash })
  }

  async waitForTransaction(chainId: SupportedChainId, hash: Hex) {
    const client = this.getClient(chainId)
    return client.waitForTransactionReceipt({ hash })
  }

  async call(chainId: SupportedChainId, params: { to: Address; data: Hex }) {
    const client = this.getClient(chainId)
    return client.call(params)
  }

  // Get balances across all chains for an address
  async getAllBalances(
    address: Address,
  ): Promise<
    { chainId: SupportedChainId; balance: bigint; formatted: string }[]
  > {
    const chainIds = getSupportedChainIds()
    const results = await Promise.all(
      chainIds.map(async (chainId) => {
        const balance = await this.getBalance(chainId, address)
        return { chainId, balance, formatted: formatEther(balance) }
      }),
    )
    return results
  }

  private getFromCache<T extends CacheableValue>(key: string): T | null {
    const entry = this.requestCache.get(key)
    if (entry && Date.now() - entry.timestamp < this.cacheTTL) {
      // Safe: callers store and retrieve the same type by key convention
      // The cache is private, so type safety is maintained by class invariants
      return entry.data as T
    }
    // Remove expired entry
    if (entry) {
      this.requestCache.delete(key)
      const orderIdx = this.cacheKeyOrder.indexOf(key)
      if (orderIdx >= 0) {
        this.cacheKeyOrder.splice(orderIdx, 1)
      }
    }
    return null
  }

  private setCache<T extends CacheableValue>(
    key: string,
    data: T,
    _ttl?: number,
  ): void {
    // If key already exists, remove from order tracking first
    if (this.requestCache.has(key)) {
      const orderIdx = this.cacheKeyOrder.indexOf(key)
      if (orderIdx >= 0) {
        this.cacheKeyOrder.splice(orderIdx, 1)
      }
    }

    // Evict oldest entries if at capacity
    while (
      this.requestCache.size >= MAX_CACHE_ENTRIES &&
      this.cacheKeyOrder.length > 0
    ) {
      const oldestKey = this.cacheKeyOrder.shift()
      if (oldestKey) {
        this.requestCache.delete(oldestKey)
      }
    }

    // Add new entry
    this.requestCache.set(key, { data, timestamp: Date.now() })
    this.cacheKeyOrder.push(key)
  }
}

export const rpcService = new RPCService()
export { RPCService }
