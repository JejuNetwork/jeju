/**
 * On-Chain Verification Module
 *
 * Provides verification of access conditions against on-chain state.
 * Used by EncryptionProvider and SecretVault for policy enforcement.
 */

import type { Address, Hex } from 'viem'
import { createPublicClient, erc20Abi, http, keccak256, parseAbi, toBytes } from 'viem'
import { base, baseSepolia, mainnet } from 'viem/chains'
import type {
  AgentCondition,
  BalanceCondition,
  ContractCondition,
  RoleCondition,
  StakeCondition,
} from './types.js'

// Chain registry
const CHAINS = {
  mainnet,
  ethereum: mainnet,
  base,
  'base-sepolia': baseSepolia,
  'base-mainnet': base,
} as const

type ChainName = keyof typeof CHAINS

/**
 * Configuration for on-chain verification
 */
export interface OnChainVerifierConfig {
  /** RPC URLs by chain name */
  rpcUrls?: Partial<Record<ChainName, string>>
  /** Default RPC URL if chain-specific not provided */
  defaultRpcUrl?: string
  /** Cache TTL in milliseconds (default: 30000) */
  cacheTtlMs?: number
}

/**
 * Result of a verification check
 */
export interface VerificationResult {
  success: boolean
  error?: string
  cachedAt?: number
  value?: string | bigint | boolean
}

// Simple verification result cache
interface CacheEntry {
  result: VerificationResult
  expiresAt: number
}

/**
 * On-chain verification service
 */
export class OnChainVerifier {
  private config: Required<OnChainVerifierConfig>
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private clients = new Map<string, any>()
  private cache = new Map<string, CacheEntry>()

  constructor(config: OnChainVerifierConfig = {}) {
    this.config = {
      rpcUrls: config.rpcUrls ?? {},
      defaultRpcUrl: config.defaultRpcUrl ?? 'https://mainnet.base.org',
      cacheTtlMs: config.cacheTtlMs ?? 30000,
    }
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private getClient(chain: string): any {
    const cached = this.clients.get(chain)
    if (cached) return cached

    const chainConfig = CHAINS[chain as ChainName]
    if (!chainConfig) {
      throw new Error(`Unsupported chain: ${chain}`)
    }

    const rpcUrl =
      this.config.rpcUrls[chain as ChainName] ?? this.config.defaultRpcUrl

    const client = createPublicClient({
      chain: chainConfig,
      transport: http(rpcUrl),
    })

    this.clients.set(chain, client)
    return client
  }

  private getCacheKey(
    type: string,
    ...args: (string | number | bigint)[]
  ): string {
    return `${type}:${args.join(':')}`
  }

  private getCached(key: string): VerificationResult | undefined {
    const entry = this.cache.get(key)
    if (!entry) return undefined
    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key)
      return undefined
    }
    return entry.result
  }

  private setCache(key: string, result: VerificationResult): void {
    this.cache.set(key, {
      result: { ...result, cachedAt: Date.now() },
      expiresAt: Date.now() + this.config.cacheTtlMs,
    })
  }

  /**
   * Verify a balance condition for an address
   */
  async verifyBalance(
    condition: BalanceCondition,
    userAddress: Address,
  ): Promise<VerificationResult> {
    const cacheKey = this.getCacheKey(
      'balance',
      condition.chain,
      userAddress,
      condition.tokenAddress ?? 'native',
      condition.value,
    )

    const cached = this.getCached(cacheKey)
    if (cached) return cached

    const client = this.getClient(condition.chain)
    let balance: bigint

    if (condition.tokenAddress) {
      // ERC20 balance
      balance = await client.readContract({
        address: condition.tokenAddress,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [userAddress],
      })
    } else {
      // Native balance
      balance = await client.getBalance({ address: userAddress })
    }

    const required = BigInt(condition.value)
    const success = this.compareValues(balance, condition.comparator, required)

    const result: VerificationResult = {
      success,
      value: balance,
    }
    this.setCache(cacheKey, result)
    return result
  }

  /**
   * Verify a stake condition
   */
  async verifyStake(
    condition: StakeCondition,
    userAddress: Address,
  ): Promise<VerificationResult> {
    const cacheKey = this.getCacheKey(
      'stake',
      condition.chain,
      condition.registryAddress,
      userAddress,
      condition.minStakeUSD.toString(),
    )

    const cached = this.getCached(cacheKey)
    if (cached) return cached

    const client = this.getClient(condition.chain)

    // Standard staking registry interface
    const stakingAbi = parseAbi([
      'function getStake(address staker) view returns (uint256)',
      'function getStakeUSD(address staker) view returns (uint256)',
    ])

    let stakeUSD: bigint
    try {
      // Try getStakeUSD first (preferred)
      stakeUSD = await client.readContract({
        address: condition.registryAddress,
        abi: stakingAbi,
        functionName: 'getStakeUSD',
        args: [userAddress],
      })
    } catch {
      // Fall back to getStake (raw token amount)
      const stake = await client.readContract({
        address: condition.registryAddress,
        abi: stakingAbi,
        functionName: 'getStake',
        args: [userAddress],
      })
      // Convert to USD assuming 18 decimals and $1 per token (simplified)
      // In production, use an oracle for price conversion
      stakeUSD = stake
    }

    // minStakeUSD is in dollars, stakeUSD is in wei (1e18 = $1)
    const requiredWei = BigInt(Math.floor(condition.minStakeUSD * 1e18))
    const success = stakeUSD >= requiredWei

    const result: VerificationResult = {
      success,
      value: stakeUSD,
    }
    this.setCache(cacheKey, result)
    return result
  }

  /**
   * Verify a role condition
   */
  async verifyRole(
    condition: RoleCondition,
    userAddress: Address,
  ): Promise<VerificationResult> {
    const cacheKey = this.getCacheKey(
      'role',
      condition.chain,
      condition.registryAddress,
      userAddress,
      condition.role,
    )

    const cached = this.getCached(cacheKey)
    if (cached) return cached

    const client = this.getClient(condition.chain)

    // Standard role registry interfaces (AccessControl compatible)
    const roleAbi = parseAbi([
      'function hasRole(bytes32 role, address account) view returns (bool)',
      'function getRoleAdmin(bytes32 role) view returns (bytes32)',
    ])

    // Convert role name to bytes32 hash
    const roleHash = this.roleNameToHash(condition.role)

    const hasRole = await client.readContract({
      address: condition.registryAddress,
      abi: roleAbi,
      functionName: 'hasRole',
      args: [roleHash, userAddress],
    })

    const result: VerificationResult = {
      success: hasRole,
      value: hasRole,
    }
    this.setCache(cacheKey, result)
    return result
  }

  /**
   * Verify an agent ownership condition
   */
  async verifyAgentOwner(
    condition: AgentCondition,
    userAddress: Address,
  ): Promise<VerificationResult> {
    const cacheKey = this.getCacheKey(
      'agent',
      condition.chain,
      condition.registryAddress,
      userAddress,
      condition.agentId.toString(),
    )

    const cached = this.getCached(cacheKey)
    if (cached) return cached

    const client = this.getClient(condition.chain)

    // Agent registry interface
    const agentAbi = parseAbi([
      'function ownerOf(uint256 agentId) view returns (address)',
      'function getAgentOwner(uint256 agentId) view returns (address)',
    ])

    let owner: Address
    try {
      // Try ownerOf first (ERC721 compatible)
      owner = await client.readContract({
        address: condition.registryAddress,
        abi: agentAbi,
        functionName: 'ownerOf',
        args: [BigInt(condition.agentId)],
      })
    } catch {
      // Fall back to getAgentOwner
      owner = await client.readContract({
        address: condition.registryAddress,
        abi: agentAbi,
        functionName: 'getAgentOwner',
        args: [BigInt(condition.agentId)],
      })
    }

    const success = owner.toLowerCase() === userAddress.toLowerCase()

    const result: VerificationResult = {
      success,
      value: owner,
    }
    this.setCache(cacheKey, result)
    return result
  }

  /**
   * Verify a custom contract condition
   */
  async verifyContract(
    condition: ContractCondition,
    userAddress: Address,
  ): Promise<VerificationResult> {
    const cacheKey = this.getCacheKey(
      'contract',
      condition.chain,
      condition.contractAddress,
      condition.method,
      JSON.stringify(condition.parameters),
      userAddress,
    )

    const cached = this.getCached(cacheKey)
    if (cached) return cached

    const client = this.getClient(condition.chain)

    // Build ABI for the method
    const paramTypes = condition.parameters
      .map((p) => {
        if (typeof p === 'string' && p.startsWith(':')) return 'address'
        if (typeof p === 'number') return 'uint256'
        if (typeof p === 'boolean') return 'bool'
        return 'string'
      })
      .join(', ')

    const methodAbi = parseAbi([
      `function ${condition.method}(${paramTypes}) view returns (bool)`,
    ])

    // Replace parameter placeholders
    const args = condition.parameters.map((p) => {
      if (p === ':userAddress') return userAddress
      return p
    })

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const returnValue = await (client as any).readContract({
      address: condition.contractAddress,
      abi: methodAbi,
      functionName: condition.method,
      args,
    })

    // Evaluate return value test
    const success = this.compareString(
      String(returnValue),
      condition.returnValueTest.comparator,
      condition.returnValueTest.value,
    )

    const result: VerificationResult = {
      success,
      value: returnValue,
    }
    this.setCache(cacheKey, result)
    return result
  }

  private compareValues(a: bigint, op: string, b: bigint): boolean {
    switch (op) {
      case '=':
        return a === b
      case '!=':
        return a !== b
      case '>':
        return a > b
      case '<':
        return a < b
      case '>=':
        return a >= b
      case '<=':
        return a <= b
      default:
        return false
    }
  }

  private compareString(a: string, op: string, b: string): boolean {
    switch (op) {
      case '=':
        return a === b
      case '!=':
        return a !== b
      case 'contains':
        return a.includes(b)
      default:
        return false
    }
  }

  private roleNameToHash(role: string): Hex {
    // If role is already a bytes32 hash, return as-is
    if (role.startsWith('0x') && role.length === 66) {
      return role as Hex
    }

    // Well-known roles (OpenZeppelin AccessControl compatible)
    if (role === 'DEFAULT_ADMIN_ROLE') {
      return '0x0000000000000000000000000000000000000000000000000000000000000000'
    }

    // Hash role name using keccak256 (standard AccessControl pattern)
    return keccak256(toBytes(role))
  }

  /**
   * Unified access condition verification
   */
  async verifyAccessCondition(
    condition:
      | BalanceCondition
      | StakeCondition
      | RoleCondition
      | AgentCondition
      | ContractCondition,
    userAddress: Address,
  ): Promise<boolean> {
    try {
      let result: VerificationResult

      switch (condition.type) {
        case 'balance':
          result = await this.verifyBalance(condition, userAddress)
          break
        case 'stake':
          result = await this.verifyStake(condition, userAddress)
          break
        case 'role':
          result = await this.verifyRole(condition, userAddress)
          break
        case 'agent':
          result = await this.verifyAgentOwner(condition, userAddress)
          break
        case 'contract':
          result = await this.verifyContract(condition, userAddress)
          break
        default:
          return false
      }

      return result.success
    } catch (error) {
      // Log error but don't expose details
      console.error(
        `On-chain verification failed for ${condition.type}:`,
        error,
      )
      return false
    }
  }

  /**
   * Clear the verification cache
   */
  clearCache(): void {
    this.cache.clear()
  }

  /**
   * Get cache statistics
   */
  getCacheStats(): { size: number; hits: number } {
    return {
      size: this.cache.size,
      hits: 0, // Could track hits if needed
    }
  }
}

// Singleton instance
let verifierInstance: OnChainVerifier | undefined

export function getOnChainVerifier(
  config?: OnChainVerifierConfig,
): OnChainVerifier {
  if (!verifierInstance) {
    verifierInstance = new OnChainVerifier(config)
  }
  return verifierInstance
}

export function resetOnChainVerifier(): void {
  verifierInstance = undefined
}
