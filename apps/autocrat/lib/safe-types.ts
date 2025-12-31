/**
 * Safe/Gnosis Multisig Types for Autocrat
 *
 * Provides type definitions for Safe integration including:
 * - Safe wallet info and configuration
 * - Transaction proposals, confirmations, execution
 * - Multi-call batching for complex DAO operations
 */

import type { Address, Hex } from 'viem'

// ============================================================================
// Safe Configuration
// ============================================================================

export interface SafeInfo {
  address: Address
  chainId: number
  owners: Address[]
  threshold: number
  nonce: number
  version: string
  modules: Address[]
  guard?: Address
  fallbackHandler?: Address
}

export interface SafeConfig {
  safeAddress: Address
  chainId: number
  transactionServiceUrl: string
}

// ============================================================================
// Safe Transactions
// ============================================================================

export interface SafeTransaction {
  to: Address
  value: bigint
  data: Hex
  operation: SafeOperation
  safeTxGas: bigint
  baseGas: bigint
  gasPrice: bigint
  gasToken: Address
  refundReceiver: Address
  nonce: number
}

export const SafeOperation = {
  CALL: 0,
  DELEGATE_CALL: 1,
} as const
export type SafeOperation = (typeof SafeOperation)[keyof typeof SafeOperation]

export interface SafeConfirmation {
  owner: Address
  signature: Hex
  submissionDate: string
  signatureType: 'EOA' | 'ETH_SIGN' | 'CONTRACT_SIGNATURE'
}

export interface SafeTransactionData extends SafeTransaction {
  safe: Address
  confirmations: SafeConfirmation[]
  confirmationsRequired: number
  isExecuted: boolean
  safeTxHash: Hex
  proposer: Address
  submissionDate: string
  executionDate?: string
  executor?: Address
  transactionHash?: Hex
  origin?: string
  dataDecoded?: DecodedData
}

export interface DecodedData {
  method: string
  parameters: Array<{
    name: string
    type: string
    value: string
  }>
}

// ============================================================================
// Transaction Proposal
// ============================================================================

export interface SafeTransactionProposal {
  safeAddress: Address
  to: Address
  value: bigint
  data: Hex
  operation?: SafeOperation
  title: string
  description: string
  category: SafeTransactionCategory
  proposer: Address
  daoId?: string
  linkedProposalId?: string
}

export const SafeTransactionCategory = {
  TREASURY_WITHDRAWAL: 'treasury_withdrawal',
  TOKEN_TRANSFER: 'token_transfer',
  CONTRACT_CALL: 'contract_call',
  GOVERNANCE_ACTION: 'governance_action',
  PARAMETER_CHANGE: 'parameter_change',
  OWNERSHIP_TRANSFER: 'ownership_transfer',
  MODULE_MANAGEMENT: 'module_management',
  GUARD_MANAGEMENT: 'guard_management',
  BATCH_OPERATION: 'batch_operation',
  OTHER: 'other',
} as const
export type SafeTransactionCategory =
  (typeof SafeTransactionCategory)[keyof typeof SafeTransactionCategory]

export interface SafeProposalResult {
  safeTxHash: Hex
  nonce: number
  proposedAt: number
}

// ============================================================================
// Batch Transactions (MultiSend)
// ============================================================================

export interface MultiSendTransaction {
  to: Address
  value: bigint
  data: Hex
  operation: SafeOperation
}

export interface BatchTransactionProposal {
  safeAddress: Address
  transactions: MultiSendTransaction[]
  title: string
  description: string
  proposer: Address
  daoId?: string
}

// ============================================================================
// Safe Status & History
// ============================================================================

export interface SafeTransactionStatus {
  safeTxHash: Hex
  status:
    | 'pending'
    | 'awaiting_confirmations'
    | 'ready_to_execute'
    | 'executed'
    | 'failed'
  confirmations: number
  required: number
  canExecute: boolean
  executionDate?: number
  transactionHash?: Hex
}

export interface SafeTransactionHistory {
  transactions: SafeTransactionData[]
  totalCount: number
  pageSize: number
  page: number
}

// ============================================================================
// DAO Safe Integration
// ============================================================================

export interface DAOSafeInfo {
  daoId: string
  safeAddress: Address
  chainId: number
  role: DAOSafeRole
  signers: DAOSafeSigner[]
  threshold: number
  pendingTransactions: number
}

export const DAOSafeRole = {
  TREASURY: 'treasury',
  GOVERNANCE: 'governance',
  SECURITY_COUNCIL: 'security_council',
  OPERATOR: 'operator',
} as const
export type DAOSafeRole = (typeof DAOSafeRole)[keyof typeof DAOSafeRole]

export interface DAOSafeSigner {
  address: Address
  name: string
  isHuman: boolean
  agentId?: bigint
  role?: string
  lastSigned?: number
}

// ============================================================================
// Treasury Safe Operations
// ============================================================================

export interface TreasuryWithdrawRequest {
  daoId: string
  token: Address
  amount: bigint
  recipient: Address
  reason: string
  proposer: Address
  linkedProposalId?: string
}

export interface TreasurySwapRequest {
  daoId: string
  tokenIn: Address
  tokenOut: Address
  amountIn: bigint
  minAmountOut: bigint
  reason: string
  proposer: Address
}

export interface RecurringPaymentRequest {
  daoId: string
  recipient: Address
  token: Address
  amount: bigint
  interval: number // seconds
  maxPayments: number // 0 = unlimited
  description: string
  proposer: Address
}

// ============================================================================
// Governance Safe Operations
// ============================================================================

export interface GovernanceProposal {
  daoId: string
  target: Address
  calldata: Hex
  value: bigint
  description: string
  timelockDelay?: number
  proposer: Address
}

export interface ParameterChangeRequest {
  daoId: string
  contract: Address
  parameter: string
  newValue: string | bigint | boolean
  reason: string
  proposer: Address
}

// ============================================================================
// Safe Transaction Service API Types
// ============================================================================

export interface SafeTransactionServiceResponse {
  count: number
  next: string | null
  previous: string | null
  results: SafeTransactionData[]
}

export interface SafeBalancesResponse {
  fiatTotal: string
  items: Array<{
    tokenInfo: {
      type: string
      address: Address
      name: string
      symbol: string
      decimals: number
      logoUri?: string
    }
    balance: string
    fiatBalance: string
    fiatConversion: string
  }>
}

// ============================================================================
// Director Module Types
// ============================================================================

export interface DirectorModuleConfig {
  treasury: Address
  director: Address
  approvedRecurringPayments: Hex[]
  approvedTopUpAccounts: Array<{
    account: Address
    token: Address
    limit: bigint
  }>
}

export interface DirectorAction {
  type: 'recurring_payment' | 'top_up' | 'swap'
  paymentId?: Hex
  account?: Address
  token?: Address
  amount?: bigint
}

// ============================================================================
// Error Types
// ============================================================================

export class SafeError extends Error {
  constructor(
    message: string,
    public code: SafeErrorCode,
    public details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'SafeError'
  }
}

export const SafeErrorCode = {
  NOT_A_SAFE: 'NOT_A_SAFE',
  NOT_AN_OWNER: 'NOT_AN_OWNER',
  INVALID_SIGNATURE: 'INVALID_SIGNATURE',
  ALREADY_SIGNED: 'ALREADY_SIGNED',
  THRESHOLD_NOT_MET: 'THRESHOLD_NOT_MET',
  NONCE_MISMATCH: 'NONCE_MISMATCH',
  TX_NOT_FOUND: 'TX_NOT_FOUND',
  EXECUTION_FAILED: 'EXECUTION_FAILED',
  SERVICE_UNAVAILABLE: 'SERVICE_UNAVAILABLE',
  INSUFFICIENT_FUNDS: 'INSUFFICIENT_FUNDS',
} as const
export type SafeErrorCode = (typeof SafeErrorCode)[keyof typeof SafeErrorCode]
