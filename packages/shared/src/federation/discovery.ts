import { type Address, createPublicClient, http, type PublicClient } from 'viem'
import { z } from 'zod'
import { safeReadContract } from '../viem'
import {
  FEDERATED_LIQUIDITY_ABI,
  FEDERATED_SOLVER_ABI,
  NETWORK_REGISTRY_ABI,
} from './abis'

import type {
  DiscoveryConfig,
  FederatedSolver,
  NetworkInfo,
  NetworkLiquidity,
} from './types'

// Zod schemas for validating contract responses
const NetworkContractsSchema = z.object({
  identityRegistry: z.string(),
  solverRegistry: z.string(),
  inputSettler: z.string(),
  outputSettler: z.string(),
  liquidityVault: z.string(),
  governance: z.string(),
  oracle: z.string(),
})

const NetworkInfoSchema = z.object({
  chainId: z.union([z.number(), z.bigint()]).transform((v) => Number(v)),
  name: z.string(),
  rpcUrl: z.string(),
  explorerUrl: z.string(),
  wsUrl: z.string(),
  operator: z.string(),
  contracts: NetworkContractsSchema,
  genesisHash: z.string(),
  registeredAt: z.union([z.number(), z.bigint()]).transform((v) => Number(v)),
  stake: z.bigint(),
  isActive: z.boolean(),
  isVerified: z.boolean(),
})

const FederatedSolverSchema = z.object({
  solverAddress: z.string(),
  homeChainId: z.union([z.number(), z.bigint()]).transform((v) => Number(v)),
  supportedChains: z
    .array(z.union([z.number(), z.bigint()]))
    .transform((v) => v.map((c) => Number(c))),
  totalStake: z.bigint(),
  totalFills: z.union([z.number(), z.bigint()]).transform((v) => Number(v)),
  successfulFills: z
    .union([z.number(), z.bigint()])
    .transform((v) => Number(v)),
  federatedAt: z.union([z.number(), z.bigint()]).transform((v) => Number(v)),
  isActive: z.boolean(),
})

interface CacheEntry<T> {
  data: T
  timestamp: number
}

// Max cache size to prevent memory exhaustion
const MAX_DISCOVERY_CACHE_SIZE = 1000

export class FederationDiscovery {
  private config: DiscoveryConfig
  private hubClient: ReturnType<typeof createPublicClient>
  private cache: Map<
    string,
    CacheEntry<
      NetworkInfo | NetworkInfo[] | FederatedSolver[] | NetworkLiquidity[]
    >
  >
  private cacheTtl: number

  constructor(config: DiscoveryConfig) {
    this.config = config
    this.hubClient = createPublicClient({
      transport: http(config.hubRpcUrl),
    }) as PublicClient
    this.cache = new Map()
    this.cacheTtl = config.cacheTtlMs ?? 300000 // 5 minutes default
  }

  private getCached<T>(key: string): T | null {
    if (!this.config.cacheEnabled) return null

    const entry = this.cache.get(key)
    if (!entry) return null

    if (Date.now() - entry.timestamp > this.cacheTtl) {
      this.cache.delete(key)
      return null
    }

    return entry.data as T
  }

  private setCache<
    T extends
      | NetworkInfo
      | NetworkInfo[]
      | FederatedSolver[]
      | NetworkLiquidity[],
  >(key: string, data: T): void {
    if (!this.config.cacheEnabled) return

    // Evict oldest entries if cache is full
    if (this.cache.size >= MAX_DISCOVERY_CACHE_SIZE) {
      const entries = Array.from(this.cache.entries()).sort(
        (a, b) => a[1].timestamp - b[1].timestamp,
      )

      // Remove oldest 10% of entries
      const toRemove = Math.ceil(entries.length * 0.1)
      for (let i = 0; i < toRemove; i++) {
        this.cache.delete(entries[i][0])
      }
    }

    this.cache.set(key, { data, timestamp: Date.now() })
  }

  async discoverNetworks(): Promise<NetworkInfo[]> {
    const cacheKey = 'networks:all'
    const cached = this.getCached<NetworkInfo[]>(cacheKey)
    if (cached) return cached

    const chainIds = (await safeReadContract(this.hubClient, {
      address: this.config.networkRegistryAddress,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'getActiveNetworks',
    })) as bigint[]

    const networks: NetworkInfo[] = []

    for (const chainId of chainIds) {
      const network = await this.getNetwork(Number(chainId))
      if (network) networks.push(network)
    }

    this.setCache(cacheKey, networks)
    return networks
  }

  async getNetwork(chainId: number): Promise<NetworkInfo | null> {
    const cacheKey = `network:${chainId}`
    const cached = this.getCached<NetworkInfo>(cacheKey)
    if (cached) return cached

    const result = await safeReadContract(this.hubClient, {
      address: this.config.networkRegistryAddress,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'getNetwork',
      args: [BigInt(chainId)],
    })

    const parsed = NetworkInfoSchema.safeParse(result)
    if (!parsed.success) {
      console.error(
        `[Federation] Invalid network data for chain ${chainId}:`,
        parsed.error,
      )
      return null
    }

    const network = parsed.data as NetworkInfo
    this.setCache(cacheKey, network)
    return network
  }

  async getVerifiedNetworks(): Promise<NetworkInfo[]> {
    const cacheKey = 'networks:verified'
    const cached = this.getCached<NetworkInfo[]>(cacheKey)
    if (cached) return cached

    const chainIds = (await safeReadContract(this.hubClient, {
      address: this.config.networkRegistryAddress,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'getVerifiedNetworks',
    })) as bigint[]

    const networks: NetworkInfo[] = []

    for (const chainId of chainIds) {
      const network = await this.getNetwork(Number(chainId))
      if (network) networks.push(network)
    }

    this.setCache(cacheKey, networks)
    return networks
  }

  async getTrustedPeers(chainId: number): Promise<number[]> {
    const result = (await safeReadContract(this.hubClient, {
      address: this.config.networkRegistryAddress,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'getTrustedPeers',
      args: [BigInt(chainId)],
    })) as bigint[]

    return result.map((id) => Number(id))
  }

  async isTrusted(
    sourceChainId: number,
    targetChainId: number,
  ): Promise<boolean> {
    return safeReadContract(this.hubClient, {
      address: this.config.networkRegistryAddress,
      abi: NETWORK_REGISTRY_ABI,
      functionName: 'isTrusted',
      args: [BigInt(sourceChainId), BigInt(targetChainId)],
    }) as Promise<boolean>
  }

  async findRoutes(
    sourceChainId: number,
    destChainId: number,
  ): Promise<{
    direct: boolean
    hops: number[]
    trustedPath: boolean
  }> {
    const isTrusted = await this.isTrusted(sourceChainId, destChainId)

    if (isTrusted) {
      return { direct: true, hops: [], trustedPath: true }
    }

    const sourcePeers = await this.getTrustedPeers(sourceChainId)

    for (const peer of sourcePeers) {
      const peerTrustsDest = await this.isTrusted(peer, destChainId)
      if (peerTrustsDest) {
        return { direct: false, hops: [peer], trustedPath: true }
      }
    }

    return { direct: false, hops: [], trustedPath: false }
  }

  async discoverSolversForRoute(
    federatedSolverAddress: Address,
    localRpcUrl: string,
    sourceChainId: number,
    destChainId: number,
  ): Promise<FederatedSolver[]> {
    const localClient = createPublicClient({
      transport: http(localRpcUrl),
    }) as PublicClient

    const solverIds = (await safeReadContract(localClient, {
      address: federatedSolverAddress,
      abi: FEDERATED_SOLVER_ABI,
      functionName: 'getSolversForRoute',
      args: [BigInt(sourceChainId), BigInt(destChainId)],
    })) as `0x${string}`[]

    const solvers: FederatedSolver[] = []

    for (const solverId of solverIds) {
      const solverData = await safeReadContract(localClient, {
        address: federatedSolverAddress,
        abi: FEDERATED_SOLVER_ABI,
        functionName: 'getSolver',
        args: [solverId],
      })

      const parsed = FederatedSolverSchema.safeParse(solverData)
      if (!parsed.success) {
        console.error(
          `[Federation] Invalid solver data for ${solverId}:`,
          parsed.error,
        )
        continue
      }

      const solver = parsed.data as FederatedSolver
      if (solver.isActive) {
        solvers.push(solver)
      }
    }

    return solvers.sort((a, b) => {
      const aRate =
        a.totalFills > 0 ? (a.successfulFills * 10000) / a.totalFills : 10000
      const bRate =
        b.totalFills > 0 ? (b.successfulFills * 10000) / b.totalFills : 10000
      const aScore = Number(a.totalStake / BigInt(1e18)) * Number(aRate)
      const bScore = Number(b.totalStake / BigInt(1e18)) * Number(bRate)
      return bScore - aScore
    })
  }

  async discoverLiquidity(
    federatedLiquidityAddress: Address,
    localRpcUrl: string,
  ): Promise<{
    totalEth: bigint
    totalToken: bigint
    networks: NetworkLiquidity[]
  }> {
    const localClient = createPublicClient({
      transport: http(localRpcUrl),
    }) as PublicClient

    const [totalEth, totalToken] = (await safeReadContract(localClient, {
      address: federatedLiquidityAddress,
      abi: FEDERATED_LIQUIDITY_ABI,
      functionName: 'getTotalFederatedLiquidity',
    })) as [bigint, bigint]

    return { totalEth, totalToken, networks: [] }
  }

  clearCache(): void {
    this.cache.clear()
  }
}

export function createFederationDiscovery(
  config: DiscoveryConfig,
): FederationDiscovery {
  return new FederationDiscovery(config)
}
