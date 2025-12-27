/**
 * EQLite Node Service
 *
 * Integrates EQLite nodes with DWS infrastructure.
 * Handles:
 * - Node registration (on-chain EQLiteRegistry + DWS node registry)
 * - Node lifecycle management
 * - TEE attestation for EQLite nodes
 * - Database provisioning
 */

import {
  EQLiteNodeManager,
  EQLiteNodeRole,
  EQLiteNodeStatus,
  createEQLiteNode,
  type EQLiteNodeConfig,
  type EQLiteNodeState,
} from '@jejunetwork/db'
import type { Address, Hex, PublicClient, WalletClient } from 'viem'
import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  keccak256,
  toBytes,
  toHex,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'
import { NodeRegistry } from './node-registry'
import type { NetworkConfig, NodeCapability, NodeConfig } from './types'

// ============================================================================
// Types
// ============================================================================

export interface EQLiteNodeServiceConfig {
  networkConfig: NetworkConfig
  privateKey: Hex
  workingDir: string
  teeEnabled: boolean
  teeEndpoint?: string
  eqliteRegistryAddress: Address
}

export interface EQLiteNodeInfo {
  nodeId: Hex
  role: EQLiteNodeRole
  status: EQLiteNodeStatus
  endpoint: string
  dwsAgentId?: bigint
  registryNodeId?: Hex
  databaseCount: number
  totalQueries: number
  mrEnclave?: Hex
}

export interface CreateDatabaseParams {
  owner: Address
  nodeCount: number
  useEventualConsistency: boolean
  schema?: string
}

// ============================================================================
// EQLite Registry ABI
// ============================================================================

const EQLITE_REGISTRY_ABI = [
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

// ============================================================================
// EQLite Node Service
// ============================================================================

export class EQLiteNodeService {
  private config: EQLiteNodeServiceConfig
  private nodeManager: EQLiteNodeManager | null = null
  private nodeRegistry: NodeRegistry
  private publicClient: PublicClient
  private walletClient: WalletClient
  private dwsAgentId: bigint | null = null

  constructor(config: EQLiteNodeServiceConfig) {
    this.config = config

    // Initialize node registry
    this.nodeRegistry = new NodeRegistry(config.networkConfig, config.privateKey)

    // Initialize viem clients
    const account = privateKeyToAccount(config.privateKey)

    this.publicClient = createPublicClient({
      transport: http(config.networkConfig.rpcUrl),
    })

    this.walletClient = createWalletClient({
      account,
      transport: http(config.networkConfig.rpcUrl),
    })
  }

  /**
   * Start a EQLite node (block producer or miner)
   */
  async startNode(params: {
    role: EQLiteNodeRole
    listenAddr?: string
    rpcPort?: number
    p2pPort?: number
    stakeAmount: bigint
    region?: string
  }): Promise<EQLiteNodeInfo> {
    const nodeId = keccak256(
      toBytes(`eqlite-${params.role}-${Date.now()}-${this.config.privateKey.slice(0, 10)}`),
    ) as Hex

    console.log(`[EQLite Service] Starting ${EQLiteNodeRole[params.role]} node: ${nodeId}`)

    // 1. Create EQLite node manager
    const nodeConfig: Partial<EQLiteNodeConfig> & { role: EQLiteNodeRole } = {
      nodeId,
      role: params.role,
      workingDir: `${this.config.workingDir}/${nodeId.slice(2, 10)}`,
      listenAddr: params.listenAddr ?? '0.0.0.0:4661',
      rpcPort: params.rpcPort ?? 4661,
      p2pPort: params.p2pPort ?? 4662,
      privateKeyPath: `${this.config.workingDir}/keys/private.key`,
      teeEnabled: this.config.teeEnabled,
      teeProvider: this.config.teeEnabled ? 'intel_tdx' : 'simulator',
      teeEndpoint: this.config.teeEndpoint,
    }

    this.nodeManager = createEQLiteNode(nodeConfig)

    // 2. Initialize and start EQLite node
    await this.nodeManager.initialize()
    await this.nodeManager.start()

    const state = this.nodeManager.getState()

    // 3. Register on EQLite Registry (on-chain)
    const endpoint = `http://localhost:${params.rpcPort ?? 4661}`

    await this.registerOnChain(nodeId, params.role, endpoint, params.stakeAmount)

    // 4. Submit TEE attestation if available
    if (state.mrEnclave && state.attestation) {
      await this.submitAttestationOnChain(
        nodeId,
        state.attestation as Hex,
        state.mrEnclave,
      )
    }

    // 5. Register in DWS node registry
    const capability: NodeCapability =
      params.role === EQLiteNodeRole.BLOCK_PRODUCER ? 'eqlite-bp' : 'eqlite-miner'

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
      pricePerHour: 0n, // EQLite nodes earn through mining rewards
      pricePerGb: 0n,
      pricePerRequest: 0n,
      region: params.region,
    })

    this.dwsAgentId = dwsResult.agentId

    console.log(`[EQLite Service] Node started: ${nodeId}`)
    console.log(`[EQLite Service] DWS Agent ID: ${dwsResult.agentId}`)

    // 6. Start heartbeat loop
    this.startHeartbeatLoop(nodeId)

    return {
      nodeId,
      role: params.role,
      status: EQLiteNodeStatus.ACTIVE,
      endpoint,
      dwsAgentId: dwsResult.agentId,
      registryNodeId: nodeId,
      databaseCount: 0,
      totalQueries: 0,
      mrEnclave: state.mrEnclave as Hex | undefined,
    }
  }

  /**
   * Stop the EQLite node
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
  async getNodeStatus(): Promise<EQLiteNodeInfo | null> {
    if (!this.nodeManager) return null

    const state = this.nodeManager.getState()

    return {
      nodeId: state.nodeId,
      role: state.role,
      status: state.status,
      endpoint: state.endpoint,
      dwsAgentId: this.dwsAgentId ?? undefined,
      databaseCount: state.databaseCount,
      totalQueries: state.totalQueries,
      mrEnclave: state.mrEnclave as Hex | undefined,
    }
  }

  /**
   * Get list of active miners
   */
  async getActiveMiners(): Promise<Hex[]> {
    const result = await this.publicClient.readContract({
      address: this.config.eqliteRegistryAddress,
      abi: EQLITE_REGISTRY_ABI,
      functionName: 'getActiveMiners',
    })

    return result as Hex[]
  }

  /**
   * Get list of active block producers
   */
  async getActiveBlockProducers(): Promise<Hex[]> {
    const result = await this.publicClient.readContract({
      address: this.config.eqliteRegistryAddress,
      abi: EQLITE_REGISTRY_ABI,
      functionName: 'getActiveBlockProducers',
    })

    return result as Hex[]
  }

  /**
   * Create a new EQLite database
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
      abi: EQLITE_REGISTRY_ABI,
      functionName: 'createDatabase',
      args: [databaseId, selectedMiners],
    })

    const txHash = await this.walletClient.sendTransaction({
      to: this.config.eqliteRegistryAddress,
      data,
    })

    await this.publicClient.waitForTransactionReceipt({ hash: txHash })

    console.log(`[EQLite Service] Database created: ${databaseId}`)
    console.log(`[EQLite Service] Assigned to miners: ${selectedMiners.join(', ')}`)

    return databaseId
  }

  // ============================================================================
  // Private Methods
  // ============================================================================

  private async registerOnChain(
    nodeId: Hex,
    role: EQLiteNodeRole,
    endpoint: string,
    stakeAmount: bigint,
  ): Promise<void> {
    const data = encodeFunctionData({
      abi: EQLITE_REGISTRY_ABI,
      functionName: 'registerNode',
      args: [nodeId, role, endpoint, stakeAmount],
    })

    const txHash = await this.walletClient.sendTransaction({
      to: this.config.eqliteRegistryAddress,
      data,
    })

    await this.publicClient.waitForTransactionReceipt({ hash: txHash })

    console.log(`[EQLite Service] Registered on-chain: ${txHash}`)
  }

  private async submitAttestationOnChain(
    nodeId: Hex,
    attestation: Hex,
    mrEnclave: Hex,
  ): Promise<void> {
    const data = encodeFunctionData({
      abi: EQLITE_REGISTRY_ABI,
      functionName: 'submitAttestation',
      args: [nodeId, attestation, mrEnclave],
    })

    const txHash = await this.walletClient.sendTransaction({
      to: this.config.eqliteRegistryAddress,
      data,
    })

    await this.publicClient.waitForTransactionReceipt({ hash: txHash })

    console.log(`[EQLite Service] Attestation submitted: ${txHash}`)
  }

  private startHeartbeatLoop(nodeId: Hex): void {
    const interval = setInterval(async () => {
      if (!this.nodeManager) {
        clearInterval(interval)
        return
      }

      const state = this.nodeManager.getState()

      if (state.status !== EQLiteNodeStatus.ACTIVE) {
        return
      }

      // Send heartbeat to on-chain registry
      const data = encodeFunctionData({
        abi: EQLITE_REGISTRY_ABI,
        functionName: 'heartbeat',
        args: [nodeId, BigInt(state.totalQueries)],
      })

      try {
        await this.walletClient.sendTransaction({
          to: this.config.eqliteRegistryAddress,
          data,
        })
      } catch (err) {
        console.error(`[EQLite Service] Heartbeat failed:`, err)
      }

      // Also send heartbeat to DWS registry
      if (this.dwsAgentId) {
        try {
          await this.nodeRegistry.heartbeat(this.dwsAgentId)
        } catch (err) {
          console.error(`[EQLite Service] DWS heartbeat failed:`, err)
        }
      }
    }, 60000) // Every minute
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createEQLiteNodeService(
  config: EQLiteNodeServiceConfig,
): EQLiteNodeService {
  return new EQLiteNodeService(config)
}


