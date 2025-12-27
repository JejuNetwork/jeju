/**
 * Compute Integration - On-chain TEE node discovery and verification
 */

import { getRpcUrl } from '@jejunetwork/config'
import type { TEEAttestation } from '@jejunetwork/types'
import {
  type Address,
  createPublicClient,
  type Hex,
  http,
  type PublicClient,
  toHex,
} from 'viem'
import { TEEProvider } from '../types.js'
import { NodeResourcesSchema, validateResponse } from '../validation.js'
import { OAUTH3_TEE_VERIFIER_ABI } from './abis.js'
import {
  ATTESTATION_VALIDITY_MS,
  CACHE_EXPIRY_MS,
  CHAIN_IDS,
  getContracts,
  MIN_STAKE,
} from './config.js'

export interface ComputeConfig {
  rpcUrl?: string
  teeVerifierAddress?: Address
  minStake?: bigint
  chainId?: number
}

export interface ComputeProvider {
  nodeId: Hex
  address: Address
  name: string
  endpoint: string
  stake: bigint
  active: boolean
  attestation: TEEAttestation
  resources: {
    cpuCores: number
    memoryGb: number
    storageGb: number
    teeSupported: boolean
    teeType: TEEProvider
  }
  lastVerified: number
}

export interface OAuth3NodeDeployment {
  deploymentId: Hex
  provider: Address
  nodeId: string
  clusterId: string
  endpoint: string
  status: 'pending' | 'deploying' | 'running' | 'stopped' | 'failed'
  attestation?: TEEAttestation
  stake: bigint
  createdAt: number
  expiresAt?: number
}

export interface DeployNodeParams {
  clusterId: string
  nodeId?: string
  provider?: Address
  durationHours: number
  minStake?: bigint
  config?: {
    chainRpcUrl: string
    chainId: number
    identityRegistryAddress: Address
    appRegistryAddress: Address
    mpcEndpoint?: string
  }
}

const TEE_PROVIDERS: Record<number, TEEProvider> = {
  0: TEEProvider.DSTACK,
  1: TEEProvider.PHALA,
  2: TEEProvider.SIMULATED,
}

/**
 * Compute Service - Discovers and verifies TEE nodes via on-chain registry
 */
export class OAuth3ComputeService {
  private client: PublicClient
  private teeVerifierAddress: Address
  private minStake: bigint
  private nodeCache = new Map<Hex, ComputeProvider>()
  private lastCacheUpdate = 0

  constructor(config: ComputeConfig = {}) {
    const chainId = config.chainId || CHAIN_IDS.localnet
    const contracts = getContracts(chainId)

    this.client = createPublicClient({
      transport: http(config.rpcUrl || getRpcUrl()),
    })
    this.teeVerifierAddress = config.teeVerifierAddress || contracts.teeVerifier
    this.minStake = config.minStake || MIN_STAKE
  }

  async listTEEProviders(): Promise<ComputeProvider[]> {
    if (
      Date.now() - this.lastCacheUpdate < CACHE_EXPIRY_MS &&
      this.nodeCache.size > 0
    ) {
      return Array.from(this.nodeCache.values())
    }

    const activeNodeIds = await this.client.readContract({
      address: this.teeVerifierAddress,
      abi: OAUTH3_TEE_VERIFIER_ABI,
      functionName: 'getActiveNodes',
    })

    const providers: ComputeProvider[] = []
    for (const nodeId of activeNodeIds) {
      const provider = await this.getProviderFromChain(nodeId)
      if (provider && provider.stake >= this.minStake) {
        providers.push(provider)
        this.nodeCache.set(nodeId, provider)
      }
    }

    this.lastCacheUpdate = Date.now()
    return providers.sort((a, b) => Number(b.stake - a.stake))
  }

  private async getProviderFromChain(
    nodeId: Hex,
  ): Promise<ComputeProvider | null> {
    const [nodeData, stake] = await Promise.all([
      this.client.readContract({
        address: this.teeVerifierAddress,
        abi: OAUTH3_TEE_VERIFIER_ABI,
        functionName: 'getNode',
        args: [nodeId],
      }),
      this.client.readContract({
        address: this.teeVerifierAddress,
        abi: OAUTH3_TEE_VERIFIER_ABI,
        functionName: 'getNodeStake',
        args: [nodeId],
      }),
    ])

    const [operator, , attestation, active] = nodeData
    if (!active) return null

    const attestationAge = Date.now() - Number(attestation.timestamp) * 1000
    if (attestationAge > ATTESTATION_VALIDITY_MS) return null

    const teeType = TEE_PROVIDERS[attestation.provider] || TEEProvider.SIMULATED

    return {
      nodeId,
      address: operator,
      name: `TEE Node ${nodeId.slice(0, 8)}`,
      endpoint: '', // Resolved via JNS, then resources fetched
      stake,
      active,
      attestation: {
        quote: toHex(attestation.quote),
        measurement: attestation.measurement,
        reportData: attestation.reportData,
        timestamp: Number(attestation.timestamp) * 1000,
        platform: teeType,
        verified: attestation.verified,
      },
      resources: {
        cpuCores: 0,
        memoryGb: 0,
        storageGb: 0,
        teeSupported: true,
        teeType,
      }, // Populated by getNodeResources
      lastVerified: Date.now(),
    }
  }

  async getNodeResources(
    endpoint: string,
  ): Promise<{ cpuCores: number; memoryGb: number; storageGb: number } | null> {
    if (!endpoint) return null

    const response = await fetch(`${endpoint}/resources`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null)
    if (!response?.ok) return null

    const data = validateResponse(
      NodeResourcesSchema,
      await response.json(),
      'node resources response',
    )
    return {
      cpuCores: data.cpuCores ?? 0,
      memoryGb: data.memoryGb ?? 0,
      storageGb: data.storageGb ?? 0,
    }
  }

  async getBestProvider(options?: {
    minStake?: bigint
    preferredTeeType?: TEEProvider
  }): Promise<ComputeProvider | null> {
    const providers = await this.listTEEProviders()
    return (
      providers.find((p) => {
        if (options?.minStake && p.stake < options.minStake) return false
        if (
          options?.preferredTeeType &&
          p.resources.teeType !== options.preferredTeeType
        )
          return false
        return p.active && p.attestation.verified
      }) || null
    )
  }

  async verifyNodeAttestation(nodeId: Hex): Promise<{
    valid: boolean
    attestation?: TEEAttestation
    stake?: bigint
    error?: string
  }> {
    const isActive = await this.client.readContract({
      address: this.teeVerifierAddress,
      abi: OAUTH3_TEE_VERIFIER_ABI,
      functionName: 'isNodeActive',
      args: [nodeId],
    })

    if (!isActive) return { valid: false, error: 'Node is not active' }

    const [nodeData, stake] = await Promise.all([
      this.client.readContract({
        address: this.teeVerifierAddress,
        abi: OAUTH3_TEE_VERIFIER_ABI,
        functionName: 'getNode',
        args: [nodeId],
      }),
      this.client.readContract({
        address: this.teeVerifierAddress,
        abi: OAUTH3_TEE_VERIFIER_ABI,
        functionName: 'getNodeStake',
        args: [nodeId],
      }),
    ])

    const [, , attestation, active] = nodeData
    if (!active) return { valid: false, error: 'Node is inactive' }
    if (stake < this.minStake)
      return { valid: false, stake, error: `Insufficient stake` }
    if (!attestation.verified)
      return { valid: false, error: 'Attestation not verified' }

    const isTrusted = await this.client.readContract({
      address: this.teeVerifierAddress,
      abi: OAUTH3_TEE_VERIFIER_ABI,
      functionName: 'isTrustedMeasurement',
      args: [attestation.measurement],
    })

    if (!isTrusted) return { valid: false, error: 'Measurement not trusted' }

    const teeType = TEE_PROVIDERS[attestation.provider] || TEEProvider.SIMULATED
    return {
      valid: true,
      attestation: {
        quote: toHex(attestation.quote),
        measurement: attestation.measurement,
        reportData: attestation.reportData,
        timestamp: Number(attestation.timestamp) * 1000,
        platform: teeType,
        verified: attestation.verified,
      },
      stake,
    }
  }

  async verifyNodeSignature(
    nodeId: Hex,
    messageHash: Hex,
    signature: Hex,
  ): Promise<boolean> {
    return this.client.readContract({
      address: this.teeVerifierAddress,
      abi: OAUTH3_TEE_VERIFIER_ABI,
      functionName: 'verifyNodeSignature',
      args: [nodeId, messageHash, signature],
    })
  }

  async getNodeAttestation(endpoint: string): Promise<TEEAttestation | null> {
    const response = await fetch(`${endpoint}/attestation`, {
      signal: AbortSignal.timeout(10000),
    }).catch(() => null)
    return response?.ok ? response.json() : null
  }

  async checkNodeHealth(endpoint: string): Promise<boolean> {
    if (!endpoint) return false
    const response = await fetch(`${endpoint}/health`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null)
    if (!response) return false
    return response.ok
  }

  async getTrustedMeasurements(): Promise<Hex[]> {
    const result = await this.client.readContract({
      address: this.teeVerifierAddress,
      abi: OAUTH3_TEE_VERIFIER_ABI,
      functionName: 'getTrustedMeasurements',
    })
    return [...result]
  }

  async getMinStake(): Promise<bigint> {
    return this.client.readContract({
      address: this.teeVerifierAddress,
      abi: OAUTH3_TEE_VERIFIER_ABI,
      functionName: 'MIN_STAKE',
    })
  }

  async getAttestationValidity(): Promise<bigint> {
    return this.client.readContract({
      address: this.teeVerifierAddress,
      abi: OAUTH3_TEE_VERIFIER_ABI,
      functionName: 'ATTESTATION_VALIDITY',
    })
  }

  getClient(): PublicClient {
    return this.client
  }
  getTeeVerifierAddress(): Address {
    return this.teeVerifierAddress
  }
  clearCache(): void {
    this.nodeCache.clear()
    this.lastCacheUpdate = 0
  }
}

let instance: OAuth3ComputeService | null = null

export function createOAuth3ComputeService(
  config: ComputeConfig = {},
): OAuth3ComputeService {
  if (!instance) instance = new OAuth3ComputeService(config)
  return instance
}

export function resetOAuth3ComputeService(): void {
  instance = null
}
