'use client'

/**
 * OIF (Open Intent Framework) Hook
 * For cross-chain swap intents
 */

import { useCallback, useState } from 'react'
import type { Address } from 'viem'
import { useAccount } from 'wagmi'
import { OIF_AGGREGATOR_URL } from '@/config'
import { OIF_INPUT_SETTLERS, OIF_SUPPORTED_CHAINS } from '@/config/chains'

export interface SwapQuote {
  amountOut: bigint
  route: Address[]
  priceImpact: number
  estimatedGas: bigint
  estimatedTime: number
}

export interface SwapParams {
  tokenIn: Address
  tokenOut: Address
  amountIn: bigint
  minAmountOut: bigint
  recipient?: Address
  deadline: number
}

export interface OIFConfig {
  inputSettlers: Record<number, Address>
  supportedChains: typeof OIF_SUPPORTED_CHAINS
}

export function useOIFConfig(): OIFConfig {
  return {
    inputSettlers: OIF_INPUT_SETTLERS,
    supportedChains: OIF_SUPPORTED_CHAINS,
  }
}

export function useOIF() {
  const { chain } = useAccount()
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const getQuote = useCallback(
    async (
      tokenIn: Address,
      tokenOut: Address,
      amountIn: bigint,
      destinationChainId?: number,
    ): Promise<SwapQuote | null> => {
      setIsLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams({
          tokenIn,
          tokenOut,
          amountIn: amountIn.toString(),
          sourceChain: (chain?.id || 420690).toString(),
          ...(destinationChainId && {
            destinationChain: destinationChainId.toString(),
          }),
        })

        const response = await fetch(`${OIF_AGGREGATOR_URL}/quote?${params}`)
        if (!response.ok) {
          throw new Error('Failed to get quote')
        }

        const data = await response.json()
        return {
          amountOut: BigInt(data.amountOut),
          route: data.route,
          priceImpact: data.priceImpact,
          estimatedGas: BigInt(data.estimatedGas || '0'),
          estimatedTime: data.estimatedTime || 0,
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Unknown error')
        return null
      } finally {
        setIsLoading(false)
      }
    },
    [chain?.id],
  )

  const getSupportedChains = useCallback(() => {
    return OIF_SUPPORTED_CHAINS
  }, [])

  return {
    getQuote,
    getSupportedChains,
    isLoading,
    error,
    currentChainId: chain?.id,
  }
}

export function useOIFChains() {
  return {
    chains: OIF_SUPPORTED_CHAINS,
    getChainById: (id: number) => OIF_SUPPORTED_CHAINS.find((c) => c.id === id),
  }
}
