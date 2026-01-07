/**
 * useSwapQuotes Hook
 *
 * React hook for fetching swap quotes using the SDK.
 * Supports both same-chain and cross-chain quotes with debouncing.
 */

import type {
  CrossChainQuote,
  SupportedChain,
  TransferParams,
} from '@jejunetwork/sdk'
import type { SwapQuote } from '@jejunetwork/types'
import { useCallback, useEffect, useRef, useState } from 'react'
import type { Address } from 'viem'
import { useAccount } from 'wagmi'
import { useNetworkContext } from '../context'
import { type AsyncState, requireClient, useAsyncState } from './utils'

// ═══════════════════════════════════════════════════════════════════════════
// Types (re-export SDK types for convenience)
// ═══════════════════════════════════════════════════════════════════════════

export type { CrossChainQuote, SupportedChain, SwapQuote, TransferParams }

/** Parameters for swap quote request */
export interface SwapQuoteParams {
  tokenIn: Address
  tokenOut: Address
  amountIn: bigint
  sourceChain?: SupportedChain
  destinationChain?: SupportedChain
  recipient?: Address
  slippageBps?: number
}

/** Hook result - quotes are either cross-chain or same-chain */
export interface UseSwapQuotesResult extends AsyncState {
  /** Cross-chain quotes (when isCrossChain is true) */
  crossChainQuotes: CrossChainQuote[]
  /** Same-chain quote (when isCrossChain is false) */
  swapQuote: SwapQuote | null
  /** Best cross-chain quote */
  bestCrossChainQuote: CrossChainQuote | null
  /** Whether this is a cross-chain swap */
  isCrossChain: boolean
  /** Refetch quotes */
  refetch: () => void
}

// ═══════════════════════════════════════════════════════════════════════════
// Hook Implementation
// ═══════════════════════════════════════════════════════════════════════════

export function useSwapQuotes(params: SwapQuoteParams | null): UseSwapQuotesResult {
  const { client } = useNetworkContext()
  const { address: userAddress } = useAccount()
  const { isLoading, error, execute } = useAsyncState()

  // State - separate types for different quote types
  const [crossChainQuotes, setCrossChainQuotes] = useState<CrossChainQuote[]>([])
  const [swapQuote, setSwapQuote] = useState<SwapQuote | null>(null)

  // Debounce ref
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Check if cross-chain
  const isCrossChain = Boolean(
    params &&
      params.sourceChain &&
      params.destinationChain &&
      params.sourceChain !== params.destinationChain,
  )

  // Fetch quotes using SDK
  const fetchQuotes = useCallback(async () => {
    if (!params || !userAddress || !client) {
      setCrossChainQuotes([])
      setSwapQuote(null)
      return
    }

    // Skip if amount is 0
    if (params.amountIn <= 0n) {
      setCrossChainQuotes([])
      setSwapQuote(null)
      return
    }

    // Skip if same token
    if (params.tokenIn.toLowerCase() === params.tokenOut.toLowerCase()) {
      setCrossChainQuotes([])
      setSwapQuote(null)
      return
    }

    try {
      const c = requireClient(client)

      if (isCrossChain && params.sourceChain && params.destinationChain) {
        // Use crosschain module for cross-chain quotes
        const transferParams: TransferParams = {
          from: params.sourceChain,
          to: params.destinationChain,
          token: params.tokenIn,
          amount: params.amountIn,
          recipient: params.recipient ?? userAddress,
        }

        const result = await execute(() => c.crosschain.getQuotes(transferParams))
        if (result) {
          setCrossChainQuotes(result)
          setSwapQuote(null)
        }
      } else {
        // Use defi module for same-chain swaps
        const swapParams = {
          tokenIn: params.tokenIn,
          tokenOut: params.tokenOut,
          amountIn: params.amountIn,
          slippage: params.slippageBps ? params.slippageBps / 10000 : 0.005, // Default 0.5%
        }

        const result = await execute(() => c.defi.getSwapQuote(swapParams))
        if (result) {
          setCrossChainQuotes([])
          setSwapQuote(result)
        }
      }
    } catch {
      setCrossChainQuotes([])
      setSwapQuote(null)
    }
  }, [params, userAddress, client, isCrossChain, execute])

  // Debounced fetch
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
    crossChainQuotes,
    swapQuote,
    bestCrossChainQuote: crossChainQuotes[0] ?? null,
    isLoading,
    error,
    isCrossChain,
    refetch,
  }
}
