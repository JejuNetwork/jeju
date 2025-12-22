import type {
  AddLiquidityParams,
  LiquidityPosition,
  PoolInfo,
  SwapParams,
  SwapQuote,
} from '@jejunetwork/sdk'
import { useCallback } from 'react'
import type { Address, Hex } from 'viem'
import { useNetworkContext } from '../context'
import { type AsyncState, requireClient, useAsyncState } from './utils'

export interface UseDefiResult extends AsyncState {
  getSwapQuote: (params: SwapParams) => Promise<SwapQuote>
  swap: (quote: SwapQuote) => Promise<Hex>
  listPools: () => Promise<PoolInfo[]>
  addLiquidity: (params: AddLiquidityParams) => Promise<Hex>
  listPositions: () => Promise<LiquidityPosition[]>
  collectFees: (positionId: bigint) => Promise<Hex>
  getBalance: (token: Address) => Promise<bigint>
}

export function useDefi(): UseDefiResult {
  const { client } = useNetworkContext()
  const { isLoading, error, execute } = useAsyncState()

  const getSwapQuote = useCallback(
    async (params: SwapParams): Promise<SwapQuote> => {
      const c = requireClient(client)
      return c.defi.getSwapQuote(params)
    },
    [client],
  )

  const swap = useCallback(
    async (quote: SwapQuote): Promise<Hex> => {
      const c = requireClient(client)
      return execute(() => c.defi.swap(quote))
    },
    [client, execute],
  )

  const listPools = useCallback(async (): Promise<PoolInfo[]> => {
    const c = requireClient(client)
    return c.defi.listPools()
  }, [client])

  const addLiquidity = useCallback(
    async (params: AddLiquidityParams): Promise<Hex> => {
      const c = requireClient(client)
      return execute(() => c.defi.addLiquidity(params))
    },
    [client, execute],
  )

  const listPositions = useCallback(async (): Promise<LiquidityPosition[]> => {
    const c = requireClient(client)
    return c.defi.listPositions()
  }, [client])

  const collectFees = useCallback(
    async (positionId: bigint): Promise<Hex> => {
      const c = requireClient(client)
      return c.defi.collectFees(positionId)
    },
    [client],
  )

  const getBalance = useCallback(
    async (token: Address): Promise<bigint> => {
      const c = requireClient(client)
      return c.defi.getBalance(token)
    },
    [client],
  )

  return {
    isLoading,
    error,
    getSwapQuote,
    swap,
    listPools,
    addLiquidity,
    listPositions,
    collectFees,
    getBalance,
  }
}
