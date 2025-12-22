import type {
  CrossChainQuote,
  IntentStatus,
  SupportedChain,
  TransferParams,
} from '@jejunetwork/sdk'
import { useCallback } from 'react'
import type { Hex } from 'viem'
import { useNetworkContext } from '../context'
import { type AsyncState, requireClient, useAsyncState } from './utils'

export interface UseCrossChainResult extends AsyncState {
  getQuote: (params: TransferParams) => Promise<CrossChainQuote>
  getQuotes: (params: TransferParams) => Promise<CrossChainQuote[]>
  transfer: (quote: CrossChainQuote) => Promise<Hex>
  listMyIntents: () => Promise<IntentStatus[]>
  getSupportedChains: () => SupportedChain[]
}

export function useCrossChain(): UseCrossChainResult {
  const { client } = useNetworkContext()
  const { isLoading, error, execute } = useAsyncState()

  const getQuote = useCallback(
    async (params: TransferParams): Promise<CrossChainQuote> => {
      const c = requireClient(client)
      return c.crosschain.getQuote(params)
    },
    [client],
  )

  const getQuotes = useCallback(
    async (params: TransferParams): Promise<CrossChainQuote[]> => {
      const c = requireClient(client)
      return c.crosschain.getQuotes(params)
    },
    [client],
  )

  const transfer = useCallback(
    async (quote: CrossChainQuote): Promise<Hex> => {
      const c = requireClient(client)
      return execute(() => c.crosschain.transfer(quote))
    },
    [client, execute],
  )

  const listMyIntents = useCallback(async (): Promise<IntentStatus[]> => {
    const c = requireClient(client)
    return c.crosschain.listMyIntents()
  }, [client])

  const getSupportedChains = useCallback((): SupportedChain[] => {
    const c = requireClient(client)
    return c.crosschain.getSupportedChains()
  }, [client])

  return {
    isLoading,
    error,
    getQuote,
    getQuotes,
    transfer,
    listMyIntents,
    getSupportedChains,
  }
}
