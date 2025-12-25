/**
 * MPC Party Discovery
 *
 * Discovers MPC parties from on-chain registry and provides
 * threshold signing client for application services.
 *
 * This is used by OAuth3, Farcaster, Messaging, and other services
 * that need to request signatures from the MPC infrastructure.
 */

import type { Address, Hex } from 'viem'
import { createPublicClient, http } from 'viem'
import { base, baseSepolia } from 'viem/chains'
import { z } from 'zod'
import { FROSTCoordinator } from './frost-coordinator'

// Party response schemas
const CommitmentResponseSchema = z.object({
  commitment: z.string().transform((s) => s as Hex),
  nonce: z.string().transform((s) => s as Hex),
})

const PartialSignatureResponseSchema = z.object({
  partialSignature: z.string().transform((s) => s as Hex),
  partyIndex: z.number(),
})

// ============ Types ============

export interface MPCPartyNode {
  agentId: bigint
  partyIndex: number
  endpoint: string
  teePlatform: string
  stakedAmount: bigint
  status: 'active' | 'inactive' | 'slashed'
  attestationExpiry: number
  latency?: number
}

export interface MPCCluster {
  clusterId: Hex
  name: string
  threshold: number
  totalParties: number
  partyAgentIds: bigint[]
  groupPublicKey: Hex
  groupAddress: Address
  status: 'pending' | 'active' | 'rotating' | 'dissolved'
}

export interface SignatureResult {
  signature: Hex
  r: Hex
  s: Hex
  v: number
  keyId: string
  signingParties: number[]
}

export interface MPCDiscoveryConfig {
  rpcUrl: string
  mpcRegistryAddress: Address
  identityRegistryAddress: Address
  cacheExpiry?: number
  chainId?: number
}

// ============ ABI ============

const MPC_PARTY_REGISTRY_ABI = [
  {
    name: 'getActiveParties',
    type: 'function',
    inputs: [],
    outputs: [{ name: 'agentIds', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    name: 'parties',
    type: 'function',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'partyAddress', type: 'address' },
      { name: 'endpoint', type: 'string' },
      { name: 'attestationHash', type: 'bytes32' },
      { name: 'attestationExpiry', type: 'uint256' },
      { name: 'teePlatform', type: 'string' },
      { name: 'stakedAmount', type: 'uint256' },
      { name: 'status', type: 'uint8' },
      { name: 'registeredAt', type: 'uint256' },
      { name: 'lastHeartbeat', type: 'uint256' },
      { name: 'signaturesProvided', type: 'uint256' },
      { name: 'slashCount', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'clusters',
    type: 'function',
    inputs: [{ name: 'clusterId', type: 'bytes32' }],
    outputs: [
      { name: 'clusterId', type: 'bytes32' },
      { name: 'name', type: 'string' },
      { name: 'threshold', type: 'uint256' },
      { name: 'totalParties', type: 'uint256' },
      { name: 'partyAgentIds', type: 'uint256[]' },
      { name: 'groupPublicKey', type: 'bytes' },
      { name: 'derivedAddress', type: 'address' },
      { name: 'owner', type: 'address' },
      { name: 'createdAt', type: 'uint256' },
      { name: 'status', type: 'uint8' },
      { name: 'signaturesCompleted', type: 'uint256' },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getActiveClusters',
    type: 'function',
    inputs: [],
    outputs: [{ name: 'clusterIds', type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    name: 'getClusterParties',
    type: 'function',
    inputs: [{ name: 'clusterId', type: 'bytes32' }],
    outputs: [{ name: 'agentIds', type: 'uint256[]' }],
    stateMutability: 'view',
  },
  {
    name: 'getPartyEndpoint',
    type: 'function',
    inputs: [{ name: 'agentId', type: 'uint256' }],
    outputs: [{ name: 'endpoint', type: 'string' }],
    stateMutability: 'view',
  },
] as const

// Type for party result tuple
type PartyResult = readonly [
  bigint, // agentId
  Address, // partyAddress
  string, // endpoint
  Hex, // attestationHash
  bigint, // attestationExpiry
  string, // teePlatform
  bigint, // stakedAmount
  number, // status
  bigint, // registeredAt
  bigint, // lastHeartbeat
  bigint, // signaturesProvided
  bigint, // slashCount
]

// Type for cluster result tuple
type ClusterResult = readonly [
  Hex, // clusterId
  string, // name
  bigint, // threshold
  bigint, // totalParties
  readonly bigint[], // partyAgentIds
  Hex, // groupPublicKey
  Address, // derivedAddress
  Address, // owner
  bigint, // createdAt
  number, // status
  bigint, // signaturesCompleted
]

// ============ Discovery Client ============

export class MPCPartyDiscovery {
  private readonly registryAddress: Address
  private readonly identityRegistryAddress: Address
  private readonly cacheExpiry: number
  private readonly rpcUrl: string
  private readonly chainId: number

  // Cache
  private partyCache = new Map<string, MPCPartyNode>()
  private clusterCache = new Map<string, MPCCluster>()
  private lastCacheRefresh = 0

  constructor(config: MPCDiscoveryConfig) {
    this.registryAddress = config.mpcRegistryAddress
    this.identityRegistryAddress = config.identityRegistryAddress
    this.cacheExpiry = config.cacheExpiry ?? 60000 // 1 minute
    this.rpcUrl = config.rpcUrl
    this.chainId = config.chainId ?? 84532 // Base Sepolia default
  }

  private getClient() {
    const chain = this.chainId === 8453 ? base : baseSepolia
    return createPublicClient({
      chain,
      transport: http(this.rpcUrl),
    })
  }

  /**
   * Get all active MPC parties
   */
  async getActiveParties(): Promise<MPCPartyNode[]> {
    const now = Date.now()

    // Check cache
    if (
      now - this.lastCacheRefresh < this.cacheExpiry &&
      this.partyCache.size > 0
    ) {
      return Array.from(this.partyCache.values()).filter(
        (p) => p.status === 'active',
      )
    }

    const client = this.getClient()

    // Query on-chain
    const agentIds = await client.readContract({
      address: this.registryAddress,
      abi: MPC_PARTY_REGISTRY_ABI,
      functionName: 'getActiveParties',
    })

    const parties: MPCPartyNode[] = []

    for (let i = 0; i < agentIds.length; i++) {
      const party = await this.getParty(agentIds[i])
      if (party) {
        party.partyIndex = i + 1 // 1-indexed for FROST
        parties.push(party)
        this.partyCache.set(agentIds[i].toString(), party)
      }
    }

    this.lastCacheRefresh = now
    return parties
  }

  /**
   * Get a specific party
   */
  async getParty(agentId: bigint): Promise<MPCPartyNode | null> {
    const cacheKey = agentId.toString()
    const cached = this.partyCache.get(cacheKey)
    if (cached && Date.now() - this.lastCacheRefresh < this.cacheExpiry) {
      return cached
    }

    const client = this.getClient()

    const result = (await client.readContract({
      address: this.registryAddress,
      abi: MPC_PARTY_REGISTRY_ABI,
      functionName: 'parties',
      args: [agentId],
    })) as PartyResult

    // Destructure tuple result from contract
    const [
      partyAgentId,
      _partyAddress,
      endpoint,
      _attestationHash,
      attestationExpiry,
      teePlatform,
      stakedAmount,
      status,
    ] = result

    if (!endpoint) return null

    const statusMap: Record<number, 'inactive' | 'active' | 'slashed'> = {
      0: 'inactive',
      1: 'active',
      2: 'slashed',
    }

    const party: MPCPartyNode = {
      agentId: partyAgentId,
      partyIndex: 0, // Set by caller based on cluster
      endpoint,
      teePlatform,
      stakedAmount,
      status: statusMap[status] ?? 'inactive',
      attestationExpiry: Number(attestationExpiry),
    }

    this.partyCache.set(cacheKey, party)
    return party
  }

  /**
   * Get active clusters
   */
  async getActiveClusters(): Promise<MPCCluster[]> {
    const client = this.getClient()

    const clusterIds = await client.readContract({
      address: this.registryAddress,
      abi: MPC_PARTY_REGISTRY_ABI,
      functionName: 'getActiveClusters',
    })

    const clusters: MPCCluster[] = []
    for (let i = 0; i < clusterIds.length; i++) {
      const cluster = await this.getCluster(clusterIds[i])
      if (cluster && cluster.status === 'active') {
        clusters.push(cluster)
      }
    }

    return clusters
  }

  /**
   * Get a specific cluster
   */
  async getCluster(clusterId: Hex): Promise<MPCCluster | null> {
    const cached = this.clusterCache.get(clusterId)
    if (cached && Date.now() - this.lastCacheRefresh < this.cacheExpiry) {
      return cached
    }

    const client = this.getClient()

    const result = (await client.readContract({
      address: this.registryAddress,
      abi: MPC_PARTY_REGISTRY_ABI,
      functionName: 'clusters',
      args: [clusterId],
    })) as ClusterResult

    // Destructure tuple result from contract
    const [
      clusterIdResult,
      name,
      threshold,
      totalParties,
      partyAgentIds,
      groupPublicKey,
      derivedAddress,
      _owner,
      _createdAt,
      status,
    ] = result

    if (
      clusterIdResult ===
      '0x0000000000000000000000000000000000000000000000000000000000000000'
    ) {
      return null
    }

    const statusMap: Record<
      number,
      'pending' | 'active' | 'rotating' | 'dissolved'
    > = {
      0: 'pending',
      1: 'active',
      2: 'rotating',
      3: 'dissolved',
    }

    const cluster: MPCCluster = {
      clusterId: clusterIdResult,
      name,
      threshold: Number(threshold),
      totalParties: Number(totalParties),
      partyAgentIds: [...partyAgentIds],
      groupPublicKey,
      groupAddress: derivedAddress,
      status: statusMap[status] ?? 'pending',
    }

    this.clusterCache.set(clusterId, cluster)
    return cluster
  }

  /**
   * Ping a party to check latency
   */
  async pingParty(party: MPCPartyNode): Promise<number> {
    const start = Date.now()
    const response = await fetch(`${party.endpoint}/mpc/health`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null)

    if (!response?.ok) return Infinity
    return Date.now() - start
  }

  /**
   * Get best parties for signing (lowest latency, valid attestation)
   */
  async getBestParties(count: number): Promise<MPCPartyNode[]> {
    const parties = await this.getActiveParties()
    const now = Date.now()

    // Filter by valid attestation
    const validParties = parties.filter(
      (p) => p.attestationExpiry * 1000 > now && p.status === 'active',
    )

    // Ping all parties for latency
    const withLatency = await Promise.all(
      validParties.map(async (party) => ({
        ...party,
        latency: await this.pingParty(party),
      })),
    )

    // Sort by latency and return top N
    return withLatency
      .filter((p) => p.latency < Infinity)
      .sort((a, b) => (a.latency ?? Infinity) - (b.latency ?? Infinity))
      .slice(0, count)
  }
}

// ============ MPC Signing Client ============

export class MPCSigningClient {
  private discovery: MPCPartyDiscovery
  private serviceAgentId: string

  constructor(discovery: MPCPartyDiscovery, serviceAgentId: string) {
    this.discovery = discovery
    this.serviceAgentId = serviceAgentId
  }

  /**
   * Request a threshold signature from MPC parties
   */
  async requestSignature(params: {
    keyId: string
    messageHash: Hex
    requiredParties?: number
  }): Promise<SignatureResult> {
    // Get best available parties
    const clusters = await this.discovery.getActiveClusters()
    const cluster = clusters[0] // Use first active cluster for now

    if (!cluster) {
      throw new Error('No active MPC cluster found')
    }

    const threshold = params.requiredParties ?? cluster.threshold
    const parties = await this.discovery.getBestParties(threshold)

    if (parties.length < threshold) {
      throw new Error(
        `Not enough parties available: ${parties.length} < ${threshold}`,
      )
    }

    const sessionId = crypto.randomUUID()

    // Round 1: Collect commitments
    const commitmentResults = await Promise.all(
      parties.map(async (party) => {
        const response = await fetch(`${party.endpoint}/mpc/sign/commit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            keyId: params.keyId,
            messageHash: params.messageHash,
            serviceAgentId: this.serviceAgentId,
          }),
        })

        if (!response.ok) {
          throw new Error(
            `Party ${party.agentId} commitment failed: ${response.status}`,
          )
        }

        const data = CommitmentResponseSchema.parse(await response.json())
        return {
          partyIndex: party.partyIndex,
          commitment: data.commitment,
          nonce: data.nonce,
        }
      }),
    )

    // Round 2: Collect signature shares
    const shareResults = await Promise.all(
      parties.map(async (party) => {
        const response = await fetch(`${party.endpoint}/mpc/sign/share`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            sessionId,
            keyId: params.keyId,
            messageHash: params.messageHash,
            allCommitments: commitmentResults.map((c) => ({
              partyIndex: c.partyIndex,
              commitment: c.commitment,
            })),
            serviceAgentId: this.serviceAgentId,
          }),
        })

        if (!response.ok) {
          throw new Error(
            `Party ${party.agentId} share failed: ${response.status}`,
          )
        }

        const data = PartialSignatureResponseSchema.parse(await response.json())
        return {
          partyIndex: data.partyIndex,
          share: data.partialSignature,
        }
      }),
    )

    // Aggregate signatures
    const aggregated = FROSTCoordinator.aggregateSignatures(
      params.messageHash,
      cluster.groupPublicKey,
      commitmentResults.map((c) => ({
        partyIndex: c.partyIndex,
        D: c.nonce.slice(0, 66) as Hex,
        E: `0x${c.nonce.slice(66)}` as Hex,
      })),
      shareResults,
    )

    // Combine into standard Ethereum signature format
    const signature =
      `${aggregated.r}${aggregated.s.slice(2)}${aggregated.v.toString(16).padStart(2, '0')}` as Hex

    return {
      signature,
      r: aggregated.r,
      s: aggregated.s,
      v: aggregated.v,
      keyId: params.keyId,
      signingParties: shareResults.map((s) => s.partyIndex),
    }
  }

  /**
   * Request distributed key generation
   */
  async requestKeyGen(params: {
    keyId: string
    clusterId?: Hex
  }): Promise<{ groupPublicKey: Hex; groupAddress: Address }> {
    // Get cluster or use default
    let cluster: MPCCluster | null = null
    if (params.clusterId) {
      cluster = await this.discovery.getCluster(params.clusterId)
    } else {
      const clusters = await this.discovery.getActiveClusters()
      cluster = clusters[0] ?? null
    }

    if (!cluster) {
      throw new Error('No MPC cluster available')
    }

    // Get party endpoints
    const partyPromises = cluster.partyAgentIds.map((agentId) =>
      this.discovery.getParty(agentId),
    )
    const parties = (await Promise.all(partyPromises)).filter(
      (p): p is MPCPartyNode => p !== null,
    )

    // Round 1: Collect DKG contributions
    const contributions = await Promise.all(
      parties.map(async (party) => {
        const response = await fetch(
          `${party.endpoint}/mpc/keygen/contribute`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              keyId: params.keyId,
              clusterId: cluster.clusterId,
              threshold: cluster.threshold,
              totalParties: cluster.totalParties,
              partyIndices: parties.map((_, i) => i + 1),
              serviceAgentId: this.serviceAgentId,
            }),
          },
        )

        if (!response.ok) {
          throw new Error(`Party ${party.agentId} keygen contribution failed`)
        }

        return response.json() as Promise<{ publicShare: Hex; commitment: Hex }>
      }),
    )

    // Round 2: Finalize DKG
    const allPublicShares = contributions.map((c) => c.publicShare)
    const allCommitments = contributions.map((c) => c.commitment)

    const finalizeResults = await Promise.all(
      parties.map(async (party) => {
        const response = await fetch(`${party.endpoint}/mpc/keygen/finalize`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            keyId: params.keyId,
            clusterId: cluster.clusterId,
            allPublicShares,
            allCommitments,
            serviceAgentId: this.serviceAgentId,
          }),
        })

        if (!response.ok) {
          throw new Error(`Party ${party.agentId} keygen finalize failed`)
        }

        return response.json() as Promise<{
          groupPublicKey: Hex
          groupAddress: Address
        }>
      }),
    )

    // All parties should agree on the group public key
    const result = finalizeResults[0]
    return {
      groupPublicKey: result.groupPublicKey,
      groupAddress: result.groupAddress,
    }
  }
}

// ============ Factory ============

export function createMPCClient(
  config: MPCDiscoveryConfig,
  serviceAgentId: string,
): MPCSigningClient {
  const discovery = new MPCPartyDiscovery(config)
  return new MPCSigningClient(discovery, serviceAgentId)
}
