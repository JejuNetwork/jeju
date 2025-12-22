import type { Address } from 'viem'

export interface PoolKey {
  currency0: Address
  currency1: Address
  fee: number
  tickSpacing: number
  hooks: Address
}

export interface PoolSlot0 {
  sqrtPriceX96: bigint
  tick: number
  protocolFee: number
  lpFee: number
}

export interface Pool {
  id: string
  key: PoolKey
  slot0: PoolSlot0
  liquidity: bigint
  token0Symbol?: string
  token1Symbol?: string
  volume24h?: string
  tvl?: string
}

export interface Position {
  tokenId: bigint
  poolId: string
  owner: Address
  tickLower: number
  tickUpper: number
  liquidity: bigint
  amount0?: bigint
  amount1?: bigint
  fees0?: bigint
  fees1?: bigint
}

export interface CreatePoolParams {
  token0: Address
  token1: Address
  fee: number
  tickSpacing: number
  hooks?: Address
  sqrtPriceX96: bigint
}

export interface AddLiquidityParams {
  poolKey: PoolKey
  tickLower: number
  tickUpper: number
  liquidity: bigint
  amount0Max: bigint
  amount1Max: bigint
  recipient: Address
  deadline: bigint
}

export interface RemoveLiquidityParams {
  tokenId: bigint
  liquidity: bigint
  amount0Min: bigint
  amount1Min: bigint
  deadline: bigint
}

export interface TokenInfo {
  address: Address
  symbol: string
  name: string
  decimals: number
  logoURI?: string
}
