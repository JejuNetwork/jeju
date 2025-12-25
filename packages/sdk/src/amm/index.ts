/**
 * AMM Module - Automated Market Maker / DEX
 *
 * Provides access to:
 * - V2 constant product swaps
 * - V3 concentrated liquidity swaps
 * - Liquidity provision
 * - Price quotes
 * - Pool management
 */

import type { NetworkType } from '@jejunetwork/types'
import { type Address, encodeFunctionData, type Hex, parseEther } from 'viem'
import { requireContract, safeGetContract } from '../config'
import type { JejuWallet } from '../wallet'

// ═══════════════════════════════════════════════════════════════════════════
//                              TYPES
// ═══════════════════════════════════════════════════════════════════════════

export const PoolType = {
  V2: 0,
  V3: 1,
} as const
export type PoolType = (typeof PoolType)[keyof typeof PoolType]

export interface V2Pool {
  pairAddress: Address
  token0: Address
  token1: Address
  reserve0: bigint
  reserve1: bigint
  totalSupply: bigint
  kLast: bigint
}

export interface V3Pool {
  poolAddress: Address
  token0: Address
  token1: Address
  fee: number
  tickSpacing: number
  liquidity: bigint
  sqrtPriceX96: bigint
  tick: number
}

export interface AMMSwapQuote {
  amountOut: bigint
  poolType: PoolType
  fee: number
  priceImpact: number
  path: Address[]
}

export interface SwapV2Params {
  tokenIn: Address
  tokenOut: Address
  amountIn: bigint
  amountOutMin: bigint
  recipient?: Address
  deadline?: bigint
}

export interface SwapV3Params {
  tokenIn: Address
  tokenOut: Address
  fee: number
  amountIn: bigint
  amountOutMin: bigint
  recipient?: Address
  deadline?: bigint
  sqrtPriceLimitX96?: bigint
}

export interface AddLiquidityV2Params {
  tokenA: Address
  tokenB: Address
  amountADesired: bigint
  amountBDesired: bigint
  amountAMin: bigint
  amountBMin: bigint
  recipient?: Address
  deadline?: bigint
}

export interface AddLiquidityV3Params {
  token0: Address
  token1: Address
  fee: number
  tickLower: number
  tickUpper: number
  amount0Desired: bigint
  amount1Desired: bigint
  amount0Min: bigint
  amount1Min: bigint
  recipient?: Address
  deadline?: bigint
}

export interface RemoveLiquidityV2Params {
  tokenA: Address
  tokenB: Address
  liquidity: bigint
  amountAMin: bigint
  amountBMin: bigint
  recipient?: Address
  deadline?: bigint
}

export interface AMMPosition {
  positionId: bigint
  owner: Address
  token0: Address
  token1: Address
  fee: number
  tickLower: number
  tickUpper: number
  liquidity: bigint
  feeGrowthInside0LastX128: bigint
  feeGrowthInside1LastX128: bigint
  tokensOwed0: bigint
  tokensOwed1: bigint
}

export interface AMMModule {
  // Quotes
  getQuote(
    tokenIn: Address,
    tokenOut: Address,
    amountIn: bigint,
  ): Promise<AMMSwapQuote>
  getAmountsOutV2(amountIn: bigint, path: Address[]): Promise<bigint[]>
  getAmountsInV2(amountOut: bigint, path: Address[]): Promise<bigint[]>

  // V2 Swaps
  swapExactTokensForTokensV2(params: SwapV2Params): Promise<Hex>
  swapTokensForExactTokensV2(
    params: Omit<SwapV2Params, 'amountOutMin'> & {
      amountOut: bigint
      amountInMax: bigint
    },
  ): Promise<Hex>
  swapExactETHForTokensV2(params: Omit<SwapV2Params, 'tokenIn'>): Promise<Hex>
  swapExactTokensForETHV2(params: Omit<SwapV2Params, 'tokenOut'>): Promise<Hex>

  // V3 Swaps
  exactInputSingleV3(params: SwapV3Params): Promise<Hex>
  exactOutputSingleV3(
    params: Omit<SwapV3Params, 'amountOutMin'> & {
      amountOut: bigint
      amountInMax: bigint
    },
  ): Promise<Hex>

  // Liquidity V2
  addLiquidityV2(
    params: AddLiquidityV2Params,
  ): Promise<{ txHash: Hex; liquidity: bigint }>
  removeLiquidityV2(
    params: RemoveLiquidityV2Params,
  ): Promise<{ txHash: Hex; amountA: bigint; amountB: bigint }>
  addLiquidityETHV2(
    params: Omit<AddLiquidityV2Params, 'tokenB'> & { ethAmount: bigint },
  ): Promise<{ txHash: Hex; liquidity: bigint }>

  // Liquidity V3
  addLiquidityV3(
    params: AddLiquidityV3Params,
  ): Promise<{ txHash: Hex; tokenId: bigint; liquidity: bigint }>
  increaseLiquidityV3(
    tokenId: bigint,
    amount0Desired: bigint,
    amount1Desired: bigint,
  ): Promise<Hex>
  decreaseLiquidityV3(tokenId: bigint, liquidity: bigint): Promise<Hex>
  collectFeesV3(
    tokenId: bigint,
  ): Promise<{ txHash: Hex; amount0: bigint; amount1: bigint }>

  // Pool Info
  getV2Pool(tokenA: Address, tokenB: Address): Promise<V2Pool | null>
  getV3Pool(
    tokenA: Address,
    tokenB: Address,
    fee: number,
  ): Promise<V3Pool | null>
  getV3Position(tokenId: bigint): Promise<AMMPosition | null>
  getMyV3Positions(): Promise<AMMPosition[]>

  // Price
  getSpotPrice(tokenIn: Address, tokenOut: Address): Promise<bigint>

  // Factory
  createV2Pool(
    tokenA: Address,
    tokenB: Address,
  ): Promise<{ txHash: Hex; pairAddress: Address }>
  createV3Pool(
    tokenA: Address,
    tokenB: Address,
    fee: number,
  ): Promise<{ txHash: Hex; poolAddress: Address }>
}

// ═══════════════════════════════════════════════════════════════════════════
//                              ABIs
// ═══════════════════════════════════════════════════════════════════════════

const XLP_ROUTER_ABI = [
  {
    name: 'swapExactTokensForTokensV2',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256[]' }],
  },
  {
    name: 'swapTokensForExactTokensV2',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'amountInMax', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256[]' }],
  },
  {
    name: 'swapExactETHForTokensV2',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256[]' }],
  },
  {
    name: 'swapExactTokensForETHV2',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMin', type: 'uint256' },
      { name: 'path', type: 'address[]' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256[]' }],
  },
  {
    name: 'exactInputSingleV3',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'recipient', type: 'address' },
      { name: 'deadline', type: 'uint256' },
      { name: 'amountIn', type: 'uint256' },
      { name: 'amountOutMinimum', type: 'uint256' },
      { name: 'sqrtPriceLimitX96', type: 'uint160' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'exactOutputSingleV3',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'fee', type: 'uint24' },
      { name: 'recipient', type: 'address' },
      { name: 'deadline', type: 'uint256' },
      { name: 'amountOut', type: 'uint256' },
      { name: 'amountInMaximum', type: 'uint256' },
      { name: 'sqrtPriceLimitX96', type: 'uint160' },
    ],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'getAmountsOutV2',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'amountIn', type: 'uint256' },
      { name: 'path', type: 'address[]' },
    ],
    outputs: [{ type: 'uint256[]' }],
  },
  {
    name: 'getAmountsInV2',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'path', type: 'address[]' },
    ],
    outputs: [{ type: 'uint256[]' }],
  },
  {
    name: 'quoteForRouter',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenIn', type: 'address' },
      { name: 'tokenOut', type: 'address' },
      { name: 'amountIn', type: 'uint256' },
    ],
    outputs: [
      { name: 'amountOut', type: 'uint256' },
      { name: 'poolType', type: 'uint8' },
      { name: 'fee', type: 'uint24' },
    ],
  },
] as const

const V2_FACTORY_ABI = [
  {
    name: 'getPair',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
    ],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'createPair',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
    ],
    outputs: [{ type: 'address' }],
  },
] as const

const V2_PAIR_ABI = [
  {
    name: 'getReserves',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'reserve0', type: 'uint112' },
      { name: 'reserve1', type: 'uint112' },
      { name: 'blockTimestampLast', type: 'uint32' },
    ],
  },
  {
    name: 'token0',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'token1',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'totalSupply',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint256' }],
  },
] as const

const V2_ROUTER_ABI = [
  {
    name: 'addLiquidity',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'amountADesired', type: 'uint256' },
      { name: 'amountBDesired', type: 'uint256' },
      { name: 'amountAMin', type: 'uint256' },
      { name: 'amountBMin', type: 'uint256' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [
      { name: 'amountA', type: 'uint256' },
      { name: 'amountB', type: 'uint256' },
      { name: 'liquidity', type: 'uint256' },
    ],
  },
  {
    name: 'addLiquidityETH',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amountTokenDesired', type: 'uint256' },
      { name: 'amountTokenMin', type: 'uint256' },
      { name: 'amountETHMin', type: 'uint256' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [
      { name: 'amountToken', type: 'uint256' },
      { name: 'amountETH', type: 'uint256' },
      { name: 'liquidity', type: 'uint256' },
    ],
  },
  {
    name: 'removeLiquidity',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'liquidity', type: 'uint256' },
      { name: 'amountAMin', type: 'uint256' },
      { name: 'amountBMin', type: 'uint256' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    outputs: [
      { name: 'amountA', type: 'uint256' },
      { name: 'amountB', type: 'uint256' },
    ],
  },
] as const

const V3_FACTORY_ABI = [
  {
    name: 'getPool',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'fee', type: 'uint24' },
    ],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'createPool',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'fee', type: 'uint24' },
    ],
    outputs: [{ type: 'address' }],
  },
] as const

const V3_POOL_ABI = [
  {
    name: 'slot0',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' },
    ],
  },
  {
    name: 'liquidity',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint128' }],
  },
  {
    name: 'token0',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'token1',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'address' }],
  },
  {
    name: 'fee',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'uint24' }],
  },
  {
    name: 'tickSpacing',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ type: 'int24' }],
  },
] as const

const V3_POSITION_MANAGER_ABI = [
  {
    name: 'mint',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'token0', type: 'address' },
          { name: 'token1', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'tickLower', type: 'int24' },
          { name: 'tickUpper', type: 'int24' },
          { name: 'amount0Desired', type: 'uint256' },
          { name: 'amount1Desired', type: 'uint256' },
          { name: 'amount0Min', type: 'uint256' },
          { name: 'amount1Min', type: 'uint256' },
          { name: 'recipient', type: 'address' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
    ],
    outputs: [
      { name: 'tokenId', type: 'uint256' },
      { name: 'liquidity', type: 'uint128' },
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
  },
  {
    name: 'increaseLiquidity',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenId', type: 'uint256' },
          { name: 'amount0Desired', type: 'uint256' },
          { name: 'amount1Desired', type: 'uint256' },
          { name: 'amount0Min', type: 'uint256' },
          { name: 'amount1Min', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
    ],
    outputs: [
      { name: 'liquidity', type: 'uint128' },
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
  },
  {
    name: 'decreaseLiquidity',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenId', type: 'uint256' },
          { name: 'liquidity', type: 'uint128' },
          { name: 'amount0Min', type: 'uint256' },
          { name: 'amount1Min', type: 'uint256' },
          { name: 'deadline', type: 'uint256' },
        ],
      },
    ],
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
  },
  {
    name: 'collect',
    type: 'function',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenId', type: 'uint256' },
          { name: 'recipient', type: 'address' },
          { name: 'amount0Max', type: 'uint128' },
          { name: 'amount1Max', type: 'uint128' },
        ],
      },
    ],
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
  },
  {
    name: 'positions',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'tokenId', type: 'uint256' }],
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
  },
  {
    name: 'balanceOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'tokenOfOwnerByIndex',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'index', type: 'uint256' },
    ],
    outputs: [{ type: 'uint256' }],
  },
] as const

// ═══════════════════════════════════════════════════════════════════════════
//                          IMPLEMENTATION
// ═══════════════════════════════════════════════════════════════════════════

export function createAMMModule(
  wallet: JejuWallet,
  network: NetworkType,
): AMMModule {
  const routerAddress = requireContract('amm', 'XLPRouter', network)
  const v2FactoryAddress = requireContract('amm', 'XLPV2Factory', network)
  const v3FactoryAddress = safeGetContract('amm', 'XLPV3Factory', network)
  const v3PositionManagerAddress = safeGetContract(
    'amm',
    'XLPV3PositionManager',
    network,
  )

  const defaultDeadline = () => BigInt(Math.floor(Date.now() / 1000) + 1800) // 30 minutes
  const MAX_UINT128 = (1n << 128n) - 1n

  return {
    async getQuote(tokenIn, tokenOut, amountIn) {
      const result = await wallet.publicClient.readContract({
        address: routerAddress,
        abi: XLP_ROUTER_ABI,
        functionName: 'quoteForRouter',
        args: [tokenIn, tokenOut, amountIn],
      })

      const [amountOut, poolType, fee] = result as [bigint, number, number]

      return {
        amountOut,
        poolType: poolType as PoolType,
        fee,
        priceImpact: 0, // Would need to calculate
        path: [tokenIn, tokenOut],
      }
    },

    async getAmountsOutV2(amountIn, path) {
      const result = await wallet.publicClient.readContract({
        address: routerAddress,
        abi: XLP_ROUTER_ABI,
        functionName: 'getAmountsOutV2',
        args: [amountIn, path],
      })
      return [...result]
    },

    async getAmountsInV2(amountOut, path) {
      const result = await wallet.publicClient.readContract({
        address: routerAddress,
        abi: XLP_ROUTER_ABI,
        functionName: 'getAmountsInV2',
        args: [amountOut, path],
      })
      return [...result]
    },

    async swapExactTokensForTokensV2(params) {
      const data = encodeFunctionData({
        abi: XLP_ROUTER_ABI,
        functionName: 'swapExactTokensForTokensV2',
        args: [
          params.amountIn,
          params.amountOutMin,
          [params.tokenIn, params.tokenOut],
          params.recipient ?? wallet.address,
          params.deadline ?? defaultDeadline(),
        ],
      })

      return wallet.sendTransaction({
        to: routerAddress,
        data,
      })
    },

    async swapTokensForExactTokensV2(params) {
      const data = encodeFunctionData({
        abi: XLP_ROUTER_ABI,
        functionName: 'swapTokensForExactTokensV2',
        args: [
          params.amountOut,
          params.amountInMax,
          [params.tokenIn, params.tokenOut],
          params.recipient ?? wallet.address,
          params.deadline ?? defaultDeadline(),
        ],
      })

      return wallet.sendTransaction({
        to: routerAddress,
        data,
      })
    },

    async swapExactETHForTokensV2(params) {
      const data = encodeFunctionData({
        abi: XLP_ROUTER_ABI,
        functionName: 'swapExactETHForTokensV2',
        args: [
          params.amountOutMin,
          [params.tokenOut], // WETH is prepended by contract
          params.recipient ?? wallet.address,
          params.deadline ?? defaultDeadline(),
        ],
      })

      return wallet.sendTransaction({
        to: routerAddress,
        data,
        value: params.amountIn,
      })
    },

    async swapExactTokensForETHV2(params) {
      const data = encodeFunctionData({
        abi: XLP_ROUTER_ABI,
        functionName: 'swapExactTokensForETHV2',
        args: [
          params.amountIn,
          params.amountOutMin,
          [params.tokenIn], // WETH is appended by contract
          params.recipient ?? wallet.address,
          params.deadline ?? defaultDeadline(),
        ],
      })

      return wallet.sendTransaction({
        to: routerAddress,
        data,
      })
    },

    async exactInputSingleV3(params) {
      const data = encodeFunctionData({
        abi: XLP_ROUTER_ABI,
        functionName: 'exactInputSingleV3',
        args: [
          params.tokenIn,
          params.tokenOut,
          params.fee,
          params.recipient ?? wallet.address,
          params.deadline ?? defaultDeadline(),
          params.amountIn,
          params.amountOutMin,
          params.sqrtPriceLimitX96 ?? 0n,
        ],
      })

      return wallet.sendTransaction({
        to: routerAddress,
        data,
      })
    },

    async exactOutputSingleV3(params) {
      const data = encodeFunctionData({
        abi: XLP_ROUTER_ABI,
        functionName: 'exactOutputSingleV3',
        args: [
          params.tokenIn,
          params.tokenOut,
          params.fee,
          params.recipient ?? wallet.address,
          params.deadline ?? defaultDeadline(),
          params.amountOut,
          params.amountInMax,
          params.sqrtPriceLimitX96 ?? 0n,
        ],
      })

      return wallet.sendTransaction({
        to: routerAddress,
        data,
      })
    },

    async addLiquidityV2(_params) {
      // Would need V2 router liquidity functions
      throw new Error('Not implemented - use V2 router directly')
    },

    async removeLiquidityV2(_params) {
      throw new Error('Not implemented - use V2 router directly')
    },

    async addLiquidityETHV2(_params) {
      throw new Error('Not implemented - use V2 router directly')
    },

    async addLiquidityV3(_params) {
      throw new Error('Not implemented - use position manager directly')
    },

    async increaseLiquidityV3(_tokenId, _amount0Desired, _amount1Desired) {
      throw new Error('Not implemented - use position manager directly')
    },

    async decreaseLiquidityV3(_tokenId, _liquidity) {
      throw new Error('Not implemented - use position manager directly')
    },

    async collectFeesV3(_tokenId) {
      throw new Error('Not implemented - use position manager directly')
    },

    async getV2Pool(tokenA, tokenB) {
      const pairAddress = (await wallet.publicClient.readContract({
        address: v2FactoryAddress,
        abi: V2_FACTORY_ABI,
        functionName: 'getPair',
        args: [tokenA, tokenB],
      })) as Address

      if (pairAddress === '0x0000000000000000000000000000000000000000') {
        return null
      }

      const [reserves, token0, token1, totalSupply] = await Promise.all([
        wallet.publicClient.readContract({
          address: pairAddress,
          abi: V2_PAIR_ABI,
          functionName: 'getReserves',
        }),
        wallet.publicClient.readContract({
          address: pairAddress,
          abi: V2_PAIR_ABI,
          functionName: 'token0',
        }),
        wallet.publicClient.readContract({
          address: pairAddress,
          abi: V2_PAIR_ABI,
          functionName: 'token1',
        }),
        wallet.publicClient.readContract({
          address: pairAddress,
          abi: V2_PAIR_ABI,
          functionName: 'totalSupply',
        }),
      ])

      const [reserve0, reserve1] = reserves as [bigint, bigint, number]

      return {
        pairAddress,
        token0: token0 as Address,
        token1: token1 as Address,
        reserve0,
        reserve1,
        totalSupply: totalSupply as bigint,
        kLast: reserve0 * reserve1,
      }
    },

    async getV3Pool(_tokenA, _tokenB, _fee) {
      // Would need to query V3 factory and pool
      return null
    },

    async getV3Position(_tokenId) {
      // Would need to query position manager
      return null
    },

    async getMyV3Positions() {
      return []
    },

    async getSpotPrice(tokenIn, tokenOut) {
      const quote = await this.getQuote(tokenIn, tokenOut, parseEther('1'))
      return quote.amountOut
    },

    async createV2Pool(tokenA, tokenB) {
      const data = encodeFunctionData({
        abi: V2_FACTORY_ABI,
        functionName: 'createPair',
        args: [tokenA, tokenB],
      })

      const txHash = await wallet.sendTransaction({
        to: v2FactoryAddress,
        data,
      })

      // Get the created pair address
      const pairAddress = (await wallet.publicClient.readContract({
        address: v2FactoryAddress,
        abi: V2_FACTORY_ABI,
        functionName: 'getPair',
        args: [tokenA, tokenB],
      })) as Address

      return { txHash, pairAddress }
    },

    async createV3Pool(_tokenA, _tokenB, _fee) {
      throw new Error('Not implemented - use V3 factory directly')
    },
  }
}
