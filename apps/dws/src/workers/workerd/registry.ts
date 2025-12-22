/**
 * Decentralized Worker Registry
 * On-chain worker registration and discovery using ERC-8004 IdentityRegistry
 */

import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  type Hex,
  http,
  type Log,
  type PublicClient,
  type WalletClient,
} from 'viem'
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'
import type { WorkerdWorkerDefinition } from './types'

// ============================================================================
// Types
// ============================================================================

// Extended log type with topics for event decoding
interface EventLog extends Log {
  topics: [Hex, ...Hex[]]
}

export interface WorkerRegistration {
  workerId: string
  agentId: bigint
  owner: Address
  codeCid: string
  version: number
  memoryMb: number
  timeoutMs: number
  endpoint: string
  registeredAt: number
  isActive: boolean
}

export interface WorkerNode {
  agentId: bigint
  owner: Address
  endpoint: string
  region: string
  capabilities: string[]
  stake: bigint
  isActive: boolean
  lastSeen: number
}

export interface RegistryConfig {
  rpcUrl: string
  chain: Chain
  identityRegistryAddress: Address
  workerRegistryAddress?: Address
  privateKey?: `0x${string}`
}

// ============================================================================
// ABI Definitions
// ============================================================================

const IDENTITY_REGISTRY_ABI = [
  // Events for proper log parsing
  {
    name: 'Transfer',
    type: 'event',
    inputs: [
      { name: 'from', type: 'address', indexed: true },
      { name: 'to', type: 'address', indexed: true },
      { name: 'tokenId', type: 'uint256', indexed: true },
    ],
  },
  {
    name: 'register',
    type: 'function',
    inputs: [{ name: 'tokenURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
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
    name: 'getMetadata',
    type: 'function',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'key', type: 'string' },
    ],
    outputs: [{ name: 'value', type: 'bytes' }],
    stateMutability: 'view',
  },
  {
    name: 'setA2AEndpoint',
    type: 'function',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'endpoint', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getA2AEndpoint',
    type: 'function',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: 'endpoint', type: 'string' }],
    stateMutability: 'view',
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
    name: 'ownerOf',
    type: 'function',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: 'owner', type: 'address' }],
    stateMutability: 'view',
  },
] as const

// Tags for worker discovery
const WORKER_TAG = 'dws-worker'
const WORKER_NODE_TAG = 'dws-worker-node'

// Metadata keys
const WORKER_CODE_CID_KEY = 'workerCodeCid'
const WORKER_VERSION_KEY = 'workerVersion'
const WORKER_MEMORY_KEY = 'workerMemoryMb'
const WORKER_TIMEOUT_KEY = 'workerTimeoutMs'
const WORKER_REGION_KEY = 'workerRegion'
const WORKER_CAPABILITIES_KEY = 'workerCapabilities'

// ============================================================================
// Decentralized Worker Registry
// ============================================================================

export class DecentralizedWorkerRegistry {
  private publicClient: PublicClient
  private walletClient: WalletClient | null = null
  private account: PrivateKeyAccount | null = null
  private registryAddress: Address
  private cache = new Map<
    string,
    { data: WorkerRegistration | WorkerNode; expiresAt: number }
  >()
  private cacheExpiry = 60000 // 1 minute

  constructor(config: RegistryConfig) {
    this.publicClient = createPublicClient({
      chain: config.chain,
      transport: http(config.rpcUrl),
    }) as PublicClient

    this.registryAddress = config.identityRegistryAddress

    if (config.privateKey) {
      this.account = privateKeyToAccount(config.privateKey)
      this.walletClient = createWalletClient({
        account: this.account,
        chain: config.chain,
        transport: http(config.rpcUrl),
      })
    }
  }

  // ============================================================================
  // Worker Registration
  // ============================================================================

  /**
   * Register a new worker on-chain
   */
  async registerWorker(
    worker: WorkerdWorkerDefinition,
    endpoint: string,
  ): Promise<{ agentId: bigint; txHash: `0x${string}` }> {
    if (!this.walletClient || !this.account) {
      throw new Error('Wallet not configured for write operations')
    }

    // Create token URI with worker metadata
    const tokenURI = `data:application/json,${encodeURIComponent(
      JSON.stringify({
        name: worker.name,
        description: `DWS Worker: ${worker.name}`,
        image: '',
        properties: {
          type: 'dws-worker',
          codeCid: worker.codeCid,
          version: worker.version,
          memoryMb: worker.memoryMb,
          timeoutMs: worker.timeoutMs,
        },
      }),
    )}`

    // Simulate and execute registration
    const { request: registerRequest } =
      await this.publicClient.simulateContract({
        address: this.registryAddress,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'register',
        args: [tokenURI],
        account: this.account,
      })

    const registerTx = await this.walletClient.writeContract(registerRequest)

    // Wait for receipt and extract agentId from Transfer event
    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: registerTx,
    })

    // Parse agentId from Transfer event (ERC-721 mint emits Transfer with tokenId)
    const agentId = this.extractAgentIdFromReceipt(receipt.logs as EventLog[])

    // Set metadata
    await this.setWorkerMetadata(agentId, worker)

    // Set endpoint
    await this.setEndpoint(agentId, endpoint)

    // Add tag
    await this.addTag(agentId, WORKER_TAG)

    return { agentId, txHash: registerTx }
  }

  /**
   * Update worker metadata on-chain
   */
  async updateWorker(
    agentId: bigint,
    worker: WorkerdWorkerDefinition,
  ): Promise<`0x${string}`> {
    await this.setWorkerMetadata(agentId, worker)

    // Invalidate cache
    this.cache.delete(`worker:${agentId}`)

    // Return last tx hash
    return '0x' as `0x${string}`
  }

  private async setWorkerMetadata(
    agentId: bigint,
    worker: WorkerdWorkerDefinition,
  ): Promise<void> {
    if (!this.walletClient || !this.account) {
      throw new Error('Wallet not configured')
    }

    const metadataEntries: [string, string][] = [
      [WORKER_CODE_CID_KEY, worker.codeCid],
      [WORKER_VERSION_KEY, String(worker.version)],
      [WORKER_MEMORY_KEY, String(worker.memoryMb)],
      [WORKER_TIMEOUT_KEY, String(worker.timeoutMs)],
    ]

    for (const [key, value] of metadataEntries) {
      const { request } = await this.publicClient.simulateContract({
        address: this.registryAddress,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'setMetadata',
        args: [
          agentId,
          key,
          `0x${Buffer.from(value).toString('hex')}` as `0x${string}`,
        ],
        account: this.account,
      })

      await this.walletClient.writeContract(request)
    }
  }

  private async setEndpoint(agentId: bigint, endpoint: string): Promise<void> {
    if (!this.walletClient || !this.account) return

    const { request } = await this.publicClient.simulateContract({
      address: this.registryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'setA2AEndpoint',
      args: [agentId, endpoint],
      account: this.account,
    })

    await this.walletClient.writeContract(request)
  }

  private async addTag(agentId: bigint, tag: string): Promise<void> {
    if (!this.walletClient || !this.account) return

    const { request } = await this.publicClient.simulateContract({
      address: this.registryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'addTag',
      args: [agentId, tag],
      account: this.account,
    })

    await this.walletClient.writeContract(request)
  }

  /**
   * Extract agentId from transaction receipt logs by finding Transfer event
   */
  private extractAgentIdFromReceipt(logs: EventLog[]): bigint {
    // Type for decoded Transfer event
    type DecodedTransferEvent = {
      eventName: 'Transfer'
      args: { from: Address; to: Address; tokenId: bigint }
    }

    const transferLog = logs.find((log) => {
      try {
        const decoded = decodeEventLog({
          abi: IDENTITY_REGISTRY_ABI,
          data: log.data,
          topics: log.topics,
        }) as DecodedTransferEvent
        return decoded.eventName === 'Transfer'
      } catch {
        return false
      }
    })

    if (!transferLog) {
      throw new Error('Transfer event not found in registration transaction')
    }

    const decoded = decodeEventLog({
      abi: IDENTITY_REGISTRY_ABI,
      data: transferLog.data,
      topics: transferLog.topics,
    }) as DecodedTransferEvent

    return decoded.args.tokenId
  }

  // ============================================================================
  // Worker Discovery
  // ============================================================================

  /**
   * Get all registered workers
   */
  async getWorkers(): Promise<WorkerRegistration[]> {
    const agentIds = (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'getAgentsByTag',
      args: [WORKER_TAG],
    })) as bigint[]

    const workers: WorkerRegistration[] = []
    for (const agentId of agentIds) {
      const worker = await this.getWorker(agentId)
      if (worker) {
        workers.push(worker)
      }
    }

    return workers
  }

  /**
   * Get a specific worker by agent ID
   */
  async getWorker(agentId: bigint): Promise<WorkerRegistration | null> {
    const cacheKey = `worker:${agentId}`
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data as WorkerRegistration
    }

    const agent = (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'getAgent',
      args: [agentId],
    })) as { owner: Address; registeredAt: bigint; isBanned: boolean }

    if (
      !agent.owner ||
      agent.owner === '0x0000000000000000000000000000000000000000'
    ) {
      return null
    }

    const endpoint = (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'getA2AEndpoint',
      args: [agentId],
    })) as string

    const codeCid = await this.getMetadataString(agentId, WORKER_CODE_CID_KEY)
    const version = parseInt(
      (await this.getMetadataString(agentId, WORKER_VERSION_KEY)) || '1',
      10,
    )
    const memoryMb = parseInt(
      (await this.getMetadataString(agentId, WORKER_MEMORY_KEY)) || '128',
      10,
    )
    const timeoutMs = parseInt(
      (await this.getMetadataString(agentId, WORKER_TIMEOUT_KEY)) || '30000',
      10,
    )

    const worker: WorkerRegistration = {
      workerId: agentId.toString(),
      agentId,
      owner: agent.owner,
      codeCid: codeCid || '',
      version,
      memoryMb,
      timeoutMs,
      endpoint,
      registeredAt: Number(agent.registeredAt),
      isActive: !agent.isBanned,
    }

    this.cache.set(cacheKey, {
      data: worker,
      expiresAt: Date.now() + this.cacheExpiry,
    })
    return worker
  }

  private async getMetadataString(
    agentId: bigint,
    key: string,
  ): Promise<string> {
    const value = (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'getMetadata',
      args: [agentId, key],
    })) as `0x${string}`

    if (!value || value === '0x') return ''
    return Buffer.from(value.slice(2), 'hex').toString('utf-8')
  }

  // ============================================================================
  // Worker Node Discovery
  // ============================================================================

  /**
   * Register this node as a worker execution node
   */
  async registerNode(
    endpoint: string,
    region: string,
    capabilities: string[],
  ): Promise<{ agentId: bigint; txHash: `0x${string}` }> {
    if (!this.walletClient || !this.account) {
      throw new Error('Wallet not configured')
    }

    const tokenURI = `data:application/json,${encodeURIComponent(
      JSON.stringify({
        name: `DWS Worker Node - ${region}`,
        description: 'DWS Worker Execution Node',
        properties: {
          type: 'dws-worker-node',
          region,
          capabilities,
        },
      }),
    )}`

    const { request: registerRequest } =
      await this.publicClient.simulateContract({
        address: this.registryAddress,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'register',
        args: [tokenURI],
        account: this.account,
      })

    const registerTx = await this.walletClient.writeContract(registerRequest)

    const receipt = await this.publicClient.waitForTransactionReceipt({
      hash: registerTx,
    })

    // Parse agentId from Transfer event (ERC-721 mint emits Transfer with tokenId)
    const agentId = this.extractAgentIdFromReceipt(receipt.logs as EventLog[])

    // Set endpoint and metadata
    await this.setEndpoint(agentId, endpoint)
    await this.setNodeMetadata(agentId, region, capabilities)
    await this.addTag(agentId, WORKER_NODE_TAG)

    return { agentId, txHash: registerTx }
  }

  private async setNodeMetadata(
    agentId: bigint,
    region: string,
    capabilities: string[],
  ): Promise<void> {
    if (!this.walletClient || !this.account) return

    const entries: [string, string][] = [
      [WORKER_REGION_KEY, region],
      [WORKER_CAPABILITIES_KEY, capabilities.join(',')],
    ]

    for (const [key, value] of entries) {
      const { request } = await this.publicClient.simulateContract({
        address: this.registryAddress,
        abi: IDENTITY_REGISTRY_ABI,
        functionName: 'setMetadata',
        args: [
          agentId,
          key,
          `0x${Buffer.from(value).toString('hex')}` as `0x${string}`,
        ],
        account: this.account,
      })

      await this.walletClient.writeContract(request)
    }
  }

  /**
   * Get all worker execution nodes
   */
  async getNodes(): Promise<WorkerNode[]> {
    const agentIds = (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'getAgentsByTag',
      args: [WORKER_NODE_TAG],
    })) as bigint[]

    const nodes: WorkerNode[] = []
    for (const agentId of agentIds) {
      const node = await this.getNode(agentId)
      if (node?.isActive) {
        nodes.push(node)
      }
    }

    return nodes
  }

  /**
   * Get a specific node
   */
  async getNode(agentId: bigint): Promise<WorkerNode | null> {
    const cacheKey = `node:${agentId}`
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.data as WorkerNode
    }

    const agent = (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'getAgent',
      args: [agentId],
    })) as {
      owner: Address
      stakedAmount: bigint
      isBanned: boolean
      lastActivityAt: bigint
    }

    if (
      !agent.owner ||
      agent.owner === '0x0000000000000000000000000000000000000000'
    ) {
      return null
    }

    const endpoint = (await this.publicClient.readContract({
      address: this.registryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'getA2AEndpoint',
      args: [agentId],
    })) as string

    const region =
      (await this.getMetadataString(agentId, WORKER_REGION_KEY)) || 'global'
    const capabilitiesStr = await this.getMetadataString(
      agentId,
      WORKER_CAPABILITIES_KEY,
    )
    const capabilities = capabilitiesStr ? capabilitiesStr.split(',') : []

    const node: WorkerNode = {
      agentId,
      owner: agent.owner,
      endpoint,
      region,
      capabilities,
      stake: agent.stakedAmount,
      isActive: !agent.isBanned,
      lastSeen: Number(agent.lastActivityAt) * 1000,
    }

    this.cache.set(cacheKey, {
      data: node,
      expiresAt: Date.now() + this.cacheExpiry,
    })
    return node
  }

  /**
   * Find best node for executing a worker
   */
  async findBestNode(preferredRegion?: string): Promise<WorkerNode | null> {
    const nodes = await this.getNodes()
    if (nodes.length === 0) return null

    // Sort by region preference, then by stake (higher stake = more trustworthy)
    const sorted = nodes.sort((a, b) => {
      if (preferredRegion) {
        if (a.region === preferredRegion && b.region !== preferredRegion)
          return -1
        if (b.region === preferredRegion && a.region !== preferredRegion)
          return 1
      }
      return Number(b.stake - a.stake)
    })

    // Verify node is healthy
    for (const node of sorted) {
      const healthy = await this.pingNode(node.endpoint)
      if (healthy) return node
    }

    return null
  }

  private async pingNode(endpoint: string): Promise<boolean> {
    const response = await fetch(`${endpoint}/health`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null)
    return response?.ok ?? false
  }

  /**
   * Clear cache
   */
  clearCache(): void {
    this.cache.clear()
  }
}
