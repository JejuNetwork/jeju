/**
 * Treasury Paymaster
 *
 * Gas sponsorship from a treasury contract for users without gas.
 * Works with any treasury contract that implements the standard interface.
 *
 * SECURITY: Uses MPC signing via SecureSigningService.
 * Private keys are NEVER reconstructed in memory.
 */

import {
  getSecureSigningService,
  type SecureSigningService,
} from '@jejunetwork/kms'
import { type CacheClient, getCacheClient } from '@jejunetwork/shared'
import {
  type Address,
  type Chain,
  concat,
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  type Hex,
  http,
  keccak256,
  pad,
  parseAbiParameters,
  type SignableMessage,
  serializeTransaction,
  type TransactionSerializable,
  type TypedDataDefinition,
  toBytes,
  toHex,
} from 'viem'
import { toAccount } from 'viem/accounts'
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
 *
 * SECURITY: All signing operations use FROST threshold signatures via SecureSigningService.
 * The operator's private key is NEVER reconstructed in memory.
 */
export class TreasuryPaymaster {
  private readonly treasuryAddress: Address
  private readonly operatorKeyId: string
  private readonly operatorAddress: Address
  private readonly rpcUrl: string
  private readonly chainId: number
  private readonly policy: SponsorshipPolicy
  private readonly cache: CacheClient
  private readonly signingService: SecureSigningService

  constructor(config: PaymasterConfig) {
    this.treasuryAddress = config.treasuryAddress
    this.operatorKeyId = config.operatorKeyId
    this.operatorAddress = config.operatorAddress
    this.rpcUrl = config.rpcUrl
    this.chainId = config.chainId
    this.policy = { ...DEFAULT_POLICY, ...config.policy }
    this.cache = getCacheClient('treasury-paymaster')
    this.signingService = getSecureSigningService()
  }

  /**
   * Initialize the paymaster
   * Ensures the MPC key is available
   */
  async initialize(): Promise<void> {
    // Ensure the key exists in the signing service
    if (!this.signingService.hasKey(this.operatorKeyId)) {
      throw new Error(
        `Operator key ${this.operatorKeyId} not found in SecureSigningService. ` +
          'Generate it first using getSecureSigningService().generateKey()',
      )
    }

    // Verify the address matches
    const address = this.signingService.getAddress(this.operatorKeyId)
    if (address.toLowerCase() !== this.operatorAddress.toLowerCase()) {
      throw new Error(
        `Operator key address mismatch: expected ${this.operatorAddress}, got ${address}`,
      )
    }
  }

  /**
   * Determine if a user operation should be sponsored
   */
  async shouldSponsor(
    userId: DID,
    userOp: UserOperation,
  ): Promise<PaymasterDecision> {
    // Check policy first
    const policyCheck = await this.checkPolicy(userId, userOp)
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
   * Generates ERC-4337 compliant paymaster signature
   */
  async createPaymasterData(
    userId: DID,
    userOp: UserOperation,
  ): Promise<SponsorshipResult> {
    const decision = await this.shouldSponsor(userId, userOp)

    if (!decision.sponsor) {
      return { sponsored: false, error: decision.reason }
    }

    const validUntil =
      decision.validUntil ?? Math.floor(Date.now() / 1000) + 3600
    const validAfter = Math.floor(Date.now() / 1000)

    // Generate paymaster signature per ERC-4337 spec using MPC signing
    const paymasterDataBytes = await this.generatePaymasterSignature(
      userOp,
      validUntil,
      validAfter,
    )

    const paymasterData: PaymasterData = {
      paymaster: this.operatorAddress,
      paymasterData: paymasterDataBytes,
      validUntil,
      validAfter,
    }

    // Update user state
    await this.updateUserState(userId, decision.maxGas ?? 0n)

    return {
      sponsored: true,
      paymasterData,
      gasLimit: decision.maxGas,
    }
  }

  /**
   * Generate ERC-4337 paymaster signature using MPC signing
   * Format: validUntil (6 bytes) || validAfter (6 bytes) || signature (65 bytes)
   *
   * SECURITY: Uses FROST threshold signing - private key is NEVER reconstructed
   */
  private async generatePaymasterSignature(
    userOp: UserOperation,
    validUntil: number,
    validAfter: number,
  ): Promise<Hex> {
    // Pack validity times into 6 bytes each (48 bits)
    const validUntilBytes = pad(toHex(validUntil), { size: 6 })
    const validAfterBytes = pad(toHex(validAfter), { size: 6 })

    // Create the hash to sign
    // This is the UserOperation hash with paymaster validation data
    const userOpHash = this.hashUserOp(userOp)

    // Create paymaster hash: keccak256(userOpHash || validUntil || validAfter)
    const paymasterHash = keccak256(
      encodeAbiParameters(parseAbiParameters('bytes32, uint48, uint48'), [
        userOpHash,
        validUntil,
        validAfter,
      ]),
    )

    // Sign the paymaster hash using MPC (FROST)
    const signResult = await this.signingService.sign({
      keyId: this.operatorKeyId,
      message: '',
      messageHash: paymasterHash,
    })

    // Pack: validUntil (6 bytes) || validAfter (6 bytes) || signature (65 bytes)
    return concat([validUntilBytes, validAfterBytes, signResult.signature])
  }

  /**
   * Hash a UserOperation for signing
   * Per ERC-4337 spec
   */
  private hashUserOp(userOp: UserOperation): Hex {
    const packed = encodeAbiParameters(
      parseAbiParameters(
        'address, uint256, bytes32, bytes32, uint256, uint256, uint256, uint256, uint256, bytes32',
      ),
      [
        userOp.sender,
        userOp.nonce,
        keccak256(userOp.initCode),
        keccak256(userOp.callData),
        userOp.callGasLimit,
        userOp.verificationGasLimit,
        userOp.preVerificationGas,
        userOp.maxFeePerGas,
        userOp.maxPriorityFeePerGas,
        // paymasterAndData hash excludes signature (we're generating it)
        keccak256('0x'),
      ],
    )

    return keccak256(
      encodeAbiParameters(parseAbiParameters('bytes32, address, uint256'), [
        keccak256(packed),
        this.treasuryAddress,
        BigInt(this.chainId),
      ]),
    )
  }

  /**
   * Check if operation passes policy requirements
   */
  private async checkPolicy(
    userId: DID,
    userOp: UserOperation,
  ): Promise<PaymasterDecision> {
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
    const userState = await this.getUserState(userId)
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
   * Get or create user state from distributed cache
   */
  private async getUserState(userId: DID): Promise<UserSponsorshipState> {
    const cacheKey = `paymaster:user:${userId}`
    const cached = await this.cache.get(cacheKey)

    if (cached) {
      const parsed = JSON.parse(cached) as {
        userId: DID
        gasUsedToday: string
        lastReset: number
        totalGasSponsored: string
        transactionCount: number
      }

      const state: UserSponsorshipState = {
        userId: parsed.userId,
        gasUsedToday: BigInt(parsed.gasUsedToday),
        lastReset: parsed.lastReset,
        totalGasSponsored: BigInt(parsed.totalGasSponsored),
        transactionCount: parsed.transactionCount,
      }

      // Reset daily counter if needed
      const oneDayMs = 24 * 60 * 60 * 1000
      if (Date.now() - state.lastReset > oneDayMs) {
        state.gasUsedToday = 0n
        state.lastReset = Date.now()
        await this.saveUserState(userId, state)
      }

      return state
    }

    // Create new state
    const state: UserSponsorshipState = {
      userId,
      gasUsedToday: 0n,
      lastReset: Date.now(),
      totalGasSponsored: 0n,
      transactionCount: 0,
    }
    await this.saveUserState(userId, state)
    return state
  }

  /**
   * Save user state to distributed cache
   */
  private async saveUserState(
    userId: DID,
    state: UserSponsorshipState,
  ): Promise<void> {
    const cacheKey = `paymaster:user:${userId}`
    const serializable = {
      userId: state.userId,
      gasUsedToday: state.gasUsedToday.toString(),
      lastReset: state.lastReset,
      totalGasSponsored: state.totalGasSponsored.toString(),
      transactionCount: state.transactionCount,
    }
    // TTL of 7 days for user state
    await this.cache.set(cacheKey, JSON.stringify(serializable), 604800)
  }

  /**
   * Update user state after sponsorship
   */
  private async updateUserState(userId: DID, gasUsed: bigint): Promise<void> {
    const state = await this.getUserState(userId)
    state.gasUsedToday += gasUsed
    state.totalGasSponsored += gasUsed
    state.transactionCount += 1
    await this.saveUserState(userId, state)
  }

  /**
   * Fund a user's wallet directly from treasury
   *
   * SECURITY: This operation requires sending a transaction, which uses
   * the MPC-signed account to interact with the treasury contract.
   */
  async fundUser(userAddress: Address, amount: bigint): Promise<Hex> {
    const chain = getChain(this.chainId)

    // Create MPC-backed account using viem's toAccount helper
    const mpcAccount = toAccount({
      address: this.operatorAddress,
      signMessage: async ({ message }: { message: SignableMessage }) => {
        const msgBytes =
          typeof message === 'string'
            ? toBytes(message)
            : 'raw' in message
              ? message.raw
              : toBytes(message as string)
        const result = await this.signingService.sign({
          keyId: this.operatorKeyId,
          message: msgBytes,
        })
        return result.signature
      },
      signTransaction: async (tx: TransactionSerializable) => {
        // Serialize the transaction to get the hash
        const serialized = serializeTransaction(tx)
        const txHash = keccak256(serialized)
        const signResult = await this.signingService.sign({
          keyId: this.operatorKeyId,
          message: '',
          messageHash: txHash,
        })
        // Return serialized transaction with signature
        return serializeTransaction(tx, {
          r: signResult.r,
          s: signResult.s,
          v: BigInt(signResult.v),
        })
      },
      signTypedData: async <
        const TTypedData extends
          | Record<string, readonly { name: string; type: string }[]>
          | Record<string, unknown>,
        TPrimaryType extends
          | keyof TTypedData
          | 'EIP712Domain' = keyof TTypedData,
      >(
        typedData: TypedDataDefinition<TTypedData, TPrimaryType>,
      ) => {
        const result = await this.signingService.signTypedData({
          keyId: this.operatorKeyId,
          domain: typedData.domain as Parameters<
            typeof this.signingService.signTypedData
          >[0]['domain'],
          types: Object.fromEntries(
            Object.entries(typedData.types ?? {}).map(([key, value]) => [
              key,
              (value as readonly { name: string; type: string }[]).map((v) => ({
                name: v.name,
                type: v.type,
              })),
            ]),
          ) as Record<string, Array<{ name: string; type: string }>>,
          primaryType: typedData.primaryType as string,
          message: typedData.message as Record<string, unknown>,
        })
        return result.signature
      },
    })

    // Create wallet client with MPC-backed signing
    const walletClient = createWalletClient({
      account: mpcAccount,
      chain,
      transport: http(this.rpcUrl),
    })

    // Withdraw from treasury
    await walletClient.writeContract({
      account: mpcAccount,
      address: this.treasuryAddress,
      abi: TREASURY_ABI,
      functionName: 'withdraw',
      args: [amount],
    })

    // Send to user
    return walletClient.sendTransaction({
      account: mpcAccount,
      to: userAddress,
      value: amount,
    })
  }

  /**
   * Get sponsorship statistics
   * Note: With distributed cache, aggregate stats require separate tracking
   */
  async getStats(): Promise<{
    totalUsers: number
    totalTransactions: number
    totalGasSponsored: bigint
  }> {
    // Get aggregate stats from cache
    const statsKey = 'paymaster:stats:aggregate'
    const cached = await this.cache.get(statsKey)

    if (cached) {
      const parsed = JSON.parse(cached) as {
        totalUsers: number
        totalTransactions: number
        totalGasSponsored: string
      }
      return {
        totalUsers: parsed.totalUsers,
        totalTransactions: parsed.totalTransactions,
        totalGasSponsored: BigInt(parsed.totalGasSponsored),
      }
    }

    return {
      totalUsers: 0,
      totalTransactions: 0,
      totalGasSponsored: 0n,
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

  /**
   * Shutdown the paymaster - called when cleaning up
   * Note: With distributed cache, no local cleanup needed
   */
  shutdown(): void {
    // No local cleanup needed - cache handles TTL expiration
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
