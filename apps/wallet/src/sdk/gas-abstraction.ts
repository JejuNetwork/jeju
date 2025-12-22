/**
 * @fileoverview Gas Abstraction Layer
 *
 * Unified gas payment interface that:
 * - Automatically selects best payment token
 * - Supports native ETH, ERC20s, and sponsored transactions
 * - Integrates with CrossChainPaymaster for multi-token payment
 * - Works across all supported chains
 */

import type { Address, Hex, PublicClient, WalletClient } from 'viem'
import { AAClient } from './account-abstraction'
import { EILClient } from './eil'
import type { GasOption, TokenBalance } from './types'

// ============================================================================
// Types
// ============================================================================

export type GasPaymentMode = 'native' | 'token' | 'sponsored' | 'cross-chain'

export interface GasConfig {
  preferredMode: GasPaymentMode
  preferredToken?: Address
  maxGasPriceGwei?: number
  autoBridge?: boolean // Auto-bridge gas token if needed
}

export interface GasPaymentResult {
  mode: GasPaymentMode
  token: Address
  tokenSymbol: string
  amountPaid: bigint
  ethEquivalent: bigint
  usdValue?: number
  txHash?: Hex
}

export interface GasStatus {
  chainId: number
  hasNativeBalance: boolean
  nativeBalance: bigint
  canPayWithTokens: boolean
  availableTokens: GasOption[]
  recommendedToken?: GasOption
  needsBridge: boolean
  bridgeEstimate?: {
    sourceChain: number
    amount: bigint
    fee: bigint
  }
}

// ============================================================================
// Gas Abstraction Service
// ============================================================================

export interface GasServiceConfig {
  publicClients: Map<number, PublicClient>
  walletClient?: WalletClient
  supportedChains: number[]
  defaultConfig?: Partial<GasConfig>
}

export class GasAbstractionService {
  private publicClients: Map<number, PublicClient>
  private walletClient?: WalletClient
  private supportedChains: number[]
  private config: GasConfig
  private eilClients: Map<number, EILClient> = new Map()
  private aaClients: Map<number, AAClient> = new Map()

  constructor(serviceConfig: GasServiceConfig) {
    this.publicClients = serviceConfig.publicClients
    this.walletClient = serviceConfig.walletClient
    this.supportedChains = serviceConfig.supportedChains
    this.config = {
      preferredMode: 'token',
      maxGasPriceGwei: 100,
      autoBridge: true,
      ...serviceConfig.defaultConfig,
    }

    // Initialize clients for each chain
    for (const chainId of serviceConfig.supportedChains) {
      const publicClient = this.publicClients.get(chainId)
      if (publicClient) {
        this.eilClients.set(
          chainId,
          new EILClient({
            chainId,
            publicClient,
            walletClient: this.walletClient,
          }),
        )
        this.aaClients.set(
          chainId,
          new AAClient({
            chainId,
            publicClient,
            walletClient: this.walletClient,
          }),
        )
      }
    }
  }

  /**
   * Get gas status for a chain
   * Shows if user can pay for gas and how
   */
  async getGasStatus(
    chainId: number,
    userAddress: Address,
    tokenBalances: TokenBalance[],
  ): Promise<GasStatus> {
    const publicClient = this.publicClients.get(chainId)
    if (!publicClient) {
      throw new Error(`Chain ${chainId} not supported`)
    }

    // Get native balance
    const nativeBalance = await publicClient.getBalance({
      address: userAddress,
    })
    const hasNativeBalance = nativeBalance > 0n

    // Get estimated gas cost (use a standard transfer as baseline)
    const gasPrice = await publicClient.getGasPrice()
    const estimatedGasCost = gasPrice * 21000n // Standard ETH transfer

    // Check token options via EIL
    const eilClient = this.eilClients.get(chainId)
    const availableTokens: GasOption[] = []

    if (eilClient && tokenBalances.length > 0) {
      const chainBalances = tokenBalances.filter(
        (tb) => tb.token.chainId === chainId,
      )

      for (const tb of chainBalances) {
        const sponsorCheck = await eilClient.canSponsor(
          estimatedGasCost,
          tb.token.address,
          userAddress,
        )

        if (sponsorCheck.canSponsor) {
          availableTokens.push({
            token: tb.token,
            tokenAmount: sponsorCheck.tokenCost,
            ethEquivalent: estimatedGasCost,
            usdValue: tb.usdValue ?? 0,
          })
        }
      }
    }

    // Sort by USD value (cheapest first)
    availableTokens.sort((a, b) => a.usdValue - b.usdValue)

    const canPayWithTokens = availableTokens.length > 0
    const recommendedToken = availableTokens[0]

    // Check if we need to bridge gas from another chain
    let needsBridge = false
    let bridgeEstimate: GasStatus['bridgeEstimate']

    if (!hasNativeBalance && !canPayWithTokens) {
      // Look for balances on other chains
      for (const otherChainId of this.supportedChains) {
        if (otherChainId === chainId) continue

        const otherBalances = tokenBalances.filter(
          (tb) => tb.token.chainId === otherChainId,
        )
        const hasOtherBalance = otherBalances.some((tb) => tb.balance > 0n)

        if (hasOtherBalance) {
          needsBridge = true
          bridgeEstimate = {
            sourceChain: otherChainId,
            amount: estimatedGasCost * 2n, // 2x for buffer
            fee: estimatedGasCost / 10n, // Estimated bridge fee
          }
          break
        }
      }
    }

    return {
      chainId,
      hasNativeBalance,
      nativeBalance,
      canPayWithTokens,
      availableTokens,
      recommendedToken,
      needsBridge,
      bridgeEstimate,
    }
  }

  /**
   * Get the best gas payment option across all chains
   */
  async getBestGasOption(
    chainId: number,
    userAddress: Address,
    tokenBalances: TokenBalance[],
    estimatedGas: bigint,
  ): Promise<GasOption | null> {
    const eilClient = this.eilClients.get(chainId)
    if (!eilClient) return null

    const chainBalances = tokenBalances.filter(
      (tb) => tb.token.chainId === chainId,
    )
    if (chainBalances.length === 0) return null

    const publicClient = this.publicClients.get(chainId)
    if (!publicClient) return null

    const gasPrice = await publicClient.getGasPrice()
    const gasCostETH = estimatedGas * gasPrice

    const result = await eilClient.getBestPaymentTokenForApp(
      '0x0000000000000000000000000000000000000000' as Address, // No specific app
      userAddress,
      gasCostETH,
      chainBalances,
    )

    if (result.bestToken === '0x0000000000000000000000000000000000000000') {
      return null
    }

    const tokenBalance = chainBalances.find(
      (tb) => tb.token.address === result.bestToken,
    )
    if (!tokenBalance) return null

    return {
      token: tokenBalance.token,
      tokenAmount: result.tokenCost,
      ethEquivalent: gasCostETH,
      usdValue: tokenBalance.usdValue ?? 0,
      reason: result.reason,
    }
  }

  /**
   * Build paymaster data for a UserOperation
   */
  buildPaymasterData(
    chainId: number,
    paymentToken: Address,
    appAddress?: Address,
  ): Hex {
    const eilClient = this.eilClients.get(chainId)
    if (!eilClient) {
      return '0x'
    }

    return eilClient.buildPaymasterData(
      0, // Token payment mode
      paymentToken,
      appAddress ?? ('0x0000000000000000000000000000000000000000' as Address),
    )
  }

  /**
   * Ensure user has gas on target chain
   * Will auto-bridge if needed and autoBridge is enabled
   */
  async ensureGas(
    targetChainId: number,
    userAddress: Address,
    tokenBalances: TokenBalance[],
    minAmount: bigint,
  ): Promise<{
    ready: boolean
    action?: 'none' | 'bridge' | 'swap'
    txHash?: Hex
  }> {
    const status = await this.getGasStatus(
      targetChainId,
      userAddress,
      tokenBalances,
    )

    // Already have native balance
    if (status.nativeBalance >= minAmount) {
      return { ready: true, action: 'none' }
    }

    // Can pay with tokens
    if (status.canPayWithTokens) {
      return { ready: true, action: 'none' }
    }

    // Need to bridge
    if (status.needsBridge && this.config.autoBridge && status.bridgeEstimate) {
      const eilClient = this.eilClients.get(status.bridgeEstimate.sourceChain)
      if (eilClient && this.walletClient) {
        const result = await eilClient.createCrossChainTransfer({
          sourceToken: '0x0000000000000000000000000000000000000000' as Address,
          amount: status.bridgeEstimate.amount,
          destinationToken:
            '0x0000000000000000000000000000000000000000' as Address,
          destinationChainId: targetChainId,
          recipient: userAddress,
        })

        return { ready: false, action: 'bridge', txHash: result.txHash }
      }
    }

    return { ready: false }
  }

  /**
   * Update configuration
   */
  setConfig(config: Partial<GasConfig>): void {
    this.config = { ...this.config, ...config }
  }

  /**
   * Get supported payment tokens for a chain
   */
  getSupportedTokens(chainId: number): Address[] {
    // These would typically come from contract or config
    const tokensByChain: Record<number, Address[]> = {
      1: [
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
        '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
        '0x6B175474E89094C44Da98b954EescdeCB5F6c6bB', // DAI
      ],
      8453: [
        '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', // USDC
      ],
      42161: [
        '0xaf88d065e77c8cC2239327C5EDb3A432268e5831', // USDC
        '0xFd086bC7CD5C481DCC9C85ebE478A1C0b69FCbb9', // USDT
      ],
      1337: [], // Localnet - dynamically determined
    }

    return (tokensByChain[chainId] ?? []) as Address[]
  }
}

// ============================================================================
// Factory Function
// ============================================================================

export function createGasService(
  config: GasServiceConfig,
): GasAbstractionService {
  return new GasAbstractionService(config)
}
