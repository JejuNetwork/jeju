/**
 * ERC-4337 Bundler Types
 */

import type { Address, Hex } from 'viem'

/**
 * UserOperation as submitted by users
 */
export interface UserOperation {
  sender: Address
  nonce: bigint | Hex
  initCode: Hex
  callData: Hex
  callGasLimit: bigint | Hex
  verificationGasLimit: bigint | Hex
  preVerificationGas: bigint | Hex
  maxFeePerGas: bigint | Hex
  maxPriorityFeePerGas: bigint | Hex
  paymasterAndData: Hex
  signature: Hex
}

/**
 * Packed UserOperation for EntryPoint v0.7
 */
export interface PackedUserOperation {
  sender: Address
  nonce: bigint
  initCode: Hex
  callData: Hex
  accountGasLimits: Hex // packed verificationGasLimit + callGasLimit
  preVerificationGas: bigint
  gasFees: Hex // packed maxPriorityFeePerGas + maxFeePerGas
  paymasterAndData: Hex
  signature: Hex
}

/**
 * UserOperation hash result
 */
export interface UserOpHashResult {
  userOpHash: Hex
  sender: Address
  nonce: Hex
  success: boolean
  actualGasCost: Hex
  actualGasUsed: Hex
  receipt: {
    transactionHash: Hex
    blockNumber: Hex
    blockHash: Hex
    gasUsed: Hex
  }
}

/**
 * Gas estimation result
 */
export interface GasEstimation {
  callGasLimit: Hex
  verificationGasLimit: Hex
  preVerificationGas: Hex
  maxFeePerGas?: Hex
  maxPriorityFeePerGas?: Hex
}

/**
 * Bundler configuration
 */
export interface BundlerOptions {
  port?: number
  network?: 'localnet' | 'testnet' | 'mainnet'
  rpcUrl?: string
  entryPoint?: Address
  privateKey?: Hex
  beneficiary?: Address
  minBalance?: bigint
  maxBatchSize?: number
  bundleIntervalMs?: number
}

/**
 * Mempool entry
 */
export interface MempoolEntry {
  userOp: UserOperation
  userOpHash: Hex
  prefund: bigint
  referencedContracts: Address[]
  addedAt: number
}

/**
 * Bundle result
 */
export interface BundleResult {
  transactionHash: Hex
  blockNumber: bigint
  success: boolean
  operations: Array<{
    userOpHash: Hex
    sender: Address
    success: boolean
    reason?: string
  }>
}
