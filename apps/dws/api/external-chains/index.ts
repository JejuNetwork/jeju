/**
 * External Chain RPC Node Service
 *
 * Manages external blockchain RPC nodes (Ethereum, Arbitrum, Optimism, Base, Solana)
 * deployed via DWS. Nodes are provisioned as containers and registered on-chain.
 *
 * Network Modes:
 * - localnet: Anvil forks mainnet (real Chainlink feeds, fast startup)
 * - testnet: DWS-provisioned nodes, uses ExternalChainProvider contract
 * - mainnet: DWS-provisioned full archive nodes, TEE required
 *
 * No fallback to external RPCs - fully permissionless.
 */

import { getCurrentNetwork, type NetworkType } from '@jejunetwork/config'
import type { Hex } from 'viem'
import { keccak256, toBytes } from 'viem'
import { z } from 'zod'

// ============================================================================
// Types
// ============================================================================

export const ChainTypeSchema = z.enum([
  'ethereum',
  'arbitrum',
  'optimism',
  'base',
  'solana',
  'bitcoin',
])
export type ChainType = z.infer<typeof ChainTypeSchema>

export const NodeStatusSchema = z.enum([
  'pending',
  'provisioning',
  'syncing',
  'active',
  'unhealthy',
  'stopped',
])
export type NodeStatus = z.infer<typeof NodeStatusSchema>

export interface ExternalChainNode {
  nodeId: Hex
  chain: ChainType
  chainId: number
  status: NodeStatus
  rpcEndpoint: string
  wsEndpoint: string
  containerId: string
  provisionedAt: number
  lastHeartbeat: number
  syncProgress: number
  teeEnabled: boolean
  teeAttestation?: Hex
}

export interface NodeConfig {
  chain: ChainType
  chainId: number
  // Localnet: Docker image for Anvil fork
  dockerImage: string
  rpcPort: number
  wsPort: number
  forkUrl?: string
  // Testnet/Mainnet: DWS provisioning config
  dwsImage?: string
  dwsMinMemoryGb?: number
  dwsMinStorageGb?: number
  dwsMinCpuCores?: number
  teeRequired?: boolean
}

// ============================================================================
// Chain Configurations (All Network Modes)
// ============================================================================

const EVM_CHAIN_IDS: Record<string, number> = {
  ethereum: 1,
  arbitrum: 42161,
  optimism: 10,
  base: 8453,
}

const NODE_CONFIGS: Record<ChainType, NodeConfig> = {
  ethereum: {
    chain: 'ethereum',
    chainId: 1,
    // Localnet: Anvil fork
    dockerImage: 'ghcr.io/foundry-rs/foundry:latest',
    rpcPort: 8545,
    wsPort: 8546,
    forkUrl: 'https://1rpc.io/eth',
    // Testnet/Mainnet: reth archive
    dwsImage: 'ghcr.io/paradigmxyz/reth:v1.1.5',
    dwsMinMemoryGb: 64,
    dwsMinStorageGb: 2500,
    dwsMinCpuCores: 16,
    teeRequired: true,
  },
  arbitrum: {
    chain: 'arbitrum',
    chainId: 42161,
    dockerImage: 'ghcr.io/foundry-rs/foundry:latest',
    rpcPort: 8547,
    wsPort: 8548,
    forkUrl: 'https://arb1.arbitrum.io/rpc',
    dwsImage: 'offchainlabs/nitro-node:v3.2.1-d1c5a49',
    dwsMinMemoryGb: 64,
    dwsMinStorageGb: 1000,
    dwsMinCpuCores: 16,
    teeRequired: true,
  },
  optimism: {
    chain: 'optimism',
    chainId: 10,
    dockerImage: 'ghcr.io/foundry-rs/foundry:latest',
    rpcPort: 8549,
    wsPort: 8550,
    forkUrl: 'https://mainnet.optimism.io',
    dwsImage: 'ghcr.io/paradigmxyz/op-reth:v1.1.5',
    dwsMinMemoryGb: 64,
    dwsMinStorageGb: 800,
    dwsMinCpuCores: 16,
    teeRequired: true,
  },
  base: {
    chain: 'base',
    chainId: 8453,
    dockerImage: 'ghcr.io/foundry-rs/foundry:latest',
    rpcPort: 8551,
    wsPort: 8552,
    forkUrl: 'https://mainnet.base.org',
    dwsImage: 'ghcr.io/paradigmxyz/op-reth:v1.1.5',
    dwsMinMemoryGb: 64,
    dwsMinStorageGb: 600,
    dwsMinCpuCores: 16,
    teeRequired: true,
  },
  solana: {
    chain: 'solana',
    chainId: 101,
    dockerImage: 'solanalabs/solana:v1.18.26',
    rpcPort: 8899,
    wsPort: 8900,
    dwsImage: 'solanalabs/solana:v2.1.0',
    dwsMinMemoryGb: 128,
    dwsMinStorageGb: 2000,
    dwsMinCpuCores: 16,
    teeRequired: true,
  },
  bitcoin: {
    chain: 'bitcoin',
    chainId: 0,
    dockerImage: 'bitcoin/bitcoin:27.0',
    rpcPort: 18443,
    wsPort: 0,
    dwsImage: 'bitcoin/bitcoin:27.0',
    dwsMinMemoryGb: 16,
    dwsMinStorageGb: 1000,
    dwsMinCpuCores: 8,
    teeRequired: false,
  },
}

// DWS endpoints by network (for testnet/mainnet)
const DWS_ENDPOINTS: Record<NetworkType, string> = {
  localnet: 'http://localhost:4010',
  testnet: 'https://dws.testnet.jejunetwork.org',
  mainnet: 'https://dws.jejunetwork.org',
}

// ============================================================================
// External RPC Node Service
// ============================================================================

export class ExternalRPCNodeService {
  private nodes: Map<string, ExternalChainNode> = new Map()
  private network: NetworkType
  private heartbeatIntervals: Map<string, Timer> = new Map()
  private initialized = false

  constructor() {
    this.network = getCurrentNetwork()
  }

  async initialize(): Promise<void> {
    if (this.initialized) return

    console.log('[ExternalRPCNodes] Initializing...')
    console.log(`[ExternalRPCNodes] Network: ${this.network}`)

    await this.loadNodeState()

    this.initialized = true
    console.log('[ExternalRPCNodes] Initialized')
  }

  /**
   * Provision a new external chain node
   * - localnet: Starts Docker container with Anvil fork
   * - testnet/mainnet: Requests node from DWS network
   */
  async provisionNode(chain: ChainType): Promise<ExternalChainNode> {
    const config = NODE_CONFIGS[chain]
    if (!config) {
      throw new Error(`Unsupported chain: ${chain}`)
    }

    // Check if node already exists
    const existingNode = this.nodes.get(chain)
    if (existingNode && existingNode.status !== 'stopped') {
      console.log(`[ExternalRPCNodes] Node already exists: ${chain}`)
      return existingNode
    }

    const nodeId = this.generateNodeId(chain)

    if (this.network === 'localnet') {
      return this.provisionLocalNode(chain, config, nodeId)
    } else {
      return this.provisionDWSNode(chain, config, nodeId)
    }
  }

  /**
   * Provision node locally (Docker container with Anvil fork)
   */
  private async provisionLocalNode(
    chain: ChainType,
    config: NodeConfig,
    nodeId: Hex,
  ): Promise<ExternalChainNode> {
    const containerName = `jeju-${chain}-localnet`

    console.log(`[ExternalRPCNodes] Provisioning local ${chain} node...`)

    const node: ExternalChainNode = {
      nodeId,
      chain,
      chainId: config.chainId,
      status: 'provisioning',
      rpcEndpoint: `http://localhost:${config.rpcPort}`,
      wsEndpoint: config.wsPort ? `ws://localhost:${config.wsPort}` : '',
      containerId: containerName,
      provisionedAt: Date.now(),
      lastHeartbeat: Date.now(),
      syncProgress: 0,
      teeEnabled: false,
    }

    this.nodes.set(chain, node)

    await this.startLocalContainer(config, containerName)
    await this.waitForNodeReady(node)
    this.startHeartbeat(node)

    return node
  }

  /**
   * Provision node via DWS (testnet/mainnet)
   */
  private async provisionDWSNode(
    chain: ChainType,
    config: NodeConfig,
    _nodeId: Hex,
  ): Promise<ExternalChainNode> {
    console.log(`[ExternalRPCNodes] Requesting ${chain} node from DWS...`)

    const dwsEndpoint = DWS_ENDPOINTS[this.network]

    // Request node from DWS
    const response = await fetch(`${dwsEndpoint}/api/external-chains/provision`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chain,
        chainId: config.chainId,
        image: config.dwsImage,
        minMemoryGb: config.dwsMinMemoryGb,
        minStorageGb: config.dwsMinStorageGb,
        minCpuCores: config.dwsMinCpuCores,
        teeRequired: this.network === 'mainnet' && config.teeRequired,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`DWS provisioning failed: ${error}`)
    }

    const result = (await response.json()) as {
      nodeId: string
      rpcEndpoint: string
      wsEndpoint?: string
      status: string
    }

    const node: ExternalChainNode = {
      nodeId: result.nodeId as Hex,
      chain,
      chainId: config.chainId,
      status: result.status as NodeStatus,
      rpcEndpoint: result.rpcEndpoint,
      wsEndpoint: result.wsEndpoint ?? '',
      containerId: result.nodeId,
      provisionedAt: Date.now(),
      lastHeartbeat: Date.now(),
      syncProgress: 0,
      teeEnabled: this.network === 'mainnet',
    }

    this.nodes.set(chain, node)

    // Wait for node to sync
    await this.waitForDWSNodeReady(node, dwsEndpoint)
    this.startHeartbeat(node)

    return node
  }

  /**
   * Start local Docker container
   */
  private async startLocalContainer(
    config: NodeConfig,
    containerName: string,
  ): Promise<void> {
    const { spawn } = await import('bun')

    // Check if container exists
    const checkProc = spawn(['docker', 'ps', '-aq', '-f', `name=${containerName}`])
    const checkOutput = await new Response(checkProc.stdout).text()

    if (checkOutput.trim()) {
      // Container exists - start it
      console.log(`[ExternalRPCNodes] Starting existing container: ${containerName}`)
      const startProc = spawn(['docker', 'start', containerName])
      await startProc.exited
      return
    }

    // Build command based on chain type
    const args: string[] = ['run', '-d', '--name', containerName]

    if (config.forkUrl && config.chainId > 0) {
      // EVM chain - use Anvil fork
      args.push('-p', `${config.rpcPort}:8545`)
      if (config.wsPort) {
        args.push('-p', `${config.wsPort}:8546`)
      }
      args.push('--entrypoint', 'anvil')
      args.push(config.dockerImage)
      args.push(
        '--fork-url', config.forkUrl,
        '--chain-id', String(config.chainId),
        '--host', '0.0.0.0',
        '--port', '8545',
        '--block-time', '2',
      )
    } else if (config.chain === 'solana') {
      // Force x86_64 platform for ARM Macs
      args.push('--platform', 'linux/amd64')
      args.push(
        '-p', `${config.rpcPort}:8899`,
        '-p', `${config.wsPort}:8900`,
        '-p', '9900:9900',
      )
      args.push(config.dockerImage)
      // Build solana-test-validator command
      const solanaArgs = [
        'solana-test-validator',
        '--bind-address', '0.0.0.0',
        '--rpc-port', '8899',
        '--faucet-port', '9900',
        '--reset',
        '--quiet',
      ]
      // Add --no-bpf-jit on ARM architecture for compatibility
      if (process.arch === 'arm64' || process.arch === 'arm') {
        console.log('[ExternalRPCNodes] ARM detected, using --no-bpf-jit for Solana')
        solanaArgs.push('--no-bpf-jit')
      }
      args.push(...solanaArgs)
    } else if (config.chain === 'bitcoin') {
      args.push(
        '-p', `${config.rpcPort}:18443`,
        '-p', '18444:18444',
      )
      args.push(config.dockerImage)
      args.push(
        '-regtest',
        '-server',
        '-rpcuser=jeju',
        '-rpcpassword=jejudev',
        '-rpcallowip=0.0.0.0/0',
        '-rpcbind=0.0.0.0',
      )
    }

    console.log(`[ExternalRPCNodes] Creating container: ${containerName}`)
    const proc = spawn(['docker', ...args])
    const exitCode = await proc.exited

    if (exitCode !== 0) {
      const stderr = await new Response(proc.stderr).text()
      throw new Error(`Failed to start container: ${stderr}`)
    }
  }

  /**
   * Wait for local node to be ready
   */
  private async waitForNodeReady(
    node: ExternalChainNode,
    timeoutMs = 60_000,
  ): Promise<void> {
    const startTime = Date.now()
    const pollInterval = 2000

    console.log(`[ExternalRPCNodes] Waiting for ${node.chain} to be ready...`)

    while (Date.now() - startTime < timeoutMs) {
      const healthy = await this.checkNodeHealth(node)
      if (healthy) {
        node.status = 'active'
        node.syncProgress = 100
        console.log(`[ExternalRPCNodes] ${node.chain} is ready`)
        return
      }

      await Bun.sleep(pollInterval)
    }

    node.status = 'unhealthy'
    console.warn(`[ExternalRPCNodes] ${node.chain} timed out - may still be syncing`)
  }

  /**
   * Wait for DWS-provisioned node to be ready
   */
  private async waitForDWSNodeReady(
    node: ExternalChainNode,
    dwsEndpoint: string,
    timeoutMs = 300_000, // 5 minutes for full nodes
  ): Promise<void> {
    const startTime = Date.now()
    const pollInterval = 10_000

    console.log(`[ExternalRPCNodes] Waiting for DWS ${node.chain} node...`)

    while (Date.now() - startTime < timeoutMs) {
      const response = await fetch(
        `${dwsEndpoint}/api/external-chains/status/${node.nodeId}`,
      ).catch(() => null)

      if (response?.ok) {
        const status = (await response.json()) as { status: string; syncProgress: number }
        node.status = status.status as NodeStatus
        node.syncProgress = status.syncProgress

        if (status.status === 'active') {
          console.log(`[ExternalRPCNodes] DWS ${node.chain} node ready`)
          return
        }

        console.log(
          `[ExternalRPCNodes] DWS ${node.chain}: ${status.status} (${status.syncProgress}%)`,
        )
      }

      await Bun.sleep(pollInterval)
    }

    node.status = 'syncing'
    console.warn(`[ExternalRPCNodes] DWS ${node.chain} still syncing`)
  }

  /**
   * Check if a node is healthy
   */
  private async checkNodeHealth(node: ExternalChainNode): Promise<boolean> {
    if (node.chainId > 0 && node.chain !== 'solana' && node.chain !== 'bitcoin') {
      // EVM chain
      const response = await fetch(node.rpcEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_chainId',
          params: [],
          id: 1,
        }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => null)

      if (!response) return false

      const result = (await response.json().catch(() => null)) as { result?: string } | null
      if (!result?.result) return false

      const chainId = parseInt(result.result, 16)
      return chainId === node.chainId
    }

    if (node.chain === 'solana') {
      const response = await fetch(node.rpcEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'getHealth', id: 1 }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => null)

      if (!response) return false
      const result = (await response.json().catch(() => null)) as { result?: string } | null
      return result?.result === 'ok'
    }

    if (node.chain === 'bitcoin') {
      const response = await fetch(node.rpcEndpoint, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${btoa('jeju:jejudev')}`,
        },
        body: JSON.stringify({
          jsonrpc: '1.0',
          method: 'getblockchaininfo',
          params: [],
          id: 1,
        }),
        signal: AbortSignal.timeout(5000),
      }).catch(() => null)

      return !!response?.ok
    }

    return false
  }

  /**
   * Start periodic heartbeat
   */
  private startHeartbeat(node: ExternalChainNode): void {
    const interval = setInterval(async () => {
      const healthy = await this.checkNodeHealth(node)
      node.lastHeartbeat = Date.now()

      if (healthy && node.status === 'unhealthy') {
        node.status = 'active'
        console.log(`[ExternalRPCNodes] ${node.chain} recovered`)
      } else if (!healthy && node.status === 'active') {
        node.status = 'unhealthy'
        console.warn(`[ExternalRPCNodes] ${node.chain} became unhealthy`)
      }
    }, 30_000)

    this.heartbeatIntervals.set(node.chain, interval)
  }

  /**
   * Stop a node
   */
  async stopNode(chain: ChainType): Promise<void> {
    const node = this.nodes.get(chain)
    if (!node) return

    const interval = this.heartbeatIntervals.get(chain)
    if (interval) {
      clearInterval(interval)
      this.heartbeatIntervals.delete(chain)
    }

    if (this.network === 'localnet') {
      const { spawn } = await import('bun')
      const proc = spawn(['docker', 'stop', node.containerId])
      await proc.exited
    }

    node.status = 'stopped'
    console.log(`[ExternalRPCNodes] Stopped ${chain}`)
  }

  /**
   * Get a node's RPC endpoint (null if not active)
   */
  getRpcEndpoint(chain: ChainType): string | null {
    const node = this.nodes.get(chain)
    if (!node || node.status !== 'active') {
      return null
    }
    return node.rpcEndpoint
  }

  /**
   * Get RPC endpoint by chain ID
   */
  getRpcEndpointByChainId(chainId: number): string | null {
    const chainName = Object.entries(EVM_CHAIN_IDS).find(
      ([, id]) => id === chainId,
    )?.[0] as ChainType | undefined

    if (!chainName) return null
    return this.getRpcEndpoint(chainName)
  }

  /**
   * Get all active nodes
   */
  getActiveNodes(): ExternalChainNode[] {
    return Array.from(this.nodes.values()).filter((n) => n.status === 'active')
  }

  /**
   * Get node status
   */
  getNodeStatus(chain: ChainType): ExternalChainNode | null {
    return this.nodes.get(chain) ?? null
  }

  /**
   * Check if all EVM nodes are active
   */
  areEVMNodesReady(): boolean {
    const evmChains: ChainType[] = ['ethereum', 'arbitrum', 'optimism', 'base']
    return evmChains.every((chain) => {
      const node = this.nodes.get(chain)
      return node?.status === 'active'
    })
  }

  /**
   * Get network mode
   */
  getNetwork(): NetworkType {
    return this.network
  }

  private generateNodeId(chain: ChainType): Hex {
    return keccak256(toBytes(`${chain}:${this.network}:${Date.now()}`))
  }

  private async loadNodeState(): Promise<void> {
    // TODO: Load from CQL or on-chain registry for testnet/mainnet
  }

  async shutdown(): Promise<void> {
    console.log('[ExternalRPCNodes] Shutting down...')

    for (const chain of this.nodes.keys()) {
      await this.stopNode(chain as ChainType)
    }

    this.nodes.clear()
    this.heartbeatIntervals.clear()
    this.initialized = false
  }
}

// ============================================================================
// Singleton
// ============================================================================

let instance: ExternalRPCNodeService | null = null

export function getExternalRPCNodeService(): ExternalRPCNodeService {
  if (!instance) {
    instance = new ExternalRPCNodeService()
  }
  return instance
}

export async function initializeExternalRPCNodes(): Promise<ExternalRPCNodeService> {
  const service = getExternalRPCNodeService()
  await service.initialize()
  return service
}

export const externalRPCNodes = {
  get: getExternalRPCNodeService,
  init: initializeExternalRPCNodes,
}
