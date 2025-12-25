/**
 * Treasury Paymaster
 *
 * Gas sponsorship from a treasury contract for users without gas.
 * Works with any treasury contract that implements the standard interface.
 */

import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia, foundry, mainnet, sepolia } from 'viem/chains'
import type { DID } from '../did/index.js'
import type {
  PaymasterConfig,
  PaymasterData,
  PaymasterDecision,
  SponsorshipPolicy,
  SponsorshipResult,
  UserOperation,
  UserSponsorshipState,
} from './types.js'

/**
 * Default sponsorship policy
 */
const DEFAULT_POLICY: SponsorshipPolicy = {
  maxGasPerTx: 500_000n,
  maxGasPerUserPerDay: 5_000_000n,
  whitelistedContracts: [],
  blacklistedContracts: [],
  newUsersOnly: false,
  minReputation: 0,
}

/**
 * Treasury contract ABI (standard interface)
 */
const TREASURY_ABI = [
  {
    inputs: [],
    name: 'getBalance',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'amount', type: 'uint256' }],
    name: 'withdraw',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'isOperatorActive',
    outputs: [{ name: '', type: 'bool' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

/**
 * Empty hex value for paymaster data
 */
const EMPTY_HEX: Hex = '0x'

/**
 * Minimum balance threshold (0.001 ETH)
 */
const MIN_BALANCE_THRESHOLD = 1_000_000_000_000_000n

/**
 * Get chain configuration from chain ID
 */
function getChain(chainId: number): Chain {
  switch (chainId) {
    case 1:
      return mainnet
    case 11155111:
      return sepolia
    case 8453:
      return base
    case 84532:
      return baseSepolia
    case 31337:
      return foundry
    default:
      // Default to foundry for local/unknown chains
      return foundry
  }
}

/**
 * Treasury Paymaster
 *
 * Manages gas sponsorship for users from a treasury contract.
 * Tracks per-user gas usage and enforces policy limits.
 */
export class TreasuryPaymaster {
  private readonly treasuryAddress: Address
  private readonly operatorPrivateKey: Hex
  private readonly rpcUrl: string
  private readonly chainId: number
  private readonly policy: SponsorshipPolicy
  private readonly userStates: Map<DID, UserSponsorshipState>

  constructor(config: PaymasterConfig) {
    this.treasuryAddress = config.treasuryAddress
    this.operatorPrivateKey = config.operatorPrivateKey
    this.rpcUrl = config.rpcUrl
    this.chainId = config.chainId
    this.policy = { ...DEFAULT_POLICY, ...config.policy }
    this.userStates = new Map()
  }

  /**
   * Determine if a user operation should be sponsored
   */
  async shouldSponsor(
    userId: DID,
    userOp: UserOperation,
  ): Promise<PaymasterDecision> {
    // Check policy first
    const policyCheck = this.checkPolicy(userId, userOp)
    if (!policyCheck.sponsor) {
      return policyCheck
    }

    // Check if user already has gas
    const hasGas = await this.userHasGas(userOp.sender)
    if (hasGas) {
      return { sponsor: false, reason: 'User has sufficient gas' }
    }

    // Check treasury balance
    const treasuryBalance = await this.getTreasuryBalance()
    const estimatedGas = this.estimateGas(userOp)

    if (treasuryBalance < estimatedGas) {
      return { sponsor: false, reason: 'Treasury balance insufficient' }
    }

    return {
      sponsor: true,
      reason: 'User eligible for sponsorship',
      maxGas: this.policy.maxGasPerTx,
      validUntil: Math.floor(Date.now() / 1000) + 3600, // 1 hour validity
    }
  }

  /**
   * Create paymaster data for a sponsored operation
   */
  async createPaymasterData(
    userId: DID,
    userOp: UserOperation,
  ): Promise<SponsorshipResult> {
    const decision = await this.shouldSponsor(userId, userOp)

    if (!decision.sponsor) {
      return { sponsored: false, error: decision.reason }
    }

    const account = privateKeyToAccount(this.operatorPrivateKey)
    const validUntil =
      decision.validUntil ?? Math.floor(Date.now() / 1000) + 3600
    const validAfter = Math.floor(Date.now() / 1000)

    const paymasterData: PaymasterData = {
      paymaster: account.address,
      paymasterData: EMPTY_HEX,
      validUntil,
      validAfter,
    }

    // Update user state
    this.updateUserState(userId, decision.maxGas ?? 0n)

    return {
      sponsored: true,
      paymasterData,
      gasLimit: decision.maxGas,
    }
  }

  /**
   * Check if operation passes policy requirements
   */
  private checkPolicy(userId: DID, userOp: UserOperation): PaymasterDecision {
    const targetContract = userOp.sender

    // Check blacklist
    if (
      this.policy.blacklistedContracts.some(
        (c) => c.toLowerCase() === targetContract.toLowerCase(),
      )
    ) {
      return { sponsor: false, reason: 'Contract is blacklisted' }
    }

    // Check whitelist (if configured)
    if (
      this.policy.whitelistedContracts.length > 0 &&
      !this.policy.whitelistedContracts.some(
        (c) => c.toLowerCase() === targetContract.toLowerCase(),
      )
    ) {
      return { sponsor: false, reason: 'Contract is not whitelisted' }
    }

    // Check daily limit
    const userState = this.getUserState(userId)
    if (userState.gasUsedToday >= this.policy.maxGasPerUserPerDay) {
      return { sponsor: false, reason: 'Daily gas limit exceeded' }
    }

    return {
      sponsor: true,
      reason: 'Policy check passed',
      maxGas: this.policy.maxGasPerTx,
    }
  }

  /**
   * Check if user has sufficient gas
   */
  private async userHasGas(address: Address): Promise<boolean> {
    const client = createPublicClient({
      chain: getChain(this.chainId),
      transport: http(this.rpcUrl),
    })

    const balance = await client.getBalance({ address })
    return balance > MIN_BALANCE_THRESHOLD
  }

  /**
   * Get treasury contract balance
   */
  private async getTreasuryBalance(): Promise<bigint> {
    const client = createPublicClient({
      chain: getChain(this.chainId),
      transport: http(this.rpcUrl),
    })

    return client.readContract({
      address: this.treasuryAddress,
      abi: TREASURY_ABI,
      functionName: 'getBalance',
    })
  }

  /**
   * Estimate gas cost for a user operation
   */
  private estimateGas(userOp: UserOperation): bigint {
    const totalGas =
      userOp.callGasLimit +
      userOp.verificationGasLimit +
      userOp.preVerificationGas

    return totalGas * userOp.maxFeePerGas
  }

  /**
   * Get or create user state
   */
  private getUserState(userId: DID): UserSponsorshipState {
    let state = this.userStates.get(userId)

    if (!state) {
      state = {
        userId,
        gasUsedToday: 0n,
        lastReset: Date.now(),
        totalGasSponsored: 0n,
        transactionCount: 0,
      }
      this.userStates.set(userId, state)
    }

    // Reset daily counter if needed
    const oneDayMs = 24 * 60 * 60 * 1000
    if (Date.now() - state.lastReset > oneDayMs) {
      state.gasUsedToday = 0n
      state.lastReset = Date.now()
    }

    return state
  }

  /**
   * Update user state after sponsorship
   */
  private updateUserState(userId: DID, gasUsed: bigint): void {
    const state = this.getUserState(userId)
    state.gasUsedToday += gasUsed
    state.totalGasSponsored += gasUsed
    state.transactionCount += 1
  }

  /**
   * Fund a user's wallet directly from treasury
   */
  async fundUser(userAddress: Address, amount: bigint): Promise<Hex> {
    const account = privateKeyToAccount(this.operatorPrivateKey)
    const chain = getChain(this.chainId)

    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(this.rpcUrl),
    })

    // Withdraw from treasury
    await walletClient.writeContract({
      address: this.treasuryAddress,
      abi: TREASURY_ABI,
      functionName: 'withdraw',
      args: [amount],
    })

    // Send to user
    return walletClient.sendTransaction({
      to: userAddress,
      value: amount,
    })
  }

  /**
   * Get sponsorship statistics
   */
  getStats(): {
    totalUsers: number
    totalTransactions: number
    totalGasSponsored: bigint
  } {
    let totalTransactions = 0
    let totalGasSponsored = 0n

    for (const state of this.userStates.values()) {
      totalTransactions += state.transactionCount
      totalGasSponsored += state.totalGasSponsored
    }

    return {
      totalUsers: this.userStates.size,
      totalTransactions,
      totalGasSponsored,
    }
  }

  /**
   * Get current policy
   */
  getPolicy(): SponsorshipPolicy {
    return { ...this.policy }
  }

  /**
   * Check if treasury is operational
   */
  async isOperational(): Promise<boolean> {
    const client = createPublicClient({
      chain: getChain(this.chainId),
      transport: http(this.rpcUrl),
    })

    const [balance, isActive] = await Promise.all([
      this.getTreasuryBalance(),
      client.readContract({
        address: this.treasuryAddress,
        abi: TREASURY_ABI,
        functionName: 'isOperatorActive',
      }),
    ])

    return balance > 0n && isActive
  }
}

/**
 * Create a treasury paymaster instance
 */
export function createTreasuryPaymaster(
  config: PaymasterConfig,
): TreasuryPaymaster {
  return new TreasuryPaymaster(config)
}
