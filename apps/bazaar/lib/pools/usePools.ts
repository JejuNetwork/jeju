import { useReadContracts, useWriteContract } from 'wagmi'
import { AddressSchema } from '@jejunetwork/types/contracts'
import { expect } from '@/lib/validation'
import { getV4Contracts } from '@/config/contracts'
import { JEJU_CHAIN_ID } from '@/config/chains'
import PoolManagerABI from '../abis/PoolManager.json'
import { Pool, PoolKey, CreatePoolParams } from './types'
import { computePoolId, validatePoolKey } from './utils'
import type { Abi } from 'viem'

const POOL_MANAGER_ABI = PoolManagerABI as Abi

export function usePool(poolKey: PoolKey | null) {
  const contracts = getV4Contracts(JEJU_CHAIN_ID)
  const poolId = poolKey ? computePoolId(poolKey) : null

  const { data, isLoading, error, refetch } = useReadContracts({
    contracts: poolId
      ? [
          {
            address: contracts.poolManager,
            abi: POOL_MANAGER_ABI,
            functionName: 'getSlot0',
            args: [poolId],
          },
          {
            address: contracts.poolManager,
            abi: POOL_MANAGER_ABI,
            functionName: 'getLiquidity',
            args: [poolId],
          },
        ]
      : [],
    query: { enabled: !!poolId },
  })

  if (!poolKey || !poolId || !data) {
    return { pool: null, isLoading, error, refetch }
  }

  const [slot0Data, liquidityData] = data

  if (!slot0Data || !liquidityData || slot0Data.status !== 'success' || liquidityData.status !== 'success') {
    return { pool: null, isLoading, error: error || new Error('Failed to fetch pool data'), refetch }
  }
  
  const validatedPoolKey = expect(poolKey, 'Pool key is required');
  const validatedPoolId = expect(poolId, 'Pool ID is required');

  const [sqrtPriceX96, tick, protocolFee, lpFee] = slot0Data.result as [bigint, number, number, number]
  const liquidity = liquidityData.result as bigint

  const pool: Pool = {
    id: validatedPoolId,
    key: validatedPoolKey,
    slot0: {
      sqrtPriceX96,
      tick,
      protocolFee,
      lpFee,
    },
    liquidity,
  }

  return { pool, isLoading, error, refetch }
}

export function useCreatePool() {
  const contracts = getV4Contracts(JEJU_CHAIN_ID)

  const {
    writeContractAsync: initializePool,
    data: txHash,
    isPending,
    isSuccess,
    error,
  } = useWriteContract()

  const createPool = async (params: CreatePoolParams): Promise<`0x${string}`> => {
    const poolKey: PoolKey = {
      currency0: params.token0,
      currency1: params.token1,
      fee: params.fee,
      tickSpacing: params.tickSpacing,
      hooks: params.hooks || '0x0000000000000000000000000000000000000000',
    }

    validatePoolKey(poolKey)

    const validatedPoolManager = expect(contracts.poolManager, 'Pool manager contract not deployed');
    AddressSchema.parse(validatedPoolManager);

    const hash = await initializePool({
      address: validatedPoolManager,
      abi: POOL_MANAGER_ABI,
      functionName: 'initialize',
      args: [poolKey, params.sqrtPriceX96, '0x'],
    })
    return expect(hash, 'Transaction failed - no hash returned') as `0x${string}`
  }

  return {
    createPool,
    isLoading: isPending,
    isSuccess,
    error,
    txHash,
  }
}

export function useWatchPoolCreated(_onPoolCreated?: (poolId: string, key: PoolKey) => void) {
  return {}
}

export function usePools(poolKeys: PoolKey[]) {
  const contracts = getV4Contracts(JEJU_CHAIN_ID)

  const contractReads = poolKeys.flatMap((key) => {
    const poolId = computePoolId(key)
    return [
      {
        address: contracts.poolManager,
        abi: POOL_MANAGER_ABI,
        functionName: 'getSlot0',
        args: [poolId],
      },
      {
        address: contracts.poolManager,
        abi: POOL_MANAGER_ABI,
        functionName: 'getLiquidity',
        args: [poolId],
      },
    ]
  })

  const { data, isLoading, error, refetch } = useReadContracts({
    contracts: contractReads,
    query: { enabled: poolKeys.length > 0 },
  })

  if (!data || data.length === 0) {
    return { pools: [], isLoading, error, refetch }
  }

  const pools: Pool[] = poolKeys
    .map((key, index) => {
      const slot0Data = data[index * 2]
      const liquidityData = data[index * 2 + 1]

      if (!slot0Data || !liquidityData || slot0Data.status !== 'success' || liquidityData.status !== 'success') {
        return null
      }

      const [sqrtPriceX96, tick, protocolFee, lpFee] = slot0Data.result as [bigint, number, number, number]
      const liquidity = liquidityData.result as bigint

      const pool: Pool = {
        id: computePoolId(key),
        key,
        slot0: {
          sqrtPriceX96,
          tick,
          protocolFee,
          lpFee,
        },
        liquidity,
      }
      return pool
    })
    .filter((pool) => pool !== null) as Pool[]

  return { pools, isLoading, error, refetch }
}

