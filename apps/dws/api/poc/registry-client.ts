/**
 * Proof-of-Cloud Registry Client
 *
 * Decentralized access pattern:
 * 1. On-chain: Query ProofOfCloudValidator contract (primary source of truth)
 * 2. Off-chain: Multiple API endpoints with failover (cache/performance)
 *
 * Configuration is loaded from packages/config:
 * - Validator address: contracts.json -> external.baseSepolia.poc.validator
 * - RPC URL: contracts.json -> external.baseSepolia.rpcUrl (Jeju's own node)
 */

import { getCurrentNetwork, getPoCConfig } from '@jejunetwork/config'
import { readContract } from '@jejunetwork/contracts'
import {
  type Address,
  type Chain,
  createPublicClient,
  type Hex,
  http,
} from 'viem'
import { base, baseSepolia } from 'viem/chains'
import { RevocationMessageSchema } from '../shared/schemas/internal-storage'

import {
  type PoCEndorsement,
  PoCError,
  PoCErrorCode,
  type PoCRegistryEntry,
  type PoCRevocation,
  type PoCVerificationLevel,
} from './types'

// ABI matches ProofOfCloudValidator.sol HardwareRecord struct
const VALIDATOR_ABI = [
  {
    name: 'getHardwareRecord',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'hardwareIdHash', type: 'bytes32' }],
    outputs: [
      {
        name: 'record',
        type: 'tuple',
        components: [
          { name: 'hardwareIdHash', type: 'bytes32' },
          { name: 'level', type: 'uint8' },
          { name: 'agentId', type: 'uint256' },
          { name: 'verifiedAt', type: 'uint256' },
          { name: 'expiresAt', type: 'uint256' },
          { name: 'revoked', type: 'bool' },
          { name: 'cloudProvider', type: 'string' },
          { name: 'region', type: 'string' },
        ],
      },
    ],
  },
  {
    name: 'getAgentStatus',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [
      { name: 'verified', type: 'bool' },
      { name: 'level', type: 'uint8' },
      { name: 'hardwareIdHash', type: 'bytes32' },
      { name: 'expiresAt', type: 'uint256' },
    ],
  },
  {
    name: 'needsReverification',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

interface VerifyQuoteResponse {
  verified: boolean
  level: PoCVerificationLevel | null
  hardwareIdHash: Hex
  cloudProvider: string | null
  region: string | null
  evidenceHash: Hex
  timestamp: number
  endorsements: PoCEndorsement[]
  error?: string
}

interface RevocationFeed {
  revocations: PoCRevocation[]
  lastTimestamp: number
}

interface RegistryClientConfig {
  chain?: Chain
  rpcUrl?: string
  validatorAddress?: Address
  offChainEndpoints?: string[]
  apiKey?: string
  timeout?: number
  enableCache?: boolean
  cacheTtl?: number
}

export class PoCRegistryClient {
  private readonly publicClient
  private readonly validatorAddress: Address
  private readonly offChainEndpoints: string[]
  private readonly apiKey: string | null
  private readonly timeout: number
  private readonly enableCache: boolean
  private readonly cacheTtl: number
  private readonly hardwareCache = new Map<
    string,
    { entry: PoCRegistryEntry | null; timestamp: number }
  >()
  private currentEndpointIndex = 0

  constructor(config: RegistryClientConfig = {}) {
    // Load defaults from config package
    const pocConfig = getPoCConfig()
    const network = getCurrentNetwork()

    const chain = config.chain ?? (network === 'mainnet' ? base : baseSepolia)
    const rpcUrl = config.rpcUrl ?? pocConfig.rpcUrl
    const validatorAddress =
      config.validatorAddress ?? (pocConfig.validatorAddress as Address)

    if (!rpcUrl)
      throw new PoCError(
        PoCErrorCode.ORACLE_UNAVAILABLE,
        'PoC RPC URL not configured',
      )
    if (!validatorAddress)
      throw new PoCError(
        PoCErrorCode.ORACLE_UNAVAILABLE,
        'PoC validator address not configured',
      )

    this.publicClient = createPublicClient({ chain, transport: http(rpcUrl) })
    this.validatorAddress = validatorAddress
    this.offChainEndpoints = config.offChainEndpoints ?? []
    this.apiKey = config.apiKey ?? null
    this.timeout = config.timeout ?? 30000
    this.enableCache = config.enableCache ?? true
    this.cacheTtl = config.cacheTtl ?? 5 * 60 * 1000
  }

  async checkHardware(hardwareIdHash: Hex): Promise<PoCRegistryEntry | null> {
    if (this.enableCache) {
      const cached = this.hardwareCache.get(hardwareIdHash)
      if (cached && Date.now() - cached.timestamp < this.cacheTtl) {
        return cached.entry
      }
    }

    const entry = await this.checkHardwareOnChain(hardwareIdHash)

    if (this.enableCache) {
      this.hardwareCache.set(hardwareIdHash, { entry, timestamp: Date.now() })
    }

    return entry
  }

  private async checkHardwareOnChain(
    hardwareIdHash: Hex,
  ): Promise<PoCRegistryEntry | null> {
    const record = await readContract(this.publicClient, {
      address: this.validatorAddress,
      abi: VALIDATOR_ABI,
      functionName: 'getHardwareRecord',
      args: [hardwareIdHash as `0x${string}`],
    })

    if (record.verifiedAt === 0n) {
      return null
    }

    return {
      hardwareIdHash: record.hardwareIdHash,
      level: record.level as PoCVerificationLevel,
      cloudProvider: record.cloudProvider,
      region: record.region,
      evidenceHashes: [],
      endorsements: [],
      verifiedAt: Number(record.verifiedAt) * 1000,
      lastVerifiedAt: Number(record.verifiedAt) * 1000,
      monitoringCadence: 86400000, // 24 hours default
      active: !record.revoked && Number(record.expiresAt) * 1000 > Date.now(),
    }
  }

  async verifyQuote(quote: Hex): Promise<VerifyQuoteResponse> {
    const hardwareIdHash = `0x${quote.slice(2, 66).padEnd(64, '0')}` as Hex
    const entry = await this.checkHardware(hardwareIdHash)

    if (!entry) {
      return {
        verified: false,
        level: null,
        hardwareIdHash,
        cloudProvider: null,
        region: null,
        evidenceHash: '0x' as Hex,
        timestamp: Date.now(),
        endorsements: [],
        error: 'Hardware not registered',
      }
    }

    if (!entry.active) {
      return {
        verified: false,
        level: null,
        hardwareIdHash,
        cloudProvider: entry.cloudProvider,
        region: entry.region,
        evidenceHash: '0x' as Hex,
        timestamp: Date.now(),
        endorsements: [],
        error: 'Hardware revoked or expired',
      }
    }

    return {
      verified: true,
      level: entry.level,
      hardwareIdHash,
      cloudProvider: entry.cloudProvider,
      region: entry.region,
      evidenceHash: (entry.evidenceHashes[0] ?? '0x') as Hex,
      timestamp: Date.now(),
      endorsements: entry.endorsements,
    }
  }

  async getAgentStatus(agentId: bigint): Promise<{
    verified: boolean
    level: PoCVerificationLevel
    hardwareIdHash: Hex
    expiresAt: number
  }> {
    const [verified, level, hardwareIdHash, expiresAt] = await readContract(
      this.publicClient,
      {
        address: this.validatorAddress,
        abi: VALIDATOR_ABI,
        functionName: 'getAgentStatus',
        args: [agentId],
      },
    )

    return {
      verified,
      level: level as PoCVerificationLevel,
      hardwareIdHash,
      expiresAt: Number(expiresAt) * 1000,
    }
  }

  async needsReverification(agentId: bigint): Promise<boolean> {
    return readContract(this.publicClient, {
      address: this.validatorAddress,
      abi: VALIDATOR_ABI,
      functionName: 'needsReverification',
      args: [agentId],
    })
  }

  async getRevocations(sinceTimestamp?: number): Promise<PoCRevocation[]> {
    if (this.offChainEndpoints.length === 0) {
      throw new PoCError(
        PoCErrorCode.ORACLE_UNAVAILABLE,
        'No off-chain endpoints configured for revocation feed',
      )
    }

    const errors: string[] = []
    for (let i = 0; i < this.offChainEndpoints.length; i++) {
      const endpointIndex =
        (this.currentEndpointIndex + i) % this.offChainEndpoints.length
      const endpoint = this.offChainEndpoints[endpointIndex]
      const url = sinceTimestamp
        ? `${endpoint}/revocations?since=${sinceTimestamp}`
        : `${endpoint}/revocations`

      const result = await this.request<RevocationFeed>(url, { method: 'GET' })
      if (!result.ok) {
        errors.push(
          `${endpoint}: ${(result as { ok: false; error: string }).error}`,
        )
        continue
      }
      this.currentEndpointIndex = endpointIndex
      return result.data.revocations
    }

    throw new PoCError(
      PoCErrorCode.ORACLE_UNAVAILABLE,
      `All endpoints failed: ${errors.join(', ')}`,
    )
  }

  subscribeToRevocations(
    onRevocation: (revocation: PoCRevocation) => void,
  ): () => void {
    if (this.offChainEndpoints.length === 0) {
      throw new PoCError(
        PoCErrorCode.ORACLE_UNAVAILABLE,
        'No off-chain endpoints configured',
      )
    }

    let currentEndpointIndex = 0
    let ws: WebSocket | null = null
    let reconnectAttempts = 0
    let isClosing = false

    const connect = () => {
      const endpoint = this.offChainEndpoints[currentEndpointIndex]
      const wsEndpoint = `${endpoint.replace(/^http/, 'ws')}/ws/revocations`

      ws = new WebSocket(wsEndpoint)
      ws.onopen = () => {
        reconnectAttempts = 0
      }
      ws.onmessage = (e) => {
        const parsed = RevocationMessageSchema.safeParse(
          JSON.parse(String(e.data)),
        )
        if (parsed.success) {
          onRevocation(parsed.data)
        }
      }
      ws.onerror = () => {
        currentEndpointIndex =
          (currentEndpointIndex + 1) % this.offChainEndpoints.length
      }
      ws.onclose = () => {
        if (isClosing) return
        if (reconnectAttempts++ < this.offChainEndpoints.length * 3) {
          const delay = Math.min(
            1000 *
              2 **
                Math.floor(reconnectAttempts / this.offChainEndpoints.length),
            30000,
          )
          setTimeout(connect, delay)
        } else {
          throw new PoCError(
            PoCErrorCode.ORACLE_UNAVAILABLE,
            'All WebSocket endpoints exhausted',
          )
        }
      }
    }

    connect()
    return () => {
      isClosing = true
      ws?.close()
    }
  }

  async isHardwareValid(hardwareIdHash: Hex): Promise<boolean> {
    const entry = await this.checkHardware(hardwareIdHash)
    return entry?.active === true
  }

  async isRevoked(hardwareIdHash: Hex): Promise<boolean> {
    const entry = await this.checkHardware(hardwareIdHash)
    return entry !== null && !entry.active
  }

  async getEndorsements(hardwareIdHash: Hex): Promise<PoCEndorsement[]> {
    const entry = await this.checkHardware(hardwareIdHash)
    return entry?.endorsements ?? []
  }

  clearCache(): void {
    this.hardwareCache.clear()
  }

  getDataSourceInfo(): {
    validatorAddress: Address
    offChainEndpoints: string[]
  } {
    return {
      validatorAddress: this.validatorAddress,
      offChainEndpoints: this.offChainEndpoints,
    }
  }

  private async request<T>(
    url: string,
    init: RequestInit,
  ): Promise<{ ok: true; data: T } | { ok: false; error: string }> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.apiKey) headers.Authorization = `Bearer ${this.apiKey}`

    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), this.timeout)

    let response: Response
    try {
      response = await fetch(url, {
        ...init,
        headers: { ...headers, ...init.headers },
        signal: controller.signal,
      })
    } catch (e) {
      clearTimeout(timeoutId)
      return {
        ok: false,
        error: e instanceof Error ? e.message : 'fetch failed',
      }
    } finally {
      clearTimeout(timeoutId)
    }

    if (!response.ok) {
      const errorText = await response.text()
      return { ok: false, error: `${response.status} ${errorText}` }
    }

    return { ok: true, data: (await response.json()) as T }
  }
}

// Mock for testing

export class MockPoCRegistryClient {
  private mockEntries = new Map<string, PoCRegistryEntry>()
  private mockRevocations: PoCRevocation[] = []
  private mockAgentStatus = new Map<
    string,
    {
      verified: boolean
      level: PoCVerificationLevel
      hardwareIdHash: Hex
      expiresAt: number
    }
  >()

  addMockEntry(entry: PoCRegistryEntry): void {
    this.mockEntries.set(entry.hardwareIdHash, entry)
  }

  addMockRevocation(revocation: PoCRevocation): void {
    this.mockRevocations.push(revocation)
    const entry = this.mockEntries.get(revocation.hardwareIdHash)
    if (entry) entry.active = false
  }

  addMockAgentStatus(
    agentId: bigint,
    status: {
      verified: boolean
      level: PoCVerificationLevel
      hardwareIdHash: Hex
      expiresAt: number
    },
  ): void {
    this.mockAgentStatus.set(agentId.toString(), status)
  }

  async verifyQuote(quote: Hex): Promise<VerifyQuoteResponse> {
    const hardwareIdHash = `0x${quote.slice(2, 66).padEnd(64, '0')}` as Hex
    const entry = this.mockEntries.get(hardwareIdHash)

    if (!entry) {
      return {
        verified: false,
        level: null,
        hardwareIdHash,
        cloudProvider: null,
        region: null,
        evidenceHash: '0x' as Hex,
        timestamp: Date.now(),
        endorsements: [],
        error: 'Hardware not found',
      }
    }

    if (!entry.active) {
      return {
        verified: false,
        level: null,
        hardwareIdHash,
        cloudProvider: entry.cloudProvider,
        region: entry.region,
        evidenceHash: '0x' as Hex,
        timestamp: Date.now(),
        endorsements: [],
        error: 'Hardware revoked',
      }
    }

    return {
      verified: true,
      level: entry.level,
      hardwareIdHash,
      cloudProvider: entry.cloudProvider,
      region: entry.region,
      evidenceHash: (entry.evidenceHashes[0] ?? '0x') as Hex,
      timestamp: Date.now(),
      endorsements: entry.endorsements,
    }
  }

  async checkHardware(hardwareIdHash: Hex): Promise<PoCRegistryEntry | null> {
    return this.mockEntries.get(hardwareIdHash) ?? null
  }

  async getRevocations(): Promise<PoCRevocation[]> {
    return this.mockRevocations
  }

  async isHardwareValid(hardwareIdHash: Hex): Promise<boolean> {
    const entry = this.mockEntries.get(hardwareIdHash)
    return entry?.active === true
  }

  async isRevoked(hardwareIdHash: Hex): Promise<boolean> {
    return this.mockRevocations.some((r) => r.hardwareIdHash === hardwareIdHash)
  }

  async getAgentStatus(agentId: bigint): Promise<{
    verified: boolean
    level: PoCVerificationLevel
    hardwareIdHash: Hex
    expiresAt: number
  }> {
    const status = this.mockAgentStatus.get(agentId.toString())
    if (!status)
      throw new PoCError(
        PoCErrorCode.AGENT_NOT_FOUND,
        `Agent ${agentId} not found`,
      )
    return status
  }

  async needsReverification(agentId: bigint): Promise<boolean> {
    const status = this.mockAgentStatus.get(agentId.toString())
    if (!status) return true
    return status.expiresAt < Date.now()
  }

  async getEndorsements(hardwareIdHash: Hex): Promise<PoCEndorsement[]> {
    const entry = this.mockEntries.get(hardwareIdHash)
    return entry?.endorsements ?? []
  }

  clearCache(): void {
    /* no-op */
  }

  getDataSourceInfo(): {
    validatorAddress: Address
    offChainEndpoints: string[]
  } {
    return {
      validatorAddress: '0x0000000000000000000000000000000000000000',
      offChainEndpoints: [],
    }
  }
}

/**
 * Create a registry client with config-first defaults
 *
 * Config is loaded from packages/config:
 * - contracts.json -> external.baseSepolia.poc.validator
 * - contracts.json -> external.baseSepolia.rpcUrl (Jeju's Base Sepolia node)
 *
 * Optional env overrides:
 * - POC_REGISTRY_ENDPOINTS: comma-separated off-chain API endpoints
 * - POC_REGISTRY_API_KEY: API key for off-chain endpoints
 */
export function createRegistryClient(): PoCRegistryClient {
  const offChainEndpoints =
    process.env.POC_REGISTRY_ENDPOINTS?.split(',')
      .map((e) => e.trim())
      .filter(Boolean) ?? []

  return new PoCRegistryClient({
    offChainEndpoints,
    apiKey: process.env.POC_REGISTRY_API_KEY,
    timeout: Number(process.env.POC_REGISTRY_TIMEOUT) || 30000,
    enableCache: process.env.POC_REGISTRY_CACHE !== 'false',
    cacheTtl: Number(process.env.POC_REGISTRY_CACHE_TTL) || 5 * 60 * 1000,
  })
}
