/**
 * React hooks for Safe/Gnosis multisig integration
 */

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { Address, Hex } from 'viem'
import { AUTOCRAT_API_URL } from '../config/env'

// ============================================================================
// Types
// ============================================================================

interface SafeInfo {
  address: Address
  chainId: number
  owners: Address[]
  threshold: number
  nonce: number
  version: string
  modules: Address[]
  guard?: Address
}

interface SafeTransaction {
  safeTxHash: Hex
  safe: Address
  to: Address
  value: string
  data: Hex
  operation: number
  safeTxGas: string
  baseGas: string
  gasPrice: string
  gasToken: Address
  refundReceiver: Address
  nonce: number
  confirmations: Array<{
    owner: Address
    signature: Hex
    submissionDate: string
  }>
  confirmationsRequired: number
  isExecuted: boolean
  proposer: Address
  submissionDate: string
  executionDate?: string
  executor?: Address
  transactionHash?: Hex
}

interface TransactionsResponse {
  count: number
  transactions: SafeTransaction[]
}

interface TransactionStatus {
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

interface ProposeTransactionInput {
  safeAddress: Address
  to: Address
  value: string
  data: Hex
  operation?: 0 | 1
  title: string
  description: string
  category?: string
  proposer: Address
  daoId?: string
  linkedProposalId?: string
}

interface ConfirmTransactionInput {
  safeTxHash: Hex
  signer: Address
  signature: Hex
}

interface TreasuryWithdrawInput {
  daoId: string
  token: Address
  amount: string
  recipient: Address
  reason: string
  proposer: Address
  linkedProposalId?: string
}

interface TokenTransferInput {
  safeAddress: Address
  token: Address
  to: Address
  amount: string
  reason: string
}

// ============================================================================
// API Functions
// ============================================================================

async function fetchSafeInfo(address: Address): Promise<SafeInfo> {
  // Use fetch directly since Eden types are complex
  const baseUrl = AUTOCRAT_API_URL
  const response = await fetch(`${baseUrl}/api/v1/safe/info/${address}`)
  const json = await response.json()
  if (!json.success) {
    throw new Error('Failed to fetch Safe info')
  }
  return json.data
}

async function fetchPendingTransactions(
  address: Address,
): Promise<TransactionsResponse> {
  const baseUrl = AUTOCRAT_API_URL
  const response = await fetch(
    `${baseUrl}/api/v1/safe/transactions/pending/${address}`,
  )
  const json = await response.json()
  if (!json.success) {
    throw new Error('Failed to fetch pending transactions')
  }
  return json.data
}

async function fetchTransactionHistory(
  address: Address,
  limit = 20,
): Promise<TransactionsResponse> {
  const baseUrl = AUTOCRAT_API_URL
  const response = await fetch(
    `${baseUrl}/api/v1/safe/transactions/history/${address}?limit=${limit}`,
  )
  const json = await response.json()
  if (!json.success) {
    throw new Error('Failed to fetch transaction history')
  }
  return json.data
}

async function fetchTransaction(
  safeTxHash: Hex,
): Promise<SafeTransaction | null> {
  const baseUrl = AUTOCRAT_API_URL
  const response = await fetch(
    `${baseUrl}/api/v1/safe/transactions/${safeTxHash}`,
  )
  const json = await response.json()
  if (!json.success) {
    if (json.error === 'Transaction not found') return null
    throw new Error(json.error ?? 'Failed to fetch transaction')
  }
  return json.data ?? null
}

async function fetchTransactionStatus(
  safeTxHash: Hex,
): Promise<TransactionStatus> {
  const baseUrl = AUTOCRAT_API_URL
  const response = await fetch(
    `${baseUrl}/api/v1/safe/transactions/${safeTxHash}/status`,
  )
  const json = await response.json()
  if (!json.success) {
    throw new Error('Failed to fetch transaction status')
  }
  return json.data
}

async function proposeTransaction(input: ProposeTransactionInput) {
  const baseUrl = AUTOCRAT_API_URL
  const response = await fetch(`${baseUrl}/api/v1/safe/transactions/propose`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  })
  const json = await response.json()
  if (!json.success) {
    throw new Error('Failed to propose transaction')
  }
  return json.data
}

async function confirmTransaction(input: ConfirmTransactionInput) {
  const baseUrl = AUTOCRAT_API_URL
  const response = await fetch(
    `${baseUrl}/api/v1/safe/transactions/${input.safeTxHash}/confirm`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        signer: input.signer,
        signature: input.signature,
      }),
    },
  )
  const json = await response.json()
  if (!json.success) {
    throw new Error('Failed to confirm transaction')
  }
  return json
}

async function buildExecuteTransaction(safeTxHash: Hex) {
  const baseUrl = AUTOCRAT_API_URL
  const response = await fetch(
    `${baseUrl}/api/v1/safe/transactions/${safeTxHash}/execute`,
  )
  const json = await response.json()
  if (!json.success) {
    throw new Error('Failed to build execute transaction')
  }
  return json.data
}

async function proposeTreasuryWithdraw(input: TreasuryWithdrawInput) {
  const baseUrl = AUTOCRAT_API_URL
  const response = await fetch(
    `${baseUrl}/api/v1/safe/treasury/propose-withdraw`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  const json = await response.json()
  if (!json.success) {
    throw new Error('Failed to propose treasury withdrawal')
  }
  return json.data
}

async function proposeTokenTransfer(input: TokenTransferInput) {
  const baseUrl = AUTOCRAT_API_URL
  const response = await fetch(
    `${baseUrl}/api/v1/safe/treasury/propose-transfer`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    },
  )
  const json = await response.json()
  if (!json.success) {
    throw new Error('Failed to propose token transfer')
  }
  return json.data
}

// ============================================================================
// Hooks
// ============================================================================

/**
 * Fetch Safe wallet info
 */
export function useSafeInfo(address: Address | undefined) {
  return useQuery({
    queryKey: ['safe', 'info', address],
    queryFn: () => {
      if (!address) throw new Error('No address provided')
      return fetchSafeInfo(address)
    },
    enabled: !!address,
    staleTime: 30_000, // 30 seconds
  })
}

/**
 * Check if an address is a Safe
 */
export function useIsSafe(address: Address | undefined) {
  return useQuery({
    queryKey: ['safe', 'is-safe', address],
    queryFn: async () => {
      if (!address) return false
      try {
        await fetchSafeInfo(address)
        return true
      } catch {
        return false
      }
    },
    enabled: !!address,
    staleTime: 60_000, // 1 minute
  })
}

/**
 * Fetch Safe transactions (pending or history)
 */
export function useSafeTransactions(
  address: Address | undefined,
  executed = false,
) {
  return useQuery({
    queryKey: [
      'safe',
      'transactions',
      address,
      executed ? 'history' : 'pending',
    ],
    queryFn: () => {
      if (!address) throw new Error('No address provided')
      return executed
        ? fetchTransactionHistory(address)
        : fetchPendingTransactions(address)
    },
    enabled: !!address,
    staleTime: 10_000, // 10 seconds
    refetchInterval: executed ? false : 30_000, // Auto-refresh pending every 30s
  })
}

/**
 * Fetch a single Safe transaction by hash
 */
export function useSafeTransaction(safeTxHash: Hex | undefined) {
  return useQuery({
    queryKey: ['safe', 'transaction', safeTxHash],
    queryFn: () => {
      if (!safeTxHash) throw new Error('No transaction hash provided')
      return fetchTransaction(safeTxHash)
    },
    enabled: !!safeTxHash,
    staleTime: 10_000,
  })
}

/**
 * Fetch transaction status
 */
export function useTransactionStatus(safeTxHash: Hex | undefined) {
  return useQuery({
    queryKey: ['safe', 'transaction', 'status', safeTxHash],
    queryFn: () => {
      if (!safeTxHash) throw new Error('No transaction hash provided')
      return fetchTransactionStatus(safeTxHash)
    },
    enabled: !!safeTxHash,
    staleTime: 5_000, // 5 seconds
    refetchInterval: 15_000, // Auto-refresh every 15s
  })
}

/**
 * Propose a new Safe transaction
 */
export function useProposeTransaction() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: proposeTransaction,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['safe', 'transactions', variables.safeAddress],
      })
    },
  })
}

/**
 * Confirm/sign a pending transaction
 */
export function useConfirmTransaction() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: confirmTransaction,
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({
        queryKey: ['safe', 'transaction', variables.safeTxHash],
      })
      queryClient.invalidateQueries({
        queryKey: ['safe', 'transactions'],
      })
    },
  })
}

/**
 * Build execute transaction data
 */
export function useBuildExecuteTransaction(safeTxHash: Hex | undefined) {
  return useQuery({
    queryKey: ['safe', 'execute', safeTxHash],
    queryFn: () => {
      if (!safeTxHash) throw new Error('No transaction hash provided')
      return buildExecuteTransaction(safeTxHash)
    },
    enabled: !!safeTxHash,
  })
}

/**
 * Propose treasury withdrawal
 */
export function useProposeTreasuryWithdraw() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: proposeTreasuryWithdraw,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['safe', 'transactions'] })
    },
  })
}

/**
 * Propose token transfer
 */
export function useProposeTokenTransfer() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: proposeTokenTransfer,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['safe', 'transactions'] })
    },
  })
}
