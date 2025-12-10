import { useReadContract, useWriteContract, useAccount, useReadContracts } from 'wagmi'
import { getXLPContracts } from '@/config/contracts'
import { JEJU_CHAIN_ID } from '@/config/chains'
import type { Address, Abi } from 'viem'

// XLP V3 Factory ABI (minimal)
const V3_FACTORY_ABI: Abi = [
  {
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'fee', type: 'uint24' },
    ],
    name: 'getPool',
    outputs: [{ name: 'pool', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'fee', type: 'uint24' },
    ],
    name: 'createPool',
    outputs: [{ name: 'pool', type: 'address' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'fee', type: 'uint24' }],
    name: 'feeAmountTickSpacing',
    outputs: [{ name: '', type: 'int24' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'allPoolsLength',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
]

// XLP V3 Pool ABI (minimal)
const V3_POOL_ABI: Abi = [
  {
    inputs: [],
    name: 'slot0',
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'liquidity',
    outputs: [{ name: '', type: 'uint128' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'token0',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'token1',
    outputs: [{ name: '', type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'fee',
    outputs: [{ name: '', type: 'uint24' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'tickSpacing',
    outputs: [{ name: '', type: 'int24' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'sqrtPriceX96', type: 'uint160' }],
    name: 'initialize',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
]

// XLP V3 Position Manager ABI (minimal)
const POSITION_MANAGER_ABI: Abi = [
  {
    inputs: [{ name: 'tokenId', type: 'uint256' }],
    name: 'positions',
    outputs: [
      { name: 'nonce', type: 'uint96' },
      { name: 'operator', type: 'address' },
      { name: 'token0', type: 'address' },
      { name: 'token1', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'tickLower', type: 'int24' },
      { name: 'tickUpper', type: 'int24' },
      { name: 'liquidity', type: 'uint128' },
      { name: 'feeGrowthInside0LastX128', type: 'uint256' },
      { name: 'feeGrowthInside1LastX128', type: 'uint256' },
      { name: 'tokensOwed0', type: 'uint128' },
      { name: 'tokensOwed1', type: 'uint128' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'index', type: 'uint256' },
    ],
    name: 'tokenOfOwnerByIndex',
    outputs: [{ name: '', type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
]

// Fee tiers available in V3
export const V3_FEE_TIERS = {
  LOWEST: 500,   // 0.05%
  LOW: 3000,     // 0.3%
  HIGH: 10000,   // 1%
} as const

export interface V3Pool {
  address: Address
  token0: Address
  token1: Address
  fee: number
  tickSpacing: number
  sqrtPriceX96: bigint
  tick: number
  liquidity: bigint
}

export interface V3Position {
  tokenId: bigint
  token0: Address
  token1: Address
  fee: number
  tickLower: number
  tickUpper: number
  liquidity: bigint
  tokensOwed0: bigint
  tokensOwed1: bigint
}

// Get pool address for token pair and fee
export function useV3Pool(token0: Address | null, token1: Address | null, fee: number | null) {
  const contracts = getXLPContracts(JEJU_CHAIN_ID)

  const { data: poolAddress, isLoading, error, refetch } = useReadContract({
    address: contracts?.v3Factory,
    abi: V3_FACTORY_ABI,
    functionName: 'getPool',
    args: token0 && token1 && fee ? [token0, token1, fee] : undefined,
    query: { enabled: !!token0 && !!token1 && fee !== null && !!contracts?.v3Factory },
  })

  return {
    poolAddress: poolAddress as Address | undefined,
    isLoading,
    error,
    refetch,
  }
}

// Get full pool data
export function useV3PoolData(poolAddress: Address | null) {
  const { data, isLoading, error, refetch } = useReadContracts({
    contracts: poolAddress
      ? [
          { address: poolAddress, abi: V3_POOL_ABI, functionName: 'slot0' },
          { address: poolAddress, abi: V3_POOL_ABI, functionName: 'liquidity' },
          { address: poolAddress, abi: V3_POOL_ABI, functionName: 'token0' },
          { address: poolAddress, abi: V3_POOL_ABI, functionName: 'token1' },
          { address: poolAddress, abi: V3_POOL_ABI, functionName: 'fee' },
          { address: poolAddress, abi: V3_POOL_ABI, functionName: 'tickSpacing' },
        ]
      : [],
    query: { enabled: !!poolAddress },
  })

  if (!data || !poolAddress) {
    return { pool: null, isLoading, error, refetch }
  }

  const slot0Result = data[0]
  const liquidityResult = data[1]
  const token0Result = data[2]
  const token1Result = data[3]
  const feeResult = data[4]
  const tickSpacingResult = data[5]

  if (
    !slot0Result || slot0Result.status !== 'success' ||
    !liquidityResult || liquidityResult.status !== 'success' ||
    !token0Result || token0Result.status !== 'success' ||
    !token1Result || token1Result.status !== 'success' ||
    !feeResult || feeResult.status !== 'success' ||
    !tickSpacingResult || tickSpacingResult.status !== 'success'
  ) {
    return { pool: null, isLoading, error, refetch }
  }

  const [sqrtPriceX96, tick] = slot0Result.result as [bigint, number, number, number, number, number, boolean]

  const pool: V3Pool = {
    address: poolAddress,
    token0: token0Result.result as Address,
    token1: token1Result.result as Address,
    fee: feeResult.result as number,
    tickSpacing: tickSpacingResult.result as number,
    sqrtPriceX96,
    tick,
    liquidity: liquidityResult.result as bigint,
  }

  return { pool, isLoading, error, refetch }
}

// Create new V3 pool
export function useCreateV3Pool() {
  const contracts = getXLPContracts(JEJU_CHAIN_ID)

  const { writeContractAsync, isPending, isSuccess, error, data: txHash } = useWriteContract()

  const createPool = async (token0: Address, token1: Address, fee: number) => {
    if (!contracts?.v3Factory) throw new Error('V3 Factory not deployed')

    const hash = await writeContractAsync({
      address: contracts.v3Factory,
      abi: V3_FACTORY_ABI,
      functionName: 'createPool',
      args: [token0, token1, fee],
    })
    return hash
  }

  return { createPool, isLoading: isPending, isSuccess, error, txHash }
}

// Initialize V3 pool with starting price
export function useInitializeV3Pool() {
  const { writeContractAsync, isPending, isSuccess, error, data: txHash } = useWriteContract()

  const initialize = async (poolAddress: Address, sqrtPriceX96: bigint) => {
    const hash = await writeContractAsync({
      address: poolAddress,
      abi: V3_POOL_ABI,
      functionName: 'initialize',
      args: [sqrtPriceX96],
    })
    return hash
  }

  return { initialize, isLoading: isPending, isSuccess, error, txHash }
}

// Get user's V3 positions
export function useV3Positions() {
  const { address } = useAccount()
  const contracts = getXLPContracts(JEJU_CHAIN_ID)

  // Get position count
  const { data: positionCount } = useReadContract({
    address: contracts?.positionManager,
    abi: POSITION_MANAGER_ABI,
    functionName: 'balanceOf',
    args: address ? [address] : undefined,
    query: { enabled: !!address && !!contracts?.positionManager },
  })

  const count = Number(positionCount || 0)
  const indices = Array.from({ length: count }, (_, i) => i)

  // Get token IDs
  const { data: tokenIds } = useReadContracts({
    contracts: indices.map((i) => ({
      address: contracts?.positionManager,
      abi: POSITION_MANAGER_ABI,
      functionName: 'tokenOfOwnerByIndex',
      args: [address, BigInt(i)],
    })),
    query: { enabled: count > 0 && !!contracts?.positionManager },
  })

  const validTokenIds = (tokenIds || [])
    .filter((r) => r.status === 'success')
    .map((r) => r.result as bigint)

  // Get position data for each token ID
  const { data: positionsData, isLoading, error, refetch } = useReadContracts({
    contracts: validTokenIds.map((tokenId) => ({
      address: contracts?.positionManager,
      abi: POSITION_MANAGER_ABI,
      functionName: 'positions',
      args: [tokenId],
    })),
    query: { enabled: validTokenIds.length > 0 && !!contracts?.positionManager },
  })

  const positions: V3Position[] = (positionsData || [])
    .map((result, i) => {
      if (result.status !== 'success') return null
      const [
        ,, // nonce, operator
        token0,
        token1,
        fee,
        tickLower,
        tickUpper,
        liquidity,
        ,, // feeGrowthInside0LastX128, feeGrowthInside1LastX128
        tokensOwed0,
        tokensOwed1,
      ] = result.result as [
        bigint, Address, Address, Address, number, number, number, bigint, bigint, bigint, bigint, bigint
      ]

      return {
        tokenId: validTokenIds[i],
        token0,
        token1,
        fee,
        tickLower,
        tickUpper,
        liquidity,
        tokensOwed0,
        tokensOwed1,
      }
    })
    .filter((p): p is V3Position => p !== null)

  return { positions, isLoading, error, refetch }
}

// Calculate sqrt price from decimal price
export function priceToSqrtPriceX96(price: number): bigint {
  const sqrtPrice = Math.sqrt(price)
  const Q96 = 2n ** 96n
  return BigInt(Math.floor(sqrtPrice * Number(Q96)))
}

// Note: sqrtPriceX96ToPrice, priceToTick, and tickToPrice are exported from utils.ts
