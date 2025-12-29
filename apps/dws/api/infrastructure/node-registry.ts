/**
 * Decentralized Node Registry
 *
 * Handles on-chain registration and discovery of DWS nodes.
 * Nodes self-register with their capabilities, stake, and pricing.
 * Users discover nodes via on-chain queries and P2P gossip.
 */

import { isProductionEnv } from '@jejunetwork/config'
import { expectJson } from '@jejunetwork/types'
import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  type Hex,
  type HttpTransport,
  http,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia } from 'viem/chains'
import { z } from 'zod'
import { parseQuote, verifyQuote } from '../poc/quote-parser'
import {
  createKMSWalletClient,
  isKMSAvailable,
  type KMSWalletClient,
} from '../shared/kms-wallet'
import { getPoCNodeVerifier, type PoCNodeVerifier } from './poc-node-verifier'
import type {
  InfraEvent,
  InfraEventHandler,
  NetworkConfig,
  NodeCapability,
  NodeConfig,
  NodeSpecs,
  TEEPlatform,
} from './types'

/** Full agent registration data from IdentityRegistry */
interface NodeAgentRegistration {
  agentId: bigint
  owner: Address
  tier: number
  stakedToken: Address
  stakedAmount: bigint
  registeredAt: bigint
  lastActivityAt: bigint
  isBanned: boolean
  isSlashed: boolean
}

const NodeSpecsSchema = z.object({
  cpuCores: z.number().int().positive(),
  memoryMb: z.number().int().positive(),
  storageMb: z.number().int().nonnegative(),
  bandwidthMbps: z.number().int().nonnegative(),
  teePlatform: z.enum(['intel_sgx', 'intel_tdx', 'amd_sev', 'none']),
})

const NodePricingSchema = z.object({
  pricePerHour: z.string(),
  pricePerGb: z.string(),
  pricePerRequest: z.string(),
})

const NodeAttestationSchema = z.object({
  quote: z.string().startsWith('0x'),
  measurement: z.string().startsWith('0x'),
  platform: z.string(),
  verifiedAt: z.number(),
  expiresAt: z.number(),
})

function getChainFromConfig(config: NetworkConfig): Chain {
  // Use known chains for testnet/mainnet
  if (config.chainId === 8453) return base
  if (config.chainId === 84532) return baseSepolia

  // Define custom chain for localnet or unknown chains
  return defineChain({
    id: config.chainId,
    name:
      config.environment === 'localnet'
        ? 'Localnet'
        : `Chain ${config.chainId}`,
    nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [config.rpcUrl] } },
    testnet: config.environment !== 'mainnet',
  })
}

// ABI for Node Registry (extends ERC-8004 IdentityRegistry)

const NODE_REGISTRY_ABI = [
  // ERC-8004 base
  {
    name: 'register',
    type: 'function',
    inputs: [{ name: 'tokenURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'setEndpoint',
    type: 'function',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'endpoint', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'setMetadata',
    type: 'function',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'addTag',
    type: 'function',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'tag', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getAgent',
    type: 'function',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'agentId', type: 'uint256' },
          { name: 'owner', type: 'address' },
          { name: 'tier', type: 'uint8' },
          { name: 'stakedToken', type: 'address' },
          { name: 'stakedAmount', type: 'uint256' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'lastActivityAt', type: 'uint256' },
          { name: 'isBanned', type: 'bool' },
          { name: 'isSlashed', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getAgentsByTag',
    type: 'function',
    inputs: [{ name: 'tag', type: 'string' }],
    outputs: [{ name: 'agentIds', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    name: 'getAgentTags',
    type: 'function',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: 'tags', type: 'string[]' }],
    stateMutability: 'view',
  },
  {
    name: 'getA2AEndpoint',
    type: 'function',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: 'endpoint', type: 'string' }],
    stateMutability: 'view',
  },
  {
    name: 'getMetadata',
    type: 'function',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'key', type: 'string' },
    ],
    outputs: [{ name: 'value', type: 'bytes' }],
    stateMutability: 'view',
  },
  // Staking
  {
    name: 'stake',
    type: 'function',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  // Heartbeat
  {
    name: 'heartbeat',
    type: 'function',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

// Metadata Keys

const META_KEYS = {
  SPECS: 'dws:specs',
  CAPABILITIES: 'dws:capabilities',
  PRICING: 'dws:pricing',
  ATTESTATION: 'dws:attestation',
  VERSION: 'dws:version',
  REGION: 'dws:region',
} as const

const DWS_NODE_TAG = 'dws-node'

// Node Registry

export class NodeRegistry {
  private publicClient: PublicClient
  private walletClient:
    | WalletClient<HttpTransport, Chain, PrivateKeyAccount>
    | KMSWalletClient
    | null = null
  private registryAddress: Address
  private chain: Chain
  private networkConfig: NetworkConfig
  private initialized = false

  // Cache
  private nodeCache = new Map<string, NodeConfig>()
  private cacheExpiry = 60000 // 1 minute
  private lastCacheRefresh = 0

  // PoC verifier for cloud alliance checks
  private pocVerifier: PoCNodeVerifier | null = null

  // Event handlers
  private eventHandlers: InfraEventHandler[] = []

  constructor(
    config: NetworkConfig,
    privateKey?: Hex,
    kmsKeyId?: string,
    ownerAddress?: Address,
  ) {
    this.registryAddress = config.contracts.identityRegistry
    this.chain = getChainFromConfig(config)
    this.networkConfig = config

    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(config.rpcUrl),
    })

    // Initialize with direct key if provided
    if (privateKey) {
      const account = privateKeyToAccount(privateKey)
      this.walletClient = createWalletClient({
        account,
        chain: this.chain,
        transport: http(config.rpcUrl),
      })
    }

    // Store KMS config for later initialization
    if (kmsKeyId && ownerAddress) {
      this.initKMS(kmsKeyId, ownerAddress).catch((err) => {
        console.error('[NodeRegistry] Failed to initialize KMS:', err)
      })
    }
  }

  /**
   * Initialize KMS-backed signing
   */
  private async initKMS(
    kmsKeyId: string,
    ownerAddress: Address,
  ): Promise<void> {
    if (this.initialized) return

    const kmsAvailable = await isKMSAvailable()
    if (kmsAvailable) {
      this.walletClient = await createKMSWalletClient({
        chain: this.chain,
        rpcUrl: this.networkConfig.rpcUrl,
        kmsKeyId,
        ownerAddress,
      })
      console.log('[NodeRegistry] Using KMS-backed signing')
    } else if (isProductionEnv()) {
      throw new Error('KMS not available for node registry in production')
    }

    this.initialized = true
  }

  // Node Registration

  /**
   * Register this machine as a DWS node
   */
  async registerNode(params: {
    endpoint: string
    specs: NodeSpecs
    capabilities: NodeCapability[]
    pricePerHour: bigint
    pricePerGb: bigint
    pricePerRequest: bigint
    region?: string
    initialStake?: bigint
  }): Promise<{ agentId: bigint; txHash: Hex }> {
    if (!this.walletClient) {
      throw new Error('Wallet not configured - cannot register node')
    }

    // Create token URI with basic info
    const tokenURI = JSON.stringify({
      name: `DWS Node ${Date.now()}`,
      description: 'Decentralized Web Services compute node',
      endpoint: params.endpoint,
    })

    // Register as agent
    const registerData = encodeFunctionData({
      abi: NODE_REGISTRY_ABI,
      functionName: 'register',
      args: [tokenURI],
    })

    const registerTx = await this.walletClient.sendTransaction({
      chain: this.chain,
      to: this.registryAddress,
      data: registerData,
    })

    // Wait for receipt
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: registerTx,
    })

    // Extract agentId from Transfer event (ERC-721)
    const agentId = BigInt(receipt.logs[0].topics[3] ?? 0)

    // Set endpoint
    await this.setEndpoint(agentId, params.endpoint)

    // Set capabilities as tags
    await this.addTag(agentId, DWS_NODE_TAG)
    for (const cap of params.capabilities) {
      await this.addTag(agentId, `dws-${cap}`)
    }

    // Set metadata
    await this.setMetadata(
      agentId,
      META_KEYS.SPECS,
      this.encodeSpecs(params.specs),
    )
    await this.setMetadata(
      agentId,
      META_KEYS.CAPABILITIES,
      this.encodeCapabilities(params.capabilities),
    )
    await this.setMetadata(
      agentId,
      META_KEYS.PRICING,
      this.encodePricing({
        pricePerHour: params.pricePerHour,
        pricePerGb: params.pricePerGb,
        pricePerRequest: params.pricePerRequest,
      }),
    )

    if (params.region) {
      await this.setMetadata(
        agentId,
        META_KEYS.REGION,
        Buffer.from(params.region),
      )
    }

    // Stake if provided
    if (params.initialStake && params.initialStake > 0n) {
      await this.stake(agentId, params.initialStake)
    }

    // Emit event
    this.emit({
      type: 'node:registered',
      nodeAgentId: agentId,
      endpoint: params.endpoint,
      capabilities: params.capabilities,
    })

    return { agentId, txHash: registerTx }
  }

  /**
   * Update node specs (CPU, memory, etc.)
   */
  async updateSpecs(agentId: bigint, specs: NodeSpecs): Promise<Hex> {
    return this.setMetadata(agentId, META_KEYS.SPECS, this.encodeSpecs(specs))
  }

  /**
   * Update node pricing
   */
  async updatePricing(
    agentId: bigint,
    pricing: {
      pricePerHour: bigint
      pricePerGb: bigint
      pricePerRequest: bigint
    },
  ): Promise<Hex> {
    return this.setMetadata(
      agentId,
      META_KEYS.PRICING,
      this.encodePricing(pricing),
    )
  }

  /**
   * Submit TEE attestation and verify against cloud alliance
   */
  async submitAttestation(agentId: bigint, quote: Hex): Promise<Hex> {
    // Verify quote first
    const parseResult = parseQuote(quote)
    if (!parseResult.success || !parseResult.quote) {
      throw new Error(`Invalid attestation quote: ${parseResult.error}`)
    }

    const verifyResult = await verifyQuote(parseResult.quote)
    if (!verifyResult.valid) {
      throw new Error(`Attestation verification failed: ${verifyResult.error}`)
    }

    // Run PoC verification against cloud alliance
    let pocStatus: NodeConfig['pocStatus'] | undefined
    if (!this.pocVerifier) {
      try {
        this.pocVerifier = getPoCNodeVerifier()
      } catch {
        console.warn('[NodeRegistry] PoC verifier not available')
      }
    }

    if (this.pocVerifier) {
      const pocResult = await this.pocVerifier.verifyNode(agentId, quote)
      pocStatus = {
        verified: pocResult.verified,
        level: pocResult.level,
        hardwareIdHash: pocResult.hardwareIdHash,
        cloudProvider: pocResult.cloudProvider,
        region: pocResult.region,
        lastVerifiedAt: pocResult.verified ? Date.now() : null,
        expiresAt: pocResult.verified
          ? Date.now() + 7 * 24 * 60 * 60 * 1000
          : null,
        score: pocResult.score,
      }

      // Update cached node with PoC status
      const cacheKey = agentId.toString()
      const cachedNode = this.nodeCache.get(cacheKey)
      if (cachedNode) {
        cachedNode.pocStatus = pocStatus
        // Apply reputation delta
        cachedNode.reputation = Math.max(
          0,
          Math.min(100, cachedNode.reputation + pocResult.reputationDelta),
        )
        this.nodeCache.set(cacheKey, cachedNode)
      }

      console.log(
        `[NodeRegistry] PoC verification for node ${agentId}: ` +
          `verified=${pocResult.verified}, level=${pocResult.level}, ` +
          `reputation delta=${pocResult.reputationDelta}`,
      )
    }

    // Store attestation on-chain
    const attestationData = JSON.stringify({
      quote,
      measurement: parseResult.quote.measurement,
      platform: parseResult.quote.platform,
      verifiedAt: Date.now(),
      expiresAt: Date.now() + 24 * 60 * 60 * 1000, // 24 hours
      // Include PoC status if available
      poc: pocStatus
        ? {
            verified: pocStatus.verified,
            level: pocStatus.level,
            cloudProvider: pocStatus.cloudProvider,
            region: pocStatus.region,
          }
        : undefined,
    })

    return this.setMetadata(
      agentId,
      META_KEYS.ATTESTATION,
      Buffer.from(attestationData),
    )
  }

  /**
   * Verify a node against the cloud alliance registry
   * Can be called separately from attestation submission
   */
  async verifyNodePoC(
    agentId: bigint,
    quote: Hex,
  ): Promise<NodeConfig['pocStatus'] | null> {
    if (!this.pocVerifier) {
      try {
        this.pocVerifier = getPoCNodeVerifier()
      } catch {
        console.warn('[NodeRegistry] PoC verifier not available')
        return null
      }
    }

    const pocResult = await this.pocVerifier.verifyNode(agentId, quote)

    const pocStatus: NodeConfig['pocStatus'] = {
      verified: pocResult.verified,
      level: pocResult.level,
      hardwareIdHash: pocResult.hardwareIdHash,
      cloudProvider: pocResult.cloudProvider,
      region: pocResult.region,
      lastVerifiedAt: pocResult.verified ? Date.now() : null,
      expiresAt: pocResult.verified
        ? Date.now() + 7 * 24 * 60 * 60 * 1000
        : null,
      score: pocResult.score,
    }

    // Update cached node
    const cacheKey = agentId.toString()
    const cachedNode = this.nodeCache.get(cacheKey)
    if (cachedNode) {
      cachedNode.pocStatus = pocStatus
      cachedNode.reputation = Math.max(
        0,
        Math.min(100, cachedNode.reputation + pocResult.reputationDelta),
      )
      this.nodeCache.set(cacheKey, cachedNode)

      // Emit event
      if (
        pocResult.verified &&
        pocResult.cloudProvider &&
        pocResult.region &&
        pocResult.hardwareIdHash
      ) {
        this.emit({
          type: 'node:poc_verified',
          nodeAgentId: agentId,
          level: pocResult.level as 1 | 2 | 3,
          cloudProvider: pocResult.cloudProvider,
          region: pocResult.region,
          hardwareIdHash: pocResult.hardwareIdHash,
        })
      } else if (!pocResult.verified && pocResult.error) {
        this.emit({
          type: 'node:poc_failed',
          nodeAgentId: agentId,
          reason: pocResult.error,
        })
      }
    }

    return pocStatus
  }

  /**
   * Send heartbeat to prove node is online
   */
  async heartbeat(agentId: bigint): Promise<Hex> {
    if (!this.walletClient) {
      throw new Error('Wallet not configured')
    }

    const data = encodeFunctionData({
      abi: NODE_REGISTRY_ABI,
      functionName: 'heartbeat',
      args: [agentId],
    })

    return this.walletClient.sendTransaction({
      chain: this.chain,
      to: this.registryAddress,
      data,
    })
  }

  /**
   * Stake tokens for this node
   */
  async stake(agentId: bigint, amount: bigint): Promise<Hex> {
    if (!this.walletClient) {
      throw new Error('Wallet not configured')
    }

    const data = encodeFunctionData({
      abi: NODE_REGISTRY_ABI,
      functionName: 'stake',
      args: [agentId, amount],
    })

    return this.walletClient.sendTransaction({
      chain: this.chain,
      to: this.registryAddress,
      data,
    })
  }

  // Node Discovery

  /**
   * Get all active DWS nodes
   */
  async getActiveNodes(): Promise<NodeConfig[]> {
    const now = Date.now()

    // Check cache
    if (
      now - this.lastCacheRefresh < this.cacheExpiry &&
      this.nodeCache.size > 0
    ) {
      return Array.from(this.nodeCache.values()).filter(
        (n) => n.status !== 'offline',
      )
    }

    // Query on-chain
    const agentIds = (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: NODE_REGISTRY_ABI,
      functionName: 'getAgentsByTag',
      args: [DWS_NODE_TAG],
    })) as bigint[]

    const nodes: NodeConfig[] = []
    for (const agentId of agentIds) {
      const node = await this.getNode(agentId)
      if (node && !node.isBanned) {
        nodes.push(node)
        this.nodeCache.set(agentId.toString(), node)
      }
    }

    this.lastCacheRefresh = now
    return nodes
  }

  /**
   * Get nodes by capability
   */
  async getNodesByCapability(
    capability: NodeCapability,
  ): Promise<NodeConfig[]> {
    const agentIds = (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: NODE_REGISTRY_ABI,
      functionName: 'getAgentsByTag',
      args: [`dws-${capability}`],
    })) as bigint[]

    const nodes: NodeConfig[] = []
    for (const agentId of agentIds) {
      const node = await this.getNode(agentId)
      if (node && !node.isBanned) {
        nodes.push(node)
      }
    }

    return nodes
  }

  /**
   * Get a specific node
   */
  async getNode(agentId: bigint): Promise<NodeConfig | null> {
    const cacheKey = agentId.toString()
    const cached = this.nodeCache.get(cacheKey)
    if (cached && Date.now() - cached.lastHeartbeat < this.cacheExpiry) {
      return cached
    }

    // Get agent info
    const agent = (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: NODE_REGISTRY_ABI,
      functionName: 'getAgent',
      args: [agentId],
    })) as NodeAgentRegistration

    if (
      !agent.owner ||
      agent.owner === '0x0000000000000000000000000000000000000000'
    ) {
      return null
    }

    // Get endpoint
    const endpoint = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: NODE_REGISTRY_ABI,
      functionName: 'getA2AEndpoint',
      args: [agentId],
    })

    if (!endpoint) return null

    // Get capabilities from tags
    const tags = await this.publicClient.readContract({
      address: this.registryAddress,
      abi: NODE_REGISTRY_ABI,
      functionName: 'getAgentTags',
      args: [agentId],
    })

    const capabilities: NodeCapability[] = []
    for (const tag of tags) {
      if (tag.startsWith('dws-') && tag !== DWS_NODE_TAG) {
        const cap = tag.slice(4) as NodeCapability
        if (
          [
            'compute',
            'storage',
            'cdn',
            'gpu',
            'tee',
            'high-memory',
            'high-cpu',
            'ssd',
            'bandwidth',
          ].includes(cap)
        ) {
          capabilities.push(cap)
        }
      }
    }

    // Get metadata
    const specsData = await this.getMetadata(agentId, META_KEYS.SPECS)
    const pricingData = await this.getMetadata(agentId, META_KEYS.PRICING)
    const attestationData = await this.getMetadata(
      agentId,
      META_KEYS.ATTESTATION,
    )
    const versionData = await this.getMetadata(agentId, META_KEYS.VERSION)

    const specs = specsData ? this.decodeSpecs(specsData) : this.defaultSpecs()
    const pricing = pricingData
      ? this.decodePricing(pricingData)
      : { pricePerHour: 0n, pricePerGb: 0n, pricePerRequest: 0n }
    const attestation = attestationData
      ? this.decodeAttestation(attestationData)
      : undefined

    const node: NodeConfig = {
      agentId,
      owner: agent.owner,
      endpoint,
      registeredAt: Number(agent.registeredAt) * 1000,
      lastHeartbeat: Number(agent.lastActivityAt) * 1000,
      version: versionData
        ? Buffer.from(versionData.slice(2), 'hex').toString()
        : 'unknown',
      capabilities,
      specs,
      stakedAmount: agent.stakedAmount,
      stakedToken: agent.stakedToken,
      pricePerHour: pricing.pricePerHour,
      pricePerGb: pricing.pricePerGb,
      pricePerRequest: pricing.pricePerRequest,
      status: this.determineStatus(agent.lastActivityAt),
      reputation: 100 - (agent.isSlashed ? 50 : 0),
      isBanned: agent.isBanned,
      isSlashed: agent.isSlashed,
      attestation,
      activeWorkers: 0,
      activeJobs: 0,
      cpuUsage: 0,
      memoryUsage: 0,
    }

    this.nodeCache.set(cacheKey, node)
    return node
  }

  /**
   * Find best nodes matching requirements
   */
  async findNodes(params: {
    capabilities: NodeCapability[]
    minReputation?: number
    minStake?: bigint
    teeRequired?: boolean
    teePlatform?: TEEPlatform
    maxPricePerRequest?: bigint
    limit?: number
  }): Promise<NodeConfig[]> {
    let nodes = await this.getActiveNodes()

    // Filter by capabilities
    if (params.capabilities.length > 0) {
      nodes = nodes.filter((n) =>
        params.capabilities.every((cap) => n.capabilities.includes(cap)),
      )
    }

    // Filter by reputation
    if (params.minReputation !== undefined) {
      const minReputation = params.minReputation
      nodes = nodes.filter((n) => n.reputation >= minReputation)
    }

    // Filter by stake
    if (params.minStake !== undefined) {
      const minStake = params.minStake
      nodes = nodes.filter((n) => n.stakedAmount >= minStake)
    }

    // Filter by TEE
    if (params.teeRequired) {
      nodes = nodes.filter((n) => n.capabilities.includes('tee'))
      if (params.teePlatform && params.teePlatform !== 'none') {
        nodes = nodes.filter((n) => n.specs.teePlatform === params.teePlatform)
      }
    }

    // Filter by price
    if (params.maxPricePerRequest !== undefined) {
      const maxPricePerRequest = params.maxPricePerRequest
      nodes = nodes.filter((n) => n.pricePerRequest <= maxPricePerRequest)
    }

    // Sort by reputation and stake
    nodes.sort((a, b) => {
      const reputationDiff = b.reputation - a.reputation
      if (reputationDiff !== 0) return reputationDiff
      return Number(b.stakedAmount - a.stakedAmount)
    })

    // Limit results
    if (params.limit) {
      nodes = nodes.slice(0, params.limit)
    }

    return nodes
  }

  /**
   * Ping node to check if it's online
   */
  async pingNode(
    endpoint: string,
  ): Promise<{ online: boolean; latencyMs: number }> {
    const start = Date.now()

    const response = await fetch(`${endpoint}/health`, {
      signal: AbortSignal.timeout(5000),
    })

    const latencyMs = Date.now() - start
    return {
      online: response.ok ?? false,
      latencyMs: response.ok ? latencyMs : Infinity,
    }
  }

  // Events

  onEvent(handler: InfraEventHandler): () => void {
    this.eventHandlers.push(handler)
    return () => {
      const index = this.eventHandlers.indexOf(handler)
      if (index >= 0) this.eventHandlers.splice(index, 1)
    }
  }

  private emit(event: InfraEvent): void {
    for (const handler of this.eventHandlers) {
      Promise.resolve(handler(event)).catch(console.error)
    }
  }

  // Private Helpers

  private async setEndpoint(agentId: bigint, endpoint: string): Promise<Hex> {
    if (!this.walletClient) throw new Error('Wallet not configured')

    const data = encodeFunctionData({
      abi: NODE_REGISTRY_ABI,
      functionName: 'setEndpoint',
      args: [agentId, endpoint],
    })

    return this.walletClient.sendTransaction({
      chain: this.chain,
      to: this.registryAddress,
      data,
    })
  }

  private async addTag(agentId: bigint, tag: string): Promise<Hex> {
    if (!this.walletClient) throw new Error('Wallet not configured')

    const data = encodeFunctionData({
      abi: NODE_REGISTRY_ABI,
      functionName: 'addTag',
      args: [agentId, tag],
    })

    return this.walletClient.sendTransaction({
      chain: this.chain,
      to: this.registryAddress,
      data,
    })
  }

  private async setMetadata(
    agentId: bigint,
    key: string,
    value: Uint8Array | Buffer,
  ): Promise<Hex> {
    if (!this.walletClient) throw new Error('Wallet not configured')

    const data = encodeFunctionData({
      abi: NODE_REGISTRY_ABI,
      functionName: 'setMetadata',
      args: [agentId, key, `0x${Buffer.from(value).toString('hex')}` as Hex],
    })

    return this.walletClient.sendTransaction({
      chain: this.chain,
      to: this.registryAddress,
      data,
    })
  }

  private async getMetadata(agentId: bigint, key: string): Promise<Hex | null> {
    const value = (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: NODE_REGISTRY_ABI,
      functionName: 'getMetadata',
      args: [agentId, key],
    })) as Hex

    return value && value !== '0x' ? value : null
  }

  private encodeSpecs(specs: NodeSpecs): Uint8Array {
    return Buffer.from(JSON.stringify(specs))
  }

  private decodeSpecs(data: Hex): NodeSpecs {
    const json = Buffer.from(data.slice(2), 'hex').toString()
    return expectJson(json, NodeSpecsSchema, 'node specs')
  }

  private encodePricing(pricing: {
    pricePerHour: bigint
    pricePerGb: bigint
    pricePerRequest: bigint
  }): Uint8Array {
    return Buffer.from(
      JSON.stringify({
        pricePerHour: pricing.pricePerHour.toString(),
        pricePerGb: pricing.pricePerGb.toString(),
        pricePerRequest: pricing.pricePerRequest.toString(),
      }),
    )
  }

  private decodePricing(data: Hex): {
    pricePerHour: bigint
    pricePerGb: bigint
    pricePerRequest: bigint
  } {
    const json = Buffer.from(data.slice(2), 'hex').toString()
    const parsed = expectJson(json, NodePricingSchema, 'node pricing')
    return {
      pricePerHour: BigInt(parsed.pricePerHour),
      pricePerGb: BigInt(parsed.pricePerGb),
      pricePerRequest: BigInt(parsed.pricePerRequest),
    }
  }

  private encodeCapabilities(capabilities: NodeCapability[]): Uint8Array {
    return Buffer.from(JSON.stringify(capabilities))
  }

  private decodeAttestation(data: Hex): NodeConfig['attestation'] {
    const json = Buffer.from(data.slice(2), 'hex').toString()
    const parsed = expectJson(json, NodeAttestationSchema, 'node attestation')
    return {
      quote: parsed.quote as Hex,
      measurement: parsed.measurement as Hex,
      verifiedAt: parsed.verifiedAt,
      expiresAt: parsed.expiresAt,
    }
  }

  private defaultSpecs(): NodeSpecs {
    return {
      cpuCores: 1,
      memoryMb: 1024,
      storageMb: 10240,
      bandwidthMbps: 100,
      teePlatform: 'none',
    }
  }

  private determineStatus(lastActivityAt: bigint): NodeConfig['status'] {
    const lastSeen = Number(lastActivityAt) * 1000
    const now = Date.now()
    const fiveMinutes = 5 * 60 * 1000
    const thirtyMinutes = 30 * 60 * 1000

    if (now - lastSeen < fiveMinutes) return 'online'
    if (now - lastSeen < thirtyMinutes) return 'busy' // Might be busy
    return 'offline'
  }
}
