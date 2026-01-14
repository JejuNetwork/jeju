/**
 * useCrossChain Hook
 *
 * Cross-chain swap functionality using OIF (Open Intents Framework).
 * Fetches quotes from the OIF aggregator which returns both EIL and OIF routes,
 * then executes the best route.
 *
 * This hook wraps the same API that @jejunetwork/sdk uses internally,
 * adapted for React/wagmi patterns.
 */

import { useCallback, useEffect, useRef, useState } from 'react'
import type { Address, Hex } from 'viem'
import { useAccount } from 'wagmi'
import { NETWORK, OIF_AGGREGATOR_URL } from '../config'

// ═══════════════════════════════════════════════════════════════════════════
// Types (matching SDK's crosschain module)
// ═══════════════════════════════════════════════════════════════════════════

export type SupportedChain =
  | 'jeju'
  | 'base'
  | 'optimism'
  | 'arbitrum'
  | 'ethereum'

export interface CrossChainQuote {
  quoteId: string
  sourceChain: SupportedChain
  destinationChain: SupportedChain
  sourceToken: Address
  destinationToken: Address
  amountIn: bigint
  amountOut: bigint
  fee: bigint
  feePercent: number
  estimatedTimeSeconds: number
  route: 'eil' | 'oif'
  solver?: Address
  xlp?: Address
  validUntil: number
}

export interface TransferParams {
  sourceChainId: number
  destinationChainId: number
  sourceToken: Address
  destinationToken: Address
  amount: bigint
  recipient?: Address
}

export interface IntentStatus {
  intentId: Hex
  status: 'open' | 'pending' | 'filled' | 'expired' | 'cancelled' | 'failed'
  solver?: Address
  fillTxHash?: Hex
  createdAt: number
  filledAt?: number
}

// Chain ID to name mapping
const CHAIN_ID_TO_NAME: Record<number, SupportedChain> = {
  420690: 'jeju',
  420691: 'jeju',
  31337: 'jeju',
  8453: 'base',
  10: 'optimism',
  42161: 'arbitrum',
  1: 'ethereum',
}

// ═══════════════════════════════════════════════════════════════════════════
// useCrossChainQuotes - Fetch quotes with debounce
// ═══════════════════════════════════════════════════════════════════════════

export function useCrossChainQuotes(params: TransferParams | null) {
  const { address: userAddress } = useAccount()
  const [quotes, setQuotes] = useState<CrossChainQuote[]>([])
  const [bestQuote, setBestQuote] = useState<CrossChainQuote | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Debounce ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fetchQuotes = useCallback(async () => {
    if (!params || !userAddress || !OIF_AGGREGATOR_URL) {
      setQuotes([])
      setBestQuote(null)
      return
    }

    // Skip if same chain
    if (params.sourceChainId === params.destinationChainId) {
      setQuotes([])
      setBestQuote(null)
      return
    }

    // Skip if amount is 0
    if (params.amount <= 0n) {
      setQuotes([])
      setBestQuote(null)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const sourceChain = CHAIN_ID_TO_NAME[params.sourceChainId]
      const destChain = CHAIN_ID_TO_NAME[params.destinationChainId]

      if (!sourceChain || !destChain) {
        throw new Error('Unsupported chain')
      }

      const response = await fetch(`${OIF_AGGREGATOR_URL}/quotes`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          sourceChain,
          destinationChain: destChain,
          token: params.sourceToken,
          amount: params.amount.toString(),
          recipient: params.recipient ?? userAddress,
        }),
      })

      if (!response.ok) {
        throw new Error(`Failed to fetch quotes: ${response.statusText}`)
      }

      const data = await response.json()
      const rawQuotes = data.quotes ?? []

      // Parse quotes
      const parsedQuotes: CrossChainQuote[] = rawQuotes.map(
        (q: {
          quoteId: string
          sourceChain: SupportedChain
          destinationChain: SupportedChain
          sourceToken: string
          destinationToken: string
          amountIn: string
          amountOut: string
          fee: string
          feePercent: number
          estimatedTimeSeconds: number
          route: 'eil' | 'oif'
          solver?: string
          xlp?: string
          validUntil: number
        }) => ({
          ...q,
          sourceToken: q.sourceToken as Address,
          destinationToken: q.destinationToken as Address,
          amountIn: BigInt(q.amountIn),
          amountOut: BigInt(q.amountOut),
          fee: BigInt(q.fee),
          solver: q.solver as Address | undefined,
          xlp: q.xlp as Address | undefined,
        }),
      )

      // Sort by best output amount
      parsedQuotes.sort((a, b) => {
        const diff = b.amountOut - a.amountOut
        if (diff !== 0n) return diff > 0n ? 1 : -1
        return a.estimatedTimeSeconds - b.estimatedTimeSeconds
      })

      setQuotes(parsedQuotes)
      setBestQuote(parsedQuotes[0] ?? null)
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to fetch quotes'
      setError(message)
      setQuotes([])
      setBestQuote(null)
    } finally {
      setIsLoading(false)
    }
  }, [params, userAddress])

  // Debounced fetch on params change
  useEffect(() => {
    if (debounceRef.current) {
      clearTimeout(debounceRef.current)
    }

    debounceRef.current = setTimeout(() => {
      fetchQuotes()
    }, 500)

    return () => {
      if (debounceRef.current) {
        clearTimeout(debounceRef.current)
      }
    }
  }, [fetchQuotes])

  const refetch = useCallback(() => {
    fetchQuotes()
  }, [fetchQuotes])

  return {
    quotes,
    bestQuote,
    isLoading,
    error,
    refetch,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// useCrossChainTransfer - Execute transfer and track status
// ═══════════════════════════════════════════════════════════════════════════

export function useCrossChainTransfer() {
  const { address: userAddress } = useAccount()
  const [status, setStatus] = useState<
    | 'idle'
    | 'preparing'
    | 'signing'
    | 'pending'
    | 'tracking'
    | 'complete'
    | 'error'
  >('idle')
  const [error, setError] = useState<string | null>(null)
  const [txData, setTxData] = useState<{
    to: Address
    data: Hex
    value: bigint
  } | null>(null)
  const [intentId, setIntentId] = useState<Hex | null>(null)
  const [intentStatus, setIntentStatus] = useState<IntentStatus | null>(null)

  // Polling ref
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)

  // Prepare transfer - get transaction data from aggregator
  const prepareTransfer = useCallback(
    async (quote: CrossChainQuote) => {
      if (!userAddress || !OIF_AGGREGATOR_URL) {
        setError('Wallet not connected')
        return null
      }

      setStatus('preparing')
      setError(null)

      try {
        const endpoint =
          quote.route === 'eil'
            ? `${OIF_AGGREGATOR_URL}/eil/voucher`
            : `${OIF_AGGREGATOR_URL}/intents`

        const response = await fetch(endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-jeju-address': userAddress,
          },
          body: JSON.stringify({
            quoteId: quote.quoteId,
            // For OIF intents, include full params
            ...(quote.route === 'oif' && {
              sourceChain: quote.sourceChain,
              destinationChain: quote.destinationChain,
              inputs: [
                {
                  token: quote.sourceToken,
                  amount: quote.amountIn.toString(),
                },
              ],
              outputs: [
                {
                  token: quote.destinationToken,
                  amount: quote.amountOut.toString(),
                  recipient: userAddress,
                },
              ],
              deadline: quote.validUntil,
              nonce: Date.now().toString(),
            }),
          }),
        })

        if (!response.ok) {
          throw new Error(`Failed to prepare transfer: ${response.statusText}`)
        }

        const data = await response.json()

        const prepared = {
          to: data.to as Address,
          data: data.txData as Hex,
          value: BigInt(data.value ?? '0'),
        }

        setTxData(prepared)
        setStatus('signing')

        // If OIF, save intent ID for tracking
        if (quote.route === 'oif' && data.intentId) {
          setIntentId(data.intentId as Hex)
        }

        return prepared
      } catch (err) {
        const message =
          err instanceof Error ? err.message : 'Failed to prepare transfer'
        setError(message)
        setStatus('error')
        return null
      }
    },
    [userAddress],
  )

  // Track intent status (for OIF route)
  const trackIntent = useCallback(async (id: Hex) => {
    if (!OIF_AGGREGATOR_URL) return

    try {
      const response = await fetch(`${OIF_AGGREGATOR_URL}/intents/${id}`)
      if (!response.ok) return

      const data = await response.json()
      const newStatus: IntentStatus = {
        intentId: data.intentId as Hex,
        status: data.status,
        solver: data.solver as Address | undefined,
        fillTxHash: data.fillTxHash as Hex | undefined,
        createdAt: data.createdAt,
        filledAt: data.filledAt,
      }

      setIntentStatus(newStatus)

      // Stop polling if terminal state
      if (
        ['filled', 'expired', 'cancelled', 'failed'].includes(newStatus.status)
      ) {
        if (pollRef.current) {
          clearInterval(pollRef.current)
          pollRef.current = null
        }
        setStatus(newStatus.status === 'filled' ? 'complete' : 'error')
      }
    } catch {
      // Ignore polling errors
    }
  }, [])

  // Start tracking after transaction confirmed
  const startTracking = useCallback(
    (id: Hex) => {
      setStatus('tracking')
      setIntentId(id)

      // Poll every 3 seconds
      pollRef.current = setInterval(() => {
        trackIntent(id)
      }, 3000)

      // Initial fetch
      trackIntent(id)
    },
    [trackIntent],
  )

  // Mark transaction as submitted (called after wagmi sendTransaction)
  const onTransactionSubmitted = useCallback(
    (_txHash: Hex) => {
      setStatus('pending')

      // For OIF, start tracking intent
      if (intentId) {
        // Wait a bit for the transaction to be indexed
        setTimeout(() => {
          startTracking(intentId)
        }, 5000)
      } else {
        // EIL route - just wait for confirmation
        setStatus('complete')
      }
    },
    [intentId, startTracking],
  )

  const reset = useCallback(() => {
    if (pollRef.current) {
      clearInterval(pollRef.current)
      pollRef.current = null
    }
    setStatus('idle')
    setError(null)
    setTxData(null)
    setIntentId(null)
    setIntentStatus(null)
  }, [])

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current)
      }
    }
  }, [])

  return {
    status,
    error,
    txData,
    intentId,
    intentStatus,
    prepareTransfer,
    onTransactionSubmitted,
    reset,
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper: Check if cross-chain is supported
// ═══════════════════════════════════════════════════════════════════════════

export function useOIFAvailable() {
  const [isAvailable, setIsAvailable] = useState(false)

  useEffect(() => {
    async function check() {
      // Skip OIF check on localnet - aggregator is not available
      if (NETWORK === 'localnet') {
        setIsAvailable(false)
        return
      }

      if (!OIF_AGGREGATOR_URL) {
        setIsAvailable(false)
        return
      }

      // Only check OIF aggregator on testnet/mainnet
      try {
        const controller = new AbortController()
        const timeoutId = setTimeout(() => controller.abort(), 2000) // 2s timeout
        
        // Use fetch with proper error handling - don't let errors bubble to console
        const response = await fetch(`${OIF_AGGREGATOR_URL}/health`, {
          method: 'GET',
          signal: controller.signal,
          // Suppress error logging by catching all errors
        }).catch(() => {
          // Return null on any error (network, timeout, etc.)
          return null
        })
        
        clearTimeout(timeoutId)
        
        if (response && response.ok) {
          setIsAvailable(true)
        } else {
          setIsAvailable(false)
        }
      } catch {
        // Silently fail - OIF aggregator is optional
        setIsAvailable(false)
      }
    }

    check()
  }, [])

  return isAvailable
}

// ═══════════════════════════════════════════════════════════════════════════
// Helper: Chain utilities
// ═══════════════════════════════════════════════════════════════════════════

export function getChainName(chainId: number): SupportedChain | undefined {
  return CHAIN_ID_TO_NAME[chainId]
}

export function isCrossChainSupported(
  sourceChainId: number,
  destChainId: number,
): boolean {
  return (
    sourceChainId !== destChainId &&
    CHAIN_ID_TO_NAME[sourceChainId] !== undefined &&
    CHAIN_ID_TO_NAME[destChainId] !== undefined
  )
}
