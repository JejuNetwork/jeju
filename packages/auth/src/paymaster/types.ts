/**
 * Paymaster Types
 *
 * Types for gas sponsorship in decentralized applications.
 */

import type { Address, Hex } from 'viem'
import type { DID } from '../did/index.js'

/**
 * Paymaster data for sponsored ERC-4337 operations
 */
export interface PaymasterData {
  paymaster: Address
  paymasterData: Hex
  validUntil: number
  validAfter: number
}

/**
 * ERC-4337 User Operation
 */
export interface UserOperation {
  sender: Address
  nonce: bigint
  initCode: Hex
  callData: Hex
  callGasLimit: bigint
  verificationGasLimit: bigint
  preVerificationGas: bigint
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
  paymasterAndData: Hex
  signature: Hex
}

/**
 * Sponsorship policy configuration
 */
export interface SponsorshipPolicy {
  /** Maximum gas per transaction */
  maxGasPerTx: bigint
  /** Maximum gas per day per user */
  maxGasPerUserPerDay: bigint
  /** Whitelisted contract addresses (empty = all allowed) */
  whitelistedContracts: Address[]
  /** Blacklisted contract addresses */
  blacklistedContracts: Address[]
  /** Whether to sponsor for new users only */
  newUsersOnly: boolean
  /** Minimum user reputation to sponsor */
  minReputation: number
}

/**
 * User sponsorship state tracking
 */
export interface UserSponsorshipState {
  userId: DID
  gasUsedToday: bigint
  lastReset: number
  totalGasSponsored: bigint
  transactionCount: number
}

/**
 * Decision from the paymaster on whether to sponsor
 */
export interface PaymasterDecision {
  sponsor: boolean
  reason: string
  maxGas?: bigint
  validUntil?: number
}

/**
 * Result of a sponsorship request
 */
export interface SponsorshipResult {
  sponsored: boolean
  paymasterData?: PaymasterData
  gasLimit?: bigint
  error?: string
}

/**
 * Gas estimation result
 */
export interface GasEstimate {
  gasLimit: bigint
  maxFeePerGas: bigint
  maxPriorityFeePerGas: bigint
  totalCost: bigint
}

/**
 * Paymaster configuration
 */
export interface PaymasterConfig {
  /** Treasury contract address */
  treasuryAddress: Address
  /** Operator private key for signing */
  operatorPrivateKey: Hex
  /** RPC URL for chain interaction */
  rpcUrl: string
  /** Chain ID */
  chainId: number
  /** Sponsorship policy (optional, uses defaults) */
  policy?: Partial<SponsorshipPolicy>
}

/**
 * Gas estimator configuration
 */
export interface GasEstimatorConfig {
  rpcUrl: string
  chainId: number
}
