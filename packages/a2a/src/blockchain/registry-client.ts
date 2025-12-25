/**
 * ERC-8004 Registry Client
 * Blockchain integration for agent identity and reputation
 */

import type { JsonValue } from '@jejunetwork/types'
import { createPublicClient, http, type PublicClient } from 'viem'
import type { AgentProfile, AgentReputation } from '../types/a2a'
import { AgentCapabilitiesSchema } from '../types/common'

/**
 * Minimal ABI for Identity Registry contract
 */
const IDENTITY_ABI = [
  {
    name: 'getAgentProfile',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      { name: 'name', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'capabilitiesHash', type: 'bytes32' },
      { name: 'registeredAt', type: 'uint256' },
      { name: 'isActive', type: 'bool' },
      { name: 'metadata', type: 'string' },
    ],
  },
  {
    name: 'ownerOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [{ name: '', type: 'address' }],
  },
  {
    name: 'getTokenId',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'getAllActiveAgents',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
  {
    name: 'isEndpointActive',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'endpoint', type: 'string' }],
    outputs: [{ name: '', type: 'bool' }],
  },
] as const

/**
 * Minimal ABI for Reputation Registry contract
 */
const REPUTATION_ABI = [
  {
    name: 'getReputation',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    outputs: [
      { name: 'totalBets', type: 'uint256' },
      { name: 'winningBets', type: 'uint256' },
      { name: 'totalVolume', type: 'uint256' },
      { name: 'profitLoss', type: 'int256' },
      { name: 'accuracyScore', type: 'uint256' },
      { name: 'trustScore', type: 'uint256' },
      { name: 'isBanned', type: 'bool' },
    ],
  },
  {
    name: 'getAgentsByMinScore',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'minScore', type: 'uint256' }],
    outputs: [{ name: '', type: 'uint256[]' }],
  },
] as const

export interface RegistryConfig {
  rpcUrl: string
  identityRegistryAddress: string
  reputationSystemAddress: string
}

export class RegistryClient {
  private readonly client: PublicClient
  private readonly identityRegistryAddress: `0x${string}`
  private readonly reputationSystemAddress: `0x${string}`

  constructor(config: RegistryConfig) {
    this.client = createPublicClient({
      transport: http(config.rpcUrl),
    })
    this.identityRegistryAddress =
      config.identityRegistryAddress as `0x${string}`
    this.reputationSystemAddress =
      config.reputationSystemAddress as `0x${string}`
  }

  /**
   * Get agent profile by token ID
   */
  async getAgentProfile(tokenId: number): Promise<AgentProfile | null> {
    const profile = await this.client.readContract({
      address: this.identityRegistryAddress,
      abi: IDENTITY_ABI,
      functionName: 'getAgentProfile',
      args: [BigInt(tokenId)],
    })
    const reputation = await this.getAgentReputation(tokenId)
    const address = await this.client.readContract({
      address: this.identityRegistryAddress,
      abi: IDENTITY_ABI,
      functionName: 'ownerOf',
      args: [BigInt(tokenId)],
    })

    return {
      tokenId,
      address,
      name: profile[0],
      endpoint: profile[1],
      capabilities: this.parseCapabilities(profile[5]),
      reputation,
      isActive: profile[4],
    }
  }

  /**
   * Get agent profile by address
   */
  async getAgentProfileByAddress(
    address: string,
  ): Promise<AgentProfile | null> {
    const tokenId = await this.client.readContract({
      address: this.identityRegistryAddress,
      abi: IDENTITY_ABI,
      functionName: 'getTokenId',
      args: [address as `0x${string}`],
    })
    if (tokenId === 0n) return null
    return this.getAgentProfile(Number(tokenId))
  }

  /**
   * Get agent reputation
   */
  async getAgentReputation(tokenId: number): Promise<AgentReputation> {
    const rep = await this.client.readContract({
      address: this.reputationSystemAddress,
      abi: REPUTATION_ABI,
      functionName: 'getReputation',
      args: [BigInt(tokenId)],
    })

    // Contract ABI guarantees these fields - trust the types
    return {
      totalBets: Number(rep[0]),
      winningBets: Number(rep[1]),
      totalVolume: rep[2].toString(),
      profitLoss: Number(rep[3]),
      accuracyScore: Number(rep[4]),
      trustScore: Number(rep[5]),
      isBanned: rep[6],
    }
  }

  /**
   * Discover agents by filters
   */
  async discoverAgents(filters?: {
    strategies?: string[]
    minReputation?: number
    markets?: string[]
  }): Promise<AgentProfile[]> {
    let tokenIds: readonly bigint[]

    if (filters?.minReputation) {
      tokenIds = await this.client.readContract({
        address: this.reputationSystemAddress,
        abi: REPUTATION_ABI,
        functionName: 'getAgentsByMinScore',
        args: [BigInt(filters.minReputation)],
      })
    } else {
      tokenIds = await this.client.readContract({
        address: this.identityRegistryAddress,
        abi: IDENTITY_ABI,
        functionName: 'getAllActiveAgents',
        args: [],
      })
    }

    const profiles: AgentProfile[] = []
    for (const tokenId of tokenIds) {
      const profile = await this.getAgentProfile(Number(tokenId))
      if (profile && this.matchesFilters(profile, filters)) {
        profiles.push(profile)
      }
    }

    return profiles
  }

  /**
   * Check if agent matches discovery filters
   */
  private matchesFilters(
    profile: AgentProfile,
    filters?: {
      strategies?: string[]
      minReputation?: number
      markets?: string[]
    },
  ): boolean {
    if (!filters) return true

    // Check strategies
    if (filters.strategies && filters.strategies.length > 0) {
      const hasStrategy = filters.strategies.some((s) =>
        profile.capabilities.strategies.includes(s),
      )
      if (!hasStrategy) return false
    }

    // Check markets
    if (filters.markets && filters.markets.length > 0) {
      const hasMarket = filters.markets.some((m) =>
        profile.capabilities.markets.includes(m),
      )
      if (!hasMarket) return false
    }

    if (filters.minReputation) {
      if (profile.reputation.trustScore < filters.minReputation) {
        return false
      }
    }

    return true
  }

  /**
   * Parse capabilities from metadata JSON
   */
  private parseCapabilities(metadata: string): {
    strategies: string[]
    markets: string[]
    actions: string[]
    version: string
    skills: string[]
    domains: string[]
  } {
    const emptyCapabilities = {
      strategies: [] as string[],
      markets: [] as string[],
      actions: [] as string[],
      version: '1.0.0',
      skills: [] as string[],
      domains: [] as string[],
    }

    let rawData: unknown
    try {
      rawData = JSON.parse(metadata)
    } catch {
      // Invalid JSON - return empty capabilities
      return emptyCapabilities
    }

    const validation = AgentCapabilitiesSchema.safeParse(rawData)
    if (!validation.success) {
      // Schema validation failed - return empty capabilities
      return emptyCapabilities
    }

    // Zod schema applies defaults, so these fields are guaranteed to exist
    return {
      strategies: validation.data.strategies,
      markets: validation.data.markets,
      actions: validation.data.actions,
      version: validation.data.version,
      skills: validation.data.skills,
      domains: validation.data.domains,
    }
  }

  /**
   * Verify agent address owns the token ID
   */
  async verifyAgent(address: string, tokenId: number): Promise<boolean> {
    const owner = await this.client.readContract({
      address: this.identityRegistryAddress,
      abi: IDENTITY_ABI,
      functionName: 'ownerOf',
      args: [BigInt(tokenId)],
    })
    return owner.toLowerCase() === address.toLowerCase()
  }

  /**
   * Check if endpoint is active
   */
  async isEndpointActive(endpoint: string): Promise<boolean> {
    return await this.client.readContract({
      address: this.identityRegistryAddress,
      abi: IDENTITY_ABI,
      functionName: 'isEndpointActive',
      args: [endpoint],
    })
  }

  /**
   * Register agent (read-only - throws error)
   */
  async register(
    _agentId: string,
    _data: Record<string, JsonValue>,
  ): Promise<void> {
    throw new Error(
      'RegistryClient is read-only. Use a write-enabled client for registration',
    )
  }

  /**
   * Unregister agent (read-only - throws error)
   */
  async unregister(_agentId: string): Promise<void> {
    throw new Error(
      'RegistryClient is read-only. Use a write-enabled client for unregistration',
    )
  }

  /**
   * Transform AgentProfile to registry entry format
   */
  private toRegistryEntry(profile: AgentProfile): {
    agentId: string
    [key: string]: JsonValue
  } {
    return {
      agentId: String(profile.tokenId),
      tokenId: profile.tokenId,
      address: profile.address,
      name: profile.name,
      endpoint: profile.endpoint,
      capabilities: {
        strategies: profile.capabilities.strategies,
        markets: profile.capabilities.markets,
        actions: profile.capabilities.actions,
        version: profile.capabilities.version,
        // Zod schema guarantees these fields exist with defaults
        skills: profile.capabilities.skills,
        domains: profile.capabilities.domains,
      },
      reputation: {
        totalBets: profile.reputation.totalBets,
        winningBets: profile.reputation.winningBets,
        accuracyScore: profile.reputation.accuracyScore,
        trustScore: profile.reputation.trustScore,
        totalVolume: profile.reputation.totalVolume,
        profitLoss: profile.reputation.profitLoss,
        isBanned: profile.reputation.isBanned,
      },
      isActive: profile.isActive,
    }
  }

  /**
   * Get all agents
   */
  async getAgents(): Promise<
    Array<{ agentId: string; [key: string]: JsonValue }>
  > {
    const profiles = await this.discoverAgents()
    return profiles.map((profile) => this.toRegistryEntry(profile))
  }

  /**
   * Get agent by ID
   */
  async getAgent(
    agentId: string,
  ): Promise<{ agentId: string; [key: string]: JsonValue } | null> {
    const tokenId = Number.parseInt(agentId, 10)
    if (Number.isNaN(tokenId)) {
      return null
    }
    const profile = await this.getAgentProfile(tokenId)
    if (!profile) {
      return null
    }
    return this.toRegistryEntry(profile)
  }
}
