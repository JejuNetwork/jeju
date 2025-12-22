/**
 * @fileoverview Intent-based transaction hooks using OIF and React Query
 */

import { expectValid } from '@jejunetwork/types'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useCallback, useMemo, useState } from 'react'
import type { Hex } from 'viem'
import { useAccount, useChainId, usePublicClient, useWalletClient } from 'wagmi'
import { API_URLS, fetchApi } from '../lib/eden'
import { IntentHistoryResponseSchema } from '../schemas/api-responses'
import { chains } from '../sdk/chains'
import { OIFClient } from '../sdk/oif'
import type {
  Intent,
  IntentParams,
  IntentQuote,
  IntentStatus,
} from '../sdk/types'

export const intentQueryKeys = {
  all: ['intents'] as const,
  history: (address: string) =>
    [...intentQueryKeys.all, 'history', address] as const,
  quote: (params: IntentParams | null) =>
    [...intentQueryKeys.all, 'quote', params] as const,
}

export function useIntents() {
  const chainId = useChainId()
  const { address } = useAccount()
  const publicClient = usePublicClient()
  const { data: walletClient } = useWalletClient()
  const queryClient = useQueryClient()

  const [activeIntents, setActiveIntents] = useState<Intent[]>([])

  const oifClient = useMemo(() => {
    if (!publicClient) return null
    return new OIFClient({
      chainId,
      publicClient,
      walletClient: walletClient ?? undefined,
    })
  }, [chainId, publicClient, walletClient])

  // Quote mutation for getting intent quotes
  const quoteMutation = useMutation({
    mutationFn: async (params: IntentParams): Promise<IntentQuote> => {
      if (!oifClient) throw new Error('OIF client not ready')
      return oifClient.getQuote(params)
    },
  })

  // Create intent mutation
  const createMutation = useMutation({
    mutationFn: async (params: IntentParams) => {
      if (!oifClient || !walletClient || !address) {
        throw new Error('Wallet not connected')
      }
      return oifClient.createIntent(params)
    },
    onSuccess: (result, params) => {
      if (!address) return

      // Add to active intents
      const newIntent: Intent = {
        id: result.intentId,
        user: address,
        inputToken: params.inputToken,
        inputAmount: params.inputAmount,
        outputToken: params.outputToken,
        outputAmount: params.minOutputAmount,
        sourceChainId: chainId,
        destinationChainId: params.destinationChainId,
        recipient: params.recipient ?? address,
        maxFee: params.maxFee ?? 0n,
        openDeadline: 0,
        fillDeadline: 0,
        status: 'open',
        txHash: result.txHash,
        createdAt: Date.now(),
      }

      setActiveIntents((prev) => [newIntent, ...prev])

      // Watch for status changes
      oifClient?.watchIntent(result.intentId, (status) => {
        setActiveIntents((prev) =>
          prev.map((intent) =>
            intent.id === result.intentId ? { ...intent, status } : intent,
          ),
        )
      })

      // Invalidate history query
      queryClient.invalidateQueries({
        queryKey: intentQueryKeys.history(address),
      })
    },
  })

  // Refund intent mutation
  const refundMutation = useMutation({
    mutationFn: async (intentId: Hex) => {
      if (!oifClient || !walletClient) {
        throw new Error('Wallet not connected')
      }
      return oifClient.refundIntent(intentId)
    },
    onSuccess: (_, intentId) => {
      setActiveIntents((prev) =>
        prev.map((intent) =>
          intent.id === intentId
            ? { ...intent, status: 'refunded' as IntentStatus }
            : intent,
        ),
      )

      if (address) {
        queryClient.invalidateQueries({
          queryKey: intentQueryKeys.history(address),
        })
      }
    },
  })

  // Check if intent can be refunded
  const canRefund = useCallback(
    async (intentId: Hex): Promise<boolean> => {
      if (!oifClient) return false
      return oifClient.canRefund(intentId)
    },
    [oifClient],
  )

  // Get supported destination chains
  const destinationChains = useMemo(() => {
    return Object.values(chains)
      .filter((c) => c.id !== chainId && c.oifSupported)
      .map((c) => ({
        id: c.id,
        name: c.name,
        testnet: c.testnet ?? false,
      }))
  }, [chainId])

  return {
    activeIntents,
    isCreating: createMutation.isPending,
    error:
      createMutation.error?.message ?? refundMutation.error?.message ?? null,
    getQuote: quoteMutation.mutateAsync,
    createIntent: createMutation.mutateAsync,
    refundIntent: refundMutation.mutateAsync,
    canRefund,
    destinationChains,
    isReady: !!oifClient && !!walletClient,
  }
}

export function useIntentQuote(params: IntentParams | null) {
  const chainId = useChainId()
  const publicClient = usePublicClient()

  const oifClient = useMemo(() => {
    if (!publicClient) return null
    return new OIFClient({
      chainId,
      publicClient,
    })
  }, [chainId, publicClient])

  const {
    data: quote,
    isLoading,
    error,
  } = useQuery({
    queryKey: intentQueryKeys.quote(params),
    queryFn: async () => {
      if (!oifClient || !params) return null
      return oifClient.getQuote(params)
    },
    enabled: !!oifClient && !!params && params.inputAmount > 0n,
    staleTime: 30_000, // Quotes are fresh for 30 seconds
    refetchInterval: 30_000, // Refetch every 30 seconds
  })

  return {
    quote: quote ?? null,
    isLoading,
    error: error?.message ?? null,
  }
}

export function useIntentHistory() {
  const { address } = useAccount()

  const {
    data: intents = [],
    isLoading,
    refetch,
  } = useQuery({
    queryKey: intentQueryKeys.history(address ?? ''),
    queryFn: async () => {
      if (!address) return []

      const data = await fetchApi<{ intents?: Intent[] }>(
        API_URLS.gateway,
        `/oif/intents?user=${address}`,
      )

      const validated = expectValid(
        IntentHistoryResponseSchema,
        data,
        'intent history response',
      )
      return validated.intents ?? []
    },
    enabled: !!address,
    staleTime: 60_000, // Cache for 1 minute
    retry: 1, // Only retry once - history is non-critical
  })

  return {
    intents,
    isLoading,
    refetch,
  }
}
