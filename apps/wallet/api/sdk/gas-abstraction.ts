/**
 * Gas Abstraction Service
 * Unified gas management across chains with token payment support
 */

import { ZERO_ADDRESS } from '@jejunetwork/types'
import type { Address, PublicClient } from 'viem'
import { createEILClient, type EILClient } from './eil'
import type { TokenBalance } from './types'

// Supported gas tokens by chain
const SUPPORTED_TOKENS: Record<number, Address[]> = {
  // Ethereum Mainnet
  1: [
    '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address, // USDC
    '0xdAC17F958D2ee523a2206206994597C13D831ec7' as Address, // USDT
    '0x6B175474E89094C44Da98b954EesfdeCB5f0f82ae' as Address, // DAI
  ],
  // Base
  8453: [
    '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' as Address, // USDC
  ],
  // Arbitrum
  42161: [
    '0xaf88d065e77c8cC2239327C5EDb3A432268e5831' as Address, // USDC
    '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9' as Address, // USDT
  ],
}

export interface GasConfig {
  preferredMode: 'native' | 'sponsored' | 'auto'
  maxGasPriceGwei: number
  autoBridge: boolean
}

export interface GasServiceConfig {
  publicClients: Map<number, PublicClient>
  supportedChains: number[]
  defaultConfig?: Partial<GasConfig>
}

export interface GasStatus {
  chainId: number
  hasNativeBalance: boolean
  nativeBalance: bigint
  needsBridge: boolean
  bridgeEstimate?: {
    sourceChain: number
    sourceToken: Address
    amount: bigint
    estimatedGas: bigint
  }
}

export interface EnsureGasResult {
  ready: boolean
  action: 'none' | 'bridge' | 'swap' | 'deposit'
  details?: {
    amount?: bigint
    sourceChain?: number
    token?: Address
  }
}

export interface GasOption {
  token: Address
  cost: bigint
  mode: 'native' | 'sponsored'
}

/**
 * Gas Abstraction Service for unified gas management
 */
export class GasAbstractionService {
  private publicClients: Map<number, PublicClient>
  private supportedChains: Set<number>
  private config: GasConfig
  private eilClients: Map<number, EILClient> = new Map()

  constructor(options: GasServiceConfig) {
    this.publicClients = options.publicClients
    this.supportedChains = new Set(options.supportedChains)
    this.config = {
      preferredMode: options.defaultConfig?.preferredMode ?? 'auto',
      maxGasPriceGwei: options.defaultConfig?.maxGasPriceGwei ?? 100,
      autoBridge: options.defaultConfig?.autoBridge ?? true,
    }

    // Initialize EIL clients for supported chains
    for (const chainId of options.supportedChains) {
      const publicClient = options.publicClients.get(chainId)
      if (publicClient) {
        this.eilClients.set(chainId, createEILClient({ chainId, publicClient }))
      }
    }
  }

  /**
   * Update gas configuration
   */
  setConfig(config: Partial<GasConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Get gas status for a chain
   */
  async getGasStatus(
    chainId: number,
    user: Address,
    tokenBalances: TokenBalance[],
  ): Promise<GasStatus> {
    if (!this.supportedChains.has(chainId)) {
      throw new Error(`Chain ${chainId} not supported`)
    }

    const publicClient = this.publicClients.get(chainId)
    if (!publicClient) {
      throw new Error(`No client for chain ${chainId}`)
    }

    // Get native balance
    const nativeBalance = await publicClient.getBalance({ address: user })
    const hasNativeBalance = nativeBalance > 0n

    // Check if we need to bridge
    let needsBridge = false
    let bridgeEstimate: GasStatus['bridgeEstimate']

    if (!hasNativeBalance) {
      // Look for tokens on other chains
      for (const tb of tokenBalances) {
        if (tb.token.chainId !== chainId && tb.balance > 0n) {
          needsBridge = true
          bridgeEstimate = {
            sourceChain: tb.token.chainId,
            sourceToken: tb.token.address as Address,
            amount: tb.balance,
            estimatedGas: 100000n, // Rough estimate
          }
          break
        }
      }
    }

    return {
      chainId,
      hasNativeBalance,
      nativeBalance,
      needsBridge,
      bridgeEstimate,
    }
  }

  /**
   * Get supported tokens for gas payment on a chain
   */
  getSupportedTokens(chainId: number): Address[] {
    return SUPPORTED_TOKENS[chainId] ?? []
  }

  /**
   * Build paymaster data for token payment
   */
  buildPaymasterData(chainId: number, token: Address): `0x${string}` {
    const eilClient = this.eilClients.get(chainId)
    if (!eilClient || !eilClient.isReady()) {
      return '0x'
    }
    return eilClient.buildPaymasterData(token)
  }

  /**
   * Ensure user has enough gas for a transaction
   */
  async ensureGas(
    chainId: number,
    user: Address,
    tokenBalances: TokenBalance[],
    requiredGas: bigint,
  ): Promise<EnsureGasResult> {
    const status = await this.getGasStatus(chainId, user, tokenBalances)

    if (status.hasNativeBalance && status.nativeBalance >= requiredGas) {
      return { ready: true, action: 'none' }
    }

    // Check if we can use sponsored gas
    const eilClient = this.eilClients.get(chainId)
    if (eilClient?.isReady()) {
      const tokens = this.getSupportedTokens(chainId)
      for (const token of tokens) {
        const canSponsor = await eilClient.canSponsor(requiredGas, token, user)
        if (canSponsor.canSponsor) {
          return { ready: true, action: 'none' }
        }
      }
    }

    // Need to bridge or deposit
    if (status.needsBridge && status.bridgeEstimate) {
      return {
        ready: false,
        action: 'bridge',
        details: {
          sourceChain: status.bridgeEstimate.sourceChain,
          token: status.bridgeEstimate.sourceToken,
          amount: status.bridgeEstimate.amount,
        },
      }
    }

    return { ready: false, action: 'deposit' }
  }

  /**
   * Get the best gas payment option
   */
  async getBestGasOption(
    chainId: number,
    user: Address,
    tokenBalances: TokenBalance[],
    estimatedGas: bigint,
  ): Promise<GasOption | null> {
    const eilClient = this.eilClients.get(chainId)
    if (!eilClient?.isReady()) {
      return null
    }

    const relevantBalances = tokenBalances.filter(
      (tb) => tb.token.chainId === chainId && tb.balance > 0n,
    )

    if (relevantBalances.length === 0) {
      return null
    }

    const tokens = relevantBalances.map((tb) => tb.token.address as Address)
    const result = await eilClient.getBestGasToken(user, estimatedGas, tokens)

    if (result.bestToken === ZERO_ADDRESS) {
      return null
    }

    return {
      token: result.bestToken,
      cost: result.tokenCost,
      mode: 'sponsored',
    }
  }
}

/**
 * Create a gas abstraction service
 */
export function createGasService(
  config: GasServiceConfig,
): GasAbstractionService {
  return new GasAbstractionService(config)
}
