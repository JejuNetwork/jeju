/**
 * Decentralized Infrastructure Module
 *
 * Provides fully decentralized compute infrastructure:
 * - No centralized cloud providers
 * - On-chain node registry via ERC-8004
 * - P2P node discovery and coordination
 * - TEE/Proof-of-Cloud for trustless execution
 * - x402 payment integration
 *
 * Architecture:
 *
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                     User / Developer                            │
 * │  - Deploy worker code to IPFS                                   │
 * │  - Register worker on-chain with requirements                   │
 * │  - Pay via x402 or prepaid vault                               │
 * └─────────────────────────────────────────────────────────────────┘
 *                              │
 *                              ▼
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                   On-Chain Registry                             │
 * │  - ERC-8004 IdentityRegistry for nodes                         │
 * │  - Worker registry with requirements                            │
 * │  - Payment vault / x402 facilitator                            │
 * │  - Staking and slashing for node operators                     │
 * └─────────────────────────────────────────────────────────────────┘
 *                              │
 *                              ▼
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                   P2P Network                                   │
 * │  - Node discovery via on-chain registry                        │
 * │  - Health checks and latency probing                           │
 * │  - Gossip for worker announcements                             │
 * │  - Geo-aware routing                                           │
 * └─────────────────────────────────────────────────────────────────┘
 *                              │
 *                              ▼
 * ┌─────────────────────────────────────────────────────────────────┐
 * │                   DWS Nodes                                     │
 * │  - Run by anyone (bare metal, VPS, home server)                │
 * │  - Register with capabilities, pricing, stake                  │
 * │  - Pull worker code from IPFS                                  │
 * │  - Execute in workerd (V8 isolates) or containers             │
 * │  - TEE attestation for trustless execution                    │
 * └─────────────────────────────────────────────────────────────────┘
 *
 * Key Design Principles:
 *
 * 1. NO CENTRALIZED DEPENDENCIES
 *    - No AWS, GCP, Azure management
 *    - Nodes self-provision on any hardware
 *    - All coordination via on-chain + P2P
 *
 * 2. CRYPTOECONOMIC SECURITY
 *    - Nodes stake tokens to participate
 *    - Slashing for misbehavior
 *    - Reputation system based on performance
 *
 * 3. TRUSTLESS EXECUTION
 *    - TEE attestation proves code integrity
 *    - Proof-of-Cloud verifies hardware
 *    - Results can be verified on-chain
 *
 * 4. PERMISSIONLESS PARTICIPATION
 *    - Anyone can run a node
 *    - Anyone can deploy workers
 *    - Market-based pricing
 */

export { createHelmProviderRouter } from './helm-provider'
// Ingress Controller
export {
  type BackendConfig,
  createIngressRouter,
  getIngressController,
  IngressController,
  type IngressRule,
  type PathRule,
} from './ingress'
export { createK3sRouter } from './k3s-provider'
export { DecentralizedNodeRegistry } from './node-registry'
// Service Mesh
export {
  type AccessPolicy,
  createServiceMeshRouter,
  getServiceMesh,
  type ServiceIdentity,
  ServiceMesh,
  type TrafficPolicy,
} from './service-mesh'
// Terraform & Helm Providers
export { createTerraformProviderRouter } from './terraform-provider'
export * from './types'
export {
  DecentralizedWorkerDeployer,
  WorkerAutoScaler,
} from './worker-deployer'

import type { Address, Hex } from 'viem'
import type { BackendManager } from '../storage/backends'
import type { WorkerdExecutor } from '../workers/workerd/executor'
import { DecentralizedNodeRegistry } from './node-registry'
import type { NetworkConfig, NetworkEnvironment } from './types'
import { NETWORK_CONFIGS } from './types'
import {
  DecentralizedWorkerDeployer,
  WorkerAutoScaler,
} from './worker-deployer'

// ============================================================================
// Factory Functions
// ============================================================================

export interface InfrastructureConfig {
  network: NetworkEnvironment
  privateKey?: Hex
  selfEndpoint?: string
}

export interface DecentralizedInfrastructure {
  nodeRegistry: DecentralizedNodeRegistry
  workerDeployer: DecentralizedWorkerDeployer
  autoScaler: WorkerAutoScaler
  networkConfig: NetworkConfig
}

/**
 * Initialize the decentralized infrastructure
 */
export function createDecentralizedInfrastructure(
  config: InfrastructureConfig,
  backendManager: BackendManager,
  workerdExecutor: WorkerdExecutor,
): DecentralizedInfrastructure {
  const networkConfig = NETWORK_CONFIGS[config.network]

  const nodeRegistry = new DecentralizedNodeRegistry(
    networkConfig,
    config.privateKey,
  )

  const workerDeployer = new DecentralizedWorkerDeployer(
    nodeRegistry,
    backendManager,
    workerdExecutor,
  )

  const autoScaler = new WorkerAutoScaler(workerDeployer)

  return {
    nodeRegistry,
    workerDeployer,
    autoScaler,
    networkConfig,
  }
}

/**
 * Start a DWS node and register it on-chain
 */
export async function startDWSNode(
  infra: DecentralizedInfrastructure,
  params: {
    endpoint: string
    capabilities: Array<'compute' | 'storage' | 'cdn' | 'gpu' | 'tee'>
    specs: {
      cpuCores: number
      memoryMb: number
      storageMb: number
      gpuType?: string
      gpuCount?: number
      bandwidthMbps: number
      teePlatform?: 'intel_sgx' | 'intel_tdx' | 'amd_sev'
    }
    pricing: {
      pricePerHour: bigint
      pricePerGb: bigint
      pricePerRequest: bigint
    }
    initialStake?: bigint
    region?: string
  },
): Promise<{ agentId: bigint; txHash: Hex }> {
  const result = await infra.nodeRegistry.registerNode({
    endpoint: params.endpoint,
    specs: {
      ...params.specs,
      teePlatform: params.specs.teePlatform ?? 'none',
    },
    capabilities: params.capabilities,
    pricePerHour: params.pricing.pricePerHour,
    pricePerGb: params.pricing.pricePerGb,
    pricePerRequest: params.pricing.pricePerRequest,
    region: params.region,
    initialStake: params.initialStake,
  })

  // Set self identity in worker deployer
  infra.workerDeployer.setSelf(result.agentId)

  // Start auto-scaler
  infra.autoScaler.start()

  // Start heartbeat
  const heartbeatInterval = setInterval(async () => {
    try {
      await infra.nodeRegistry.heartbeat(result.agentId)
    } catch (err) {
      console.error('[DWS Node] Heartbeat failed:', err)
    }
  }, 60000) // Every minute

  // Cleanup on process exit
  process.on('beforeExit', () => {
    clearInterval(heartbeatInterval)
    infra.autoScaler.stop()
  })

  console.log(`[DWS Node] Registered with agentId ${result.agentId}`)
  return result
}

/**
 * Deploy a worker to the decentralized network
 */
export async function deployWorker(
  infra: DecentralizedInfrastructure,
  params: {
    name: string
    owner: Address
    codeCid: string
    codeHash?: Hex
    entrypoint?: string
    runtime?: 'workerd' | 'bun' | 'docker'
    memory?: number
    timeout?: number
    minInstances?: number
    maxInstances?: number
    scaleToZero?: boolean
    teeRequired?: boolean
    env?: Record<string, string>
  },
) {
  return infra.workerDeployer.deployWorker({
    id: `worker-${Date.now()}`,
    name: params.name,
    owner: params.owner,
    code: {
      cid: params.codeCid,
      hash: params.codeHash ?? ('0x' as Hex),
      entrypoint: params.entrypoint ?? 'index.js',
      runtime: params.runtime ?? 'workerd',
    },
    resources: {
      memoryMb: params.memory ?? 128,
      cpuMillis: 1000,
      timeoutMs: params.timeout ?? 30000,
      maxConcurrency: 10,
    },
    scaling: {
      minInstances: params.minInstances ?? 0,
      maxInstances: params.maxInstances ?? 10,
      targetConcurrency: 5,
      scaleToZero: params.scaleToZero ?? true,
      cooldownMs: 60000,
    },
    requirements: {
      teeRequired: params.teeRequired ?? false,
      gpuRequired: false,
      minNodeReputation: 50,
      minNodeStake: 0n,
    },
    payment: {
      type: 'x402',
    },
    env: params.env ?? {},
    secrets: [],
  })
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Get network configuration by environment
 */
export function getNetworkConfig(env: NetworkEnvironment): NetworkConfig {
  return NETWORK_CONFIGS[env]
}

/**
 * Determine network from chain ID
 */
export function networkFromChainId(chainId: number): NetworkEnvironment | null {
  for (const [env, config] of Object.entries(NETWORK_CONFIGS)) {
    if (config.chainId === chainId) {
      return env as NetworkEnvironment
    }
  }
  return null
}
