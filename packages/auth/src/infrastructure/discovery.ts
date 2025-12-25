/**
 * OAuth3 Discovery - App and TEE node discovery via on-chain registries
 */

import { getRpcUrl } from '@jejunetwork/config'
import { toError, ZERO_ADDRESS } from '@jejunetwork/types'
import {
  type Address,
  createPublicClient,
  type Hex,
  http,
  keccak256,
  type PublicClient,
  toBytes,
} from 'viem'
import { AuthProvider, type TEEAttestation, TEEProvider } from '../types.js'
import {
  ProvidersListResponseSchema,
  TEEAttestationSchema,
  validateResponse,
} from '../validation.js'
import { OAUTH3_APP_REGISTRY_ABI } from './abis.js'
import {
  createOAuth3ComputeService,
  type OAuth3ComputeService,
} from './compute-integration.js'
import { CACHE_EXPIRY_MS, CHAIN_IDS, getContracts } from './config.js'
import {
  createOAuth3JNSService,
  type OAuth3AppJNS,
  type OAuth3JNSService,
} from './jns-integration.js'
import {
  createOAuth3StorageService,
  type OAuth3StorageService,
} from './storage-integration.js'

export interface DecentralizedConfig {
  rpcUrl?: string
  chainId?: number
  appRegistryAddress?: Address
  identityRegistryAddress?: Address
  teeVerifierAddress?: Address
  ipfsApiEndpoint?: string
  ipfsGatewayEndpoint?: string
}

export interface DiscoveredNode {
  nodeId: string
  endpoint: string
  jnsName?: string
  publicKey: Hex
  attestation: TEEAttestation
  stake: bigint
  supportedProviders: AuthProvider[]
  latency?: number
  healthy: boolean
  verifiedOnChain: boolean
}

export interface DiscoveredApp {
  appId: Hex
  name: string
  jnsName: string
  authEndpoint: string
  callbackEndpoint: string
  owner: Address
  council?: Address
  redirectUris: string[]
  metadata: { logoUri: string; policyUri: string; termsUri: string }
  teeNodes: DiscoveredNode[]
  verifiedOnChain: boolean
}

const ALL_PROVIDERS: AuthProvider[] = [
  AuthProvider.WALLET,
  AuthProvider.FARCASTER,
  AuthProvider.GOOGLE,
  AuthProvider.GITHUB,
  AuthProvider.TWITTER,
  AuthProvider.DISCORD,
]

/**
 * Discovery Service - Finds apps and TEE nodes from on-chain registries
 */
export class OAuth3DecentralizedDiscovery {
  private client: PublicClient
  private jns: OAuth3JNSService
  private storage: OAuth3StorageService
  private compute: OAuth3ComputeService
  private appRegistryAddress: Address
  private chainId: number
  private nodeCache = new Map<string, DiscoveredNode>()
  private appCache = new Map<string, DiscoveredApp>()
  private lastCacheUpdate = 0

  constructor(config: DecentralizedConfig = {}) {
    this.chainId = config.chainId ?? CHAIN_IDS.localnet
    const contracts = getContracts(this.chainId)
    const rpcUrl = config.rpcUrl ?? getRpcUrl()

    this.client = createPublicClient({ transport: http(rpcUrl) })
    this.appRegistryAddress = config.appRegistryAddress ?? contracts.appRegistry

    this.jns = createOAuth3JNSService({ rpcUrl, chainId: this.chainId })
    this.storage = createOAuth3StorageService({
      ipfsApiEndpoint: config.ipfsApiEndpoint,
      ipfsGatewayEndpoint: config.ipfsGatewayEndpoint,
    })
    this.compute = createOAuth3ComputeService({
      rpcUrl,
      chainId: this.chainId,
      teeVerifierAddress: config.teeVerifierAddress,
    })
  }

  async discoverApp(nameOrId: string): Promise<DiscoveredApp | null> {
    if (
      this.appCache.has(nameOrId) &&
      Date.now() - this.lastCacheUpdate < CACHE_EXPIRY_MS
    ) {
      return this.appCache.get(nameOrId) || null
    }

    let app: DiscoveredApp | null = null

    // Try JNS resolution for non-hex identifiers
    if (!nameOrId.startsWith('0x') || nameOrId.length !== 66) {
      const jnsApp = await this.jns.resolveApp(nameOrId)
      if (jnsApp) app = await this.buildAppFromJNS(jnsApp)
    }

    // Try on-chain registry for hex app IDs
    if (!app && nameOrId.startsWith('0x') && nameOrId.length === 66) {
      app = await this.getAppFromRegistry(nameOrId as Hex)
    }

    // Try deriving app ID from JNS name
    if (!app && !nameOrId.startsWith('0x')) {
      const fullName = nameOrId.endsWith('.oauth3.jeju')
        ? nameOrId
        : nameOrId.endsWith('.oauth3')
          ? `${nameOrId}.jeju`
          : `${nameOrId}.oauth3.jeju`
      app = await this.getAppFromRegistry(keccak256(toBytes(fullName)))
    }

    if (app) {
      this.appCache.set(nameOrId, app)
      this.appCache.set(app.appId, app)
      if (app.jnsName) this.appCache.set(app.jnsName, app)
    }

    return app
  }

  private async getAppFromRegistry(appId: Hex): Promise<DiscoveredApp | null> {
    const catchNotFound = (error: Error) => {
      if (error.message.includes('reverted')) return null
      throw error // Rethrow connection errors
    }

    const [appData, configData] = await Promise.all([
      this.client
        .readContract({
          address: this.appRegistryAddress,
          abi: OAUTH3_APP_REGISTRY_ABI,
          functionName: 'getApp',
          args: [appId],
        })
        .catch(catchNotFound),
      this.client
        .readContract({
          address: this.appRegistryAddress,
          abi: OAUTH3_APP_REGISTRY_ABI,
          functionName: 'getAppConfig',
          args: [appId],
        })
        .catch(catchNotFound),
    ])

    if (!appData?.active || !configData) return null

    const nodes = await this.discoverNodes()
    return {
      appId,
      name: appData.name,
      jnsName: configData.jnsName,
      authEndpoint: '',
      callbackEndpoint: '',
      owner: appData.owner,
      council: appData.council === ZERO_ADDRESS ? undefined : appData.council,
      redirectUris: [...configData.redirectUris],
      metadata: {
        logoUri: configData.logoUri,
        policyUri: configData.policyUri,
        termsUri: configData.termsUri,
      },
      teeNodes: nodes.slice(0, 5),
      verifiedOnChain: true,
    }
  }

  private async buildAppFromJNS(jnsApp: OAuth3AppJNS): Promise<DiscoveredApp> {
    const appId = keccak256(toBytes(jnsApp.fullName))
    const onChainApp = await this.client
      .readContract({
        address: this.appRegistryAddress,
        abi: OAUTH3_APP_REGISTRY_ABI,
        functionName: 'getApp',
        args: [appId],
      })
      .catch((error: Error) => {
        if (error.message.includes('reverted')) return null
        throw error
      })

    const nodes = await this.discoverNodes()
    return {
      appId,
      name: jnsApp.name,
      jnsName: jnsApp.fullName,
      authEndpoint: jnsApp.authEndpoint,
      callbackEndpoint: jnsApp.callbackEndpoint,
      owner: jnsApp.owner,
      council: jnsApp.council,
      redirectUris: jnsApp.redirectUris,
      metadata: jnsApp.metadata,
      teeNodes: nodes.slice(0, 5),
      verifiedOnChain: !!onChainApp?.active,
    }
  }

  async discoverNodes(): Promise<DiscoveredNode[]> {
    const providers = await this.compute.listTEEProviders()
    const nodes: DiscoveredNode[] = []

    for (const provider of providers) {
      const [healthCheck, supportedProviders] = await Promise.all([
        this.verifyNode(provider.endpoint),
        this.getNodeSupportedProviders(provider.endpoint),
      ])

      const node: DiscoveredNode = {
        nodeId: provider.nodeId,
        endpoint: provider.endpoint,
        publicKey: provider.attestation.measurement,
        attestation: provider.attestation,
        stake: provider.stake,
        supportedProviders,
        latency: healthCheck.latency,
        healthy: healthCheck.valid,
        verifiedOnChain: provider.attestation.verified,
      }

      if (node.healthy || node.verifiedOnChain) {
        nodes.push(node)
        this.nodeCache.set(provider.nodeId, node)
      }
    }

    this.lastCacheUpdate = Date.now()
    return nodes.sort(
      (a, b) =>
        Number(b.stake - a.stake) + ((a.latency ?? 1000) - (b.latency ?? 1000)),
    )
  }

  private async getNodeSupportedProviders(
    endpoint: string,
  ): Promise<AuthProvider[]> {
    if (!endpoint) return [AuthProvider.WALLET] // Minimum: wallet auth

    const response = await fetch(`${endpoint}/providers`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null)
    if (!response?.ok) return [AuthProvider.WALLET]

    const data = validateResponse(
      ProvidersListResponseSchema,
      await response.json(),
      'providers list response',
    )
    if (!data.providers?.length) return [AuthProvider.WALLET]

    // Map string values to AuthProvider enum
    const providerMap: Record<string, AuthProvider> = {
      wallet: AuthProvider.WALLET,
      farcaster: AuthProvider.FARCASTER,
      google: AuthProvider.GOOGLE,
      github: AuthProvider.GITHUB,
      twitter: AuthProvider.TWITTER,
      discord: AuthProvider.DISCORD,
    }

    return data.providers
      .map((p) => providerMap[p.toLowerCase()])
      .filter((p): p is AuthProvider => p !== undefined)
  }

  async getBestNode(options?: {
    supportedProviders?: AuthProvider[]
    minStake?: bigint
    maxLatency?: number
  }): Promise<DiscoveredNode | null> {
    const nodes = await this.discoverNodes()
    return (
      nodes.find((n) => {
        if (
          options?.supportedProviders?.length &&
          !options.supportedProviders.some((p) =>
            n.supportedProviders.includes(p),
          )
        )
          return false
        if (options?.minStake && n.stake < options.minStake) return false
        if (options?.maxLatency && n.latency && n.latency > options.maxLatency)
          return false
        return n.healthy && n.verifiedOnChain
      }) || null
    )
  }

  async verifyNode(endpoint: string): Promise<{
    valid: boolean
    attestation?: TEEAttestation
    latency?: number
    error?: string
  }> {
    if (!endpoint) return { valid: false, error: 'No endpoint' }

    const startTime = Date.now()
    const healthResponse = await fetch(`${endpoint}/health`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null)
    if (!healthResponse?.ok) return { valid: false, error: 'Unreachable' }

    const latency = Date.now() - startTime
    const attestResponse = await fetch(`${endpoint}/attestation`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null)
    if (!attestResponse?.ok)
      return { valid: false, latency, error: 'No attestation' }

    const attestResult = TEEAttestationSchema.safeParse(
      await attestResponse.json(),
    )
    if (!attestResult.success) {
      return { valid: false, latency, error: 'Invalid attestation format' }
    }
    const attestation = attestResult.data

    // SECURITY: Simulated TEE is ONLY allowed in localnet (chain 420691 or 31337)
    // Use the configured chainId from the service, not environment variable
    const configuredChainId = this.getConfiguredChainId()
    const isLocalnet =
      configuredChainId === CHAIN_IDS.localnet ||
      configuredChainId === CHAIN_IDS.localnetAnvil

    if (!attestation.verified) {
      if (attestation.provider === TEEProvider.SIMULATED && isLocalnet) {
        return { valid: true, attestation, latency }
      }
      return {
        valid: false,
        attestation,
        latency,
        error: 'Unverified attestation',
      }
    }

    return { valid: true, attestation, latency }
  }

  /**
   * Get the configured chain ID for this discovery service
   * SECURITY: Uses the chain ID set at construction time, not environment variables
   */
  private getConfiguredChainId(): number {
    return this.chainId
  }

  async validateRedirectUri(appId: Hex, uri: string): Promise<boolean> {
    return this.client.readContract({
      address: this.appRegistryAddress,
      abi: OAUTH3_APP_REGISTRY_ABI,
      functionName: 'validateRedirectUri',
      args: [appId, uri],
    })
  }

  async isProviderAllowed(
    appId: Hex,
    provider: AuthProvider,
  ): Promise<boolean> {
    const index = ALL_PROVIDERS.indexOf(provider)
    if (index === -1) return false
    return this.client.readContract({
      address: this.appRegistryAddress,
      abi: OAUTH3_APP_REGISTRY_ABI,
      functionName: 'isProviderAllowed',
      args: [appId, index],
    })
  }

  async getInfrastructureHealth(): Promise<{
    chain: { healthy: boolean; blockNumber: bigint; error?: string }
    jns: { healthy: boolean; latency: number; error?: string }
    storage: { healthy: boolean; latency: number }
    teeNodes: { total: number; healthy: number; verified: number }
  }> {
    let chainHealthy = false
    let blockNumber = 0n
    let chainError: string | undefined

    try {
      blockNumber = await this.client.getBlockNumber()
      chainHealthy = blockNumber > 0n
    } catch (error) {
      chainError = toError(error).message
    }

    let jnsHealthy = false
    let jnsError: string | undefined
    const jnsStart = Date.now()
    try {
      await this.jns.isAvailable('health.jeju')
      jnsHealthy = true
    } catch (error) {
      jnsError = toError(error).message
    }
    const jnsLatency = Date.now() - jnsStart

    const storageStart = Date.now()
    const storageHealthy = await this.storage.isHealthy()
    const storageLatency = Date.now() - storageStart

    // Node discovery - errors propagate from discoverNodes() which already handles them gracefully
    const nodes = await this.discoverNodes().catch(() => [] as DiscoveredNode[])

    return {
      chain: { healthy: chainHealthy, blockNumber, error: chainError },
      jns: { healthy: jnsHealthy, latency: jnsLatency, error: jnsError },
      storage: { healthy: storageHealthy, latency: storageLatency },
      teeNodes: {
        total: nodes.length,
        healthy: nodes.filter((n) => n.healthy).length,
        verified: nodes.filter((n) => n.verifiedOnChain).length,
      },
    }
  }

  getJNS(): OAuth3JNSService {
    return this.jns
  }
  getStorage(): OAuth3StorageService {
    return this.storage
  }
  getCompute(): OAuth3ComputeService {
    return this.compute
  }
  getClient(): PublicClient {
    return this.client
  }

  clearCaches(): void {
    this.nodeCache.clear()
    this.appCache.clear()
    this.lastCacheUpdate = 0
    this.compute.clearCache()
  }
}

let instance: OAuth3DecentralizedDiscovery | null = null

export function createDecentralizedDiscovery(
  config: DecentralizedConfig = {},
): OAuth3DecentralizedDiscovery {
  if (!instance) instance = new OAuth3DecentralizedDiscovery(config)
  return instance
}

export function resetDecentralizedDiscovery(): void {
  instance = null
}
