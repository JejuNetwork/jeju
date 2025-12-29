/**
 * SQLIT Node Service
 *
 * Integrates SQLIT nodes with DWS infrastructure.
 * Handles:
 * - Node registration (on-chain SQLitRegistry + DWS node registry)
 * - Node lifecycle management
 * - TEE attestation for SQLIT nodes
 * - Database provisioning
 */

import { getLocalhostHost, INFRA_PORTS } from '@jejunetwork/config'
import {
  createSQLitNode,
  type SQLitNodeConfig,
  type SQLitNodeManager,
  SQLitNodeRole,
  SQLitNodeStatus,
} from '@jejunetwork/db'
import type {
  Address,
  Chain,
  Hex,
  HttpTransport,
  PublicClient,
  WalletClient,
} from 'viem'
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodeFunctionData,
  http,
  keccak256,
  toBytes,
} from 'viem'
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia } from 'viem/chains'
import { NodeRegistry } from './node-registry'
import type { NetworkConfig, NodeCapability } from './types'

// ============================================================================
// Types
// ============================================================================

export interface SQLitNodeServiceConfig {
  networkConfig: NetworkConfig
  privateKey: Hex
  workingDir: string
  teeEnabled: boolean
  teeEndpoint?: string
  sqlitRegistryAddress: Address
}

export interface SQLitNodeInfo {
  nodeId: string
  role: SQLitNodeRole
  status: SQLitNodeStatus
  endpoint: string
  dwsAgentId?: bigint
  registryNodeId?: Hex
  databaseCount: number
  totalQueries: number
  mrEnclave?: string
}

export interface CreateDatabaseParams {
  owner: Address
  nodeCount: number
  useEventualConsistency: boolean
  schema?: string
}

// ============================================================================
// SQLIT Registry ABI
// ============================================================================

const SQLIT_REGISTRY_ABI = [
  {
    name: 'registerNode',
    type: 'function',
    inputs: [
      { name: 'nodeId', type: 'bytes32' },
      { name: 'role', type: 'uint8' },
      { name: 'endpoint', type: 'string' },
      { name: 'stakeAmount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'submitAttestation',
    type: 'function',
    inputs: [
      { name: 'nodeId', type: 'bytes32' },
      { name: 'attestation', type: 'bytes' },
      { name: 'mrEnclave', type: 'bytes32' },
    ],
    outputs: [],
  },
  {
    name: 'heartbeat',
    type: 'function',
    inputs: [
      { name: 'nodeId', type: 'bytes32' },
      { name: 'queryCount', type: 'uint256' },
    ],
    outputs: [],
  },
  {
    name: 'createDatabase',
    type: 'function',
    inputs: [
      { name: 'databaseId', type: 'bytes32' },
      { name: 'minerNodeIds', type: 'bytes32[]' },
    ],
    outputs: [],
  },
  {
    name: 'getNode',
    type: 'function',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'operator', type: 'address' },
          { name: 'nodeId', type: 'bytes32' },
          { name: 'role', type: 'uint8' },
          { name: 'status', type: 'uint8' },
          { name: 'stakedAmount', type: 'uint256' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'lastHeartbeat', type: 'uint256' },
          { name: 'endpoint', type: 'string' },
          { name: 'teeAttestation', type: 'bytes' },
          { name: 'mrEnclave', type: 'bytes32' },
          { name: 'databaseCount', type: 'uint256' },
          { name: 'totalQueries', type: 'uint256' },
          { name: 'slashedAmount', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'getActiveMiners',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32[]' }],
  },
  {
    name: 'getActiveBlockProducers',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'bytes32[]' }],
  },
] as const

// Map SQLitNodeRole string values to numeric values for on-chain
const ROLE_TO_NUMBER: Record<SQLitNodeRole, number> = {
  [SQLitNodeRole.BLOCK_PRODUCER]: 0,
  [SQLitNodeRole.MINER]: 1,
  [SQLitNodeRole.ADAPTER]: 2,
  [SQLitNodeRole.FULLNODE]: 3,
}

// ============================================================================
// SQLIT Node Service
// ============================================================================

export class SQLitNodeService {
  private config: SQLitNodeServiceConfig
  private nodeManager: SQLitNodeManager | null = null
  private nodeRegistry: NodeRegistry
  private publicClient: PublicClient
  private walletClient: WalletClient<HttpTransport, Chain, PrivateKeyAccount>
  private chain: Chain
  private dwsAgentId: bigint | null = null

  constructor(config: SQLitNodeServiceConfig) {
    this.config = config

    // Initialize node registry
    this.nodeRegistry = new NodeRegistry(
      config.networkConfig,
      config.privateKey,
    )

    // Initialize viem clients
    const account = privateKeyToAccount(config.privateKey)
    this.chain = this.getChainFromConfig(config.networkConfig)

    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(config.networkConfig.rpcUrl),
    })

    this.walletClient = createWalletClient({
      account,
      chain: this.chain,
      transport: http(config.networkConfig.rpcUrl),
    })
  }

  private getChainFromConfig(config: NetworkConfig): Chain {
    if (config.chainId === 8453) return base
    if (config.chainId === 84532) return baseSepolia
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

  /**
   * Start a SQLIT node (block producer or miner)
   */
  async startNode(params: {
    role: SQLitNodeRole
    listenAddr?: string
    rpcPort?: number
    stakeAmount: bigint
    region?: string
  }): Promise<SQLitNodeInfo> {
    const nodeId = keccak256(
      toBytes(
        `sqlit-${params.role}-${Date.now()}-${this.config.privateKey.slice(0, 10)}`,
      ),
    ) as Hex

    const roleName =
      params.role === SQLitNodeRole.BLOCK_PRODUCER
        ? 'blockproducer'
        : params.role === SQLitNodeRole.MINER
          ? 'miner'
          : params.role === SQLitNodeRole.ADAPTER
            ? 'adapter'
            : 'fullnode'
    console.log(`[SQLIT Service] Starting ${roleName} node: ${nodeId}`)

    // 1. Create SQLIT node manager
    const nodeConfig: SQLitNodeConfig = {
      nodeId,
      role: params.role,
      dataDir: `${this.config.workingDir}/${nodeId.slice(2, 10)}`,
      listenAddr: params.listenAddr ?? '0.0.0.0:4661',
      rpcAddr: params.rpcPort ? `0.0.0.0:${params.rpcPort}` : undefined,
      teeEnabled: this.config.teeEnabled,
      teePlatform: this.config.teeEnabled ? 'intel_tdx' : 'any',
    }

    this.nodeManager = await createSQLitNode(nodeConfig)

    // 2. Node is already started by createSQLitNode
    if (!this.nodeManager) {
      throw new Error('Failed to create SQLIT node manager')
    }

    const state = this.nodeManager.getState()

    // 3. Register on SQLIT Registry (on-chain)
    const host = getLocalhostHost()
    const endpoint = `http://${host}:${params.rpcPort ?? INFRA_PORTS.SQLIT.get()}`

    await this.registerOnChain(
      nodeId,
      params.role,
      endpoint,
      params.stakeAmount,
    )

    // 4. Submit TEE attestation if available
    if (state.attestation?.report) {
      const attestation = state.attestation
      const reportHash = keccak256(toBytes(attestation.report))
      await this.submitAttestationOnChain(
        nodeId,
        attestation.report as Hex,
        reportHash,
      )
    }

    // 5. Register in DWS node registry
    const capability: NodeCapability =
      params.role === SQLitNodeRole.BLOCK_PRODUCER ? 'sqlit-bp' : 'sqlit-miner'

    const dwsResult = await this.nodeRegistry.registerNode({
      endpoint,
      specs: {
        cpuCores: 4,
        memoryMb: 8192,
        storageMb: 102400,
        bandwidthMbps: 1000,
        teePlatform: this.config.teeEnabled ? 'intel_tdx' : 'none',
      },
      capabilities: [capability, 'storage', 'tee'],
      pricePerHour: 0n, // SQLIT nodes earn through mining rewards
      pricePerGb: 0n,
      pricePerRequest: 0n,
      region: params.region,
    })

    this.dwsAgentId = dwsResult.agentId

    console.log(`[SQLIT Service] Node started: ${nodeId}`)
    console.log(`[SQLIT Service] DWS Agent ID: ${dwsResult.agentId}`)

    // 6. Start heartbeat loop
    this.startHeartbeatLoop(nodeId)

    return {
      nodeId: state.nodeId as Hex,
      role: params.role,
      status: SQLitNodeStatus.RUNNING,
      endpoint,
      dwsAgentId: dwsResult.agentId,
      registryNodeId: nodeId,
      databaseCount: state.databaseCount,
      totalQueries: 0,
    }
  }

  /**
   * Stop the SQLIT node
   */
  async stopNode(): Promise<void> {
    if (this.nodeManager) {
      await this.nodeManager.stop()
      this.nodeManager = null
    }
  }

  /**
   * Get node status
   */
  getNodeStatus(): SQLitNodeInfo | null {
    if (!this.nodeManager) return null

    const state = this.nodeManager.getState()

    const config = this.nodeManager.getConfig()
    const rpcPort =
      config.rpcAddr?.split(':')[1] ?? String(INFRA_PORTS.SQLIT.get())
    const host = getLocalhostHost()
    const endpoint = `http://${host}:${rpcPort}`
    return {
      nodeId: state.nodeId as Hex,
      role: state.role,
      status: state.status,
      endpoint,
      dwsAgentId: this.dwsAgentId ?? undefined,
      databaseCount: state.databaseCount,
      totalQueries: 0,
    }
  }

  /**
   * Get list of active miners
   */
  async getActiveMiners(): Promise<Hex[]> {
    const result = await this.publicClient.readContract({
      address: this.config.sqlitRegistryAddress,
      abi: SQLIT_REGISTRY_ABI,
      functionName: 'getActiveMiners',
    })

    return result as Hex[]
  }

  /**
   * Get list of active block producers
   */
  async getActiveBlockProducers(): Promise<Hex[]> {
    const result = await this.publicClient.readContract({
      address: this.config.sqlitRegistryAddress,
      abi: SQLIT_REGISTRY_ABI,
      functionName: 'getActiveBlockProducers',
    })

    return result as Hex[]
  }

  /**
   * Create a new SQLIT database
   */
  async createDatabase(params: CreateDatabaseParams): Promise<Hex> {
    const databaseId = keccak256(
      toBytes(`db-${params.owner}-${Date.now()}`),
    ) as Hex

    // Get active miners and select nodeCount of them
    const activeMiners = await this.getActiveMiners()

    if (activeMiners.length < params.nodeCount) {
      throw new Error(
        `Not enough active miners: need ${params.nodeCount}, have ${activeMiners.length}`,
      )
    }

    // Select miners (simple selection for now - could add scoring)
    const selectedMiners = activeMiners.slice(0, params.nodeCount)

    // Register database on-chain
    const data = encodeFunctionData({
      abi: SQLIT_REGISTRY_ABI,
      functionName: 'createDatabase',
      args: [databaseId, selectedMiners],
    })

    const account = privateKeyToAccount(this.config.privateKey)
    const txHash = await this.walletClient.sendTransaction({
      account,
      to: this.config.sqlitRegistryAddress,
      data,
      chain: null,
    })

    await this.publicClient.waitForTransactionReceipt({ hash: txHash })

    console.log(`[SQLIT Service] Database created: ${databaseId}`)
    console.log(
      `[SQLIT Service] Assigned to miners: ${selectedMiners.join(', ')}`,
    )

    return databaseId
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async registerOnChain(
    nodeId: Hex,
    role: SQLitNodeRole,
    endpoint: string,
    stakeAmount: bigint,
  ): Promise<void> {
    const data = encodeFunctionData({
      abi: SQLIT_REGISTRY_ABI,
      functionName: 'registerNode',
      args: [nodeId, ROLE_TO_NUMBER[role], endpoint, stakeAmount],
    })

    const account = privateKeyToAccount(this.config.privateKey)
    const txHash = await this.walletClient.sendTransaction({
      account,
      to: this.config.sqlitRegistryAddress,
      data,
      chain: null,
    })

    await this.publicClient.waitForTransactionReceipt({ hash: txHash })

    console.log(`[SQLIT Service] Registered on-chain: ${txHash}`)
  }

  private async submitAttestationOnChain(
    nodeId: Hex,
    attestation: Hex,
    mrEnclave: Hex,
  ): Promise<void> {
    const data = encodeFunctionData({
      abi: SQLIT_REGISTRY_ABI,
      functionName: 'submitAttestation',
      args: [nodeId, attestation, mrEnclave],
    })

    const account = privateKeyToAccount(this.config.privateKey)
    const txHash = await this.walletClient.sendTransaction({
      account,
      to: this.config.sqlitRegistryAddress,
      data,
      chain: null,
    })

    await this.publicClient.waitForTransactionReceipt({ hash: txHash })

    console.log(`[SQLIT Service] Attestation submitted: ${txHash}`)
  }

  private startHeartbeatLoop(nodeId: Hex): void {
    const interval = setInterval(async () => {
      if (!this.nodeManager) {
        clearInterval(interval)
        return
      }

      const state = this.nodeManager.getState()

      if (state.status !== SQLitNodeStatus.RUNNING) {
        return
      }

      // Send heartbeat to on-chain registry
      const data = encodeFunctionData({
        abi: SQLIT_REGISTRY_ABI,
        functionName: 'heartbeat',
        args: [nodeId, BigInt(0)],
      })

      try {
        const account = privateKeyToAccount(this.config.privateKey)
        await this.walletClient.sendTransaction({
          account,
          to: this.config.sqlitRegistryAddress,
          data,
          chain: null,
        })
      } catch (err) {
        console.error(`[SQLIT Service] Heartbeat failed:`, err)
      }

      // Also send heartbeat to DWS registry
      if (this.dwsAgentId) {
        try {
          await this.nodeRegistry.heartbeat(this.dwsAgentId)
        } catch (err) {
          console.error(`[SQLIT Service] DWS heartbeat failed:`, err)
        }
      }
    }, 60000) // Every minute
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createSQLitNodeService(
  config: SQLitNodeServiceConfig,
): SQLitNodeService {
  return new SQLitNodeService(config)
}
