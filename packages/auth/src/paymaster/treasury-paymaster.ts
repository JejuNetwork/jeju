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
import {
  type Address,
  type Chain,
  concat,
  createPublicClient,
  createWalletClient,
  custom,
  encodeAbiParameters,
  type Hex,
  http,
  keccak256,
  pad,
  parseAbiParameters,
  toBytes,
  toHex,
} from 'viem'
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
  private readonly userStates: Map<DID, UserSponsorshipState>
  private readonly signingService: SecureSigningService

  constructor(config: PaymasterConfig) {
    this.treasuryAddress = config.treasuryAddress
    this.operatorKeyId = config.operatorKeyId
    this.operatorAddress = config.operatorAddress
    this.rpcUrl = config.rpcUrl
    this.chainId = config.chainId
    this.policy = { ...DEFAULT_POLICY, ...config.policy }
    this.userStates = new Map()
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
    this.updateUserState(userId, decision.maxGas ?? 0n)

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
   *
   * SECURITY: This operation requires sending a transaction, which uses
   * the MPC-signed account to interact with the treasury contract.
   */
  async fundUser(userAddress: Address, amount: bigint): Promise<Hex> {
    const chain = getChain(this.chainId)
    const publicClient = createPublicClient({
      chain,
      transport: http(this.rpcUrl),
    })

    // Create wallet client with MPC-backed signing
    const walletClient = createWalletClient({
      account: {
        address: this.operatorAddress,
        type: 'local',
        publicKey: '0x', // Not needed for transaction signing
        signMessage: async ({ message }) => {
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
        signTransaction: async (tx) => {
          // Serialize and sign the transaction
          const serialized = await publicClient.prepareTransactionRequest(tx)
          const txHash = keccak256(toBytes(JSON.stringify(serialized)))
          const result = await this.signingService.sign({
            keyId: this.operatorKeyId,
            message: '',
            messageHash: txHash,
          })
          return result.signature
        },
        signTypedData: async (typedData) => {
          const result = await this.signingService.signTypedData({
            keyId: this.operatorKeyId,
            domain: typedData.domain as Parameters<
              typeof this.signingService.signTypedData
            >[0]['domain'],
            types: typedData.types as Record<
              string,
              Array<{ name: string; type: string }>
            >,
            primaryType: typedData.primaryType,
            message: typedData.message as Record<string, unknown>,
          })
          return result.signature
        },
      },
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

  /**
   * Shutdown the paymaster - called when cleaning up
   */
  shutdown(): void {
    this.userStates.clear()
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
