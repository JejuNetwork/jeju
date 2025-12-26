/**
 * Pools Service - XLP V2/V3 Liquidity Pool Management
 * Add/remove liquidity, view positions, collect fees
 */

import { getRpcUrl } from '@jejunetwork/config'
import { ZERO_ADDRESS } from '@jejunetwork/types'
import {
  type Address,
  createPublicClient,
  encodeFunctionData,
  type Hex,
  http,
  type PublicClient,
} from 'viem'
import { getChainContracts, getNetworkRpcUrl } from '../../sdk/chains'
import { isSupportedChainId, rpcService } from '../rpc'

const XLP_V2_FACTORY_ABI = [
  {
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
    ],
    name: 'getPair',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
    ],
    name: 'createPair',
    outputs: [{ type: 'address' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [],
    name: 'allPairsLength',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'index', type: 'uint256' }],
    name: 'allPairs',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
] as const

const XLP_V2_PAIR_ABI = [
  {
    inputs: [],
    name: 'getReserves',
    outputs: [
      { name: 'reserve0', type: 'uint112' },
      { name: 'reserve1', type: 'uint112' },
      { name: 'blockTimestampLast', type: 'uint32' },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'token0',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'token1',
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [],
    name: 'totalSupply',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'owner', type: 'address' }],
    name: 'balanceOf',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [{ name: 'to', type: 'address' }],
    name: 'mint',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'to', type: 'address' }],
    name: 'burn',
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const

const XLP_V2_ROUTER_ABI = [
  {
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
    name: 'addLiquidity',
    outputs: [
      { name: 'amountA', type: 'uint256' },
      { name: 'amountB', type: 'uint256' },
      { name: 'liquidity', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'amountTokenDesired', type: 'uint256' },
      { name: 'amountTokenMin', type: 'uint256' },
      { name: 'amountETHMin', type: 'uint256' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    name: 'addLiquidityETH',
    outputs: [
      { name: 'amountToken', type: 'uint256' },
      { name: 'amountETH', type: 'uint256' },
      { name: 'liquidity', type: 'uint256' },
    ],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'tokenA', type: 'address' },
      { name: 'tokenB', type: 'address' },
      { name: 'liquidity', type: 'uint256' },
      { name: 'amountAMin', type: 'uint256' },
      { name: 'amountBMin', type: 'uint256' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    name: 'removeLiquidity',
    outputs: [
      { name: 'amountA', type: 'uint256' },
      { name: 'amountB', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'liquidity', type: 'uint256' },
      { name: 'amountTokenMin', type: 'uint256' },
      { name: 'amountETHMin', type: 'uint256' },
      { name: 'to', type: 'address' },
      { name: 'deadline', type: 'uint256' },
    ],
    name: 'removeLiquidityETH',
    outputs: [
      { name: 'amountToken', type: 'uint256' },
      { name: 'amountETH', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const

const XLP_V3_POSITION_ABI = [
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
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'index', type: 'uint256' },
    ],
    name: 'tokenOfOwnerByIndex',
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      {
        components: [
          { name: 'tokenId', type: 'uint256' },
          { name: 'recipient', type: 'address' },
          { name: 'amount0Max', type: 'uint128' },
          { name: 'amount1Max', type: 'uint128' },
        ],
        name: 'params',
        type: 'tuple',
      },
    ],
    name: 'collect',
    outputs: [
      { name: 'amount0', type: 'uint256' },
      { name: 'amount1', type: 'uint256' },
    ],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const

export interface V2Pool {
  address: Address
  token0: Address
  token1: Address
  reserve0: bigint
  reserve1: bigint
  totalSupply: bigint
  chainId: number
}

export interface V2Position {
  pool: V2Pool
  lpBalance: bigint
  share: number // percentage
  token0Amount: bigint
  token1Amount: bigint
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
  chainId: number
}

export interface AddLiquidityV2Params {
  tokenA: Address
  tokenB: Address
  amountADesired: bigint
  amountBDesired: bigint
  slippageBps: number
  recipient: Address
  isETH?: boolean
}

export interface RemoveLiquidityV2Params {
  tokenA: Address
  tokenB: Address
  liquidity: bigint
  slippageBps: number
  recipient: Address
  isETH?: boolean
}

const DEFAULT_DEADLINE = () => BigInt(Math.floor(Date.now() / 1000) + 1200) // 20 minutes

export class PoolsService {
  private chainId: number
  private clientCache = new Map<number, PublicClient>()

  constructor(chainId: number = 8453) {
    this.chainId = chainId
  }

  setChain(chainId: number) {
    this.chainId = chainId
  }

  private getContracts() {
    return getChainContracts(this.chainId)
  }

  private getClient(): PublicClient {
    // Use rpcService for supported chains, create ad-hoc client for others
    if (isSupportedChainId(this.chainId)) {
      return rpcService.getClient(this.chainId)
    }

    const cached = this.clientCache.get(this.chainId)
    if (cached) {
      return cached
    }
    const rpcUrl = getNetworkRpcUrl(this.chainId) ?? getRpcUrl()
    const client = createPublicClient({ transport: http(rpcUrl) })
    this.clientCache.set(this.chainId, client)
    return client
  }

  /**
   * Get V2 pair address
   */
  async getPairAddress(
    tokenA: Address,
    tokenB: Address,
  ): Promise<Address | null> {
    const factory = this.getContracts().xlpV2Factory
    if (!factory) return null

    const client = this.getClient()
    const pair = await client.readContract({
      address: factory,
      abi: XLP_V2_FACTORY_ABI,
      functionName: 'getPair',
      args: [tokenA, tokenB],
    })

    return pair === ZERO_ADDRESS ? null : pair
  }

  /**
   * Get V2 pool info
   */
  async getV2Pool(pairAddress: Address): Promise<V2Pool | null> {
    const client = this.getClient()

    const [token0, token1, reserves, totalSupply] = await Promise.all([
      client.readContract({
        address: pairAddress,
        abi: XLP_V2_PAIR_ABI,
        functionName: 'token0',
        args: [],
      }),
      client.readContract({
        address: pairAddress,
        abi: XLP_V2_PAIR_ABI,
        functionName: 'token1',
        args: [],
      }),
      client.readContract({
        address: pairAddress,
        abi: XLP_V2_PAIR_ABI,
        functionName: 'getReserves',
        args: [],
      }),
      client.readContract({
        address: pairAddress,
        abi: XLP_V2_PAIR_ABI,
        functionName: 'totalSupply',
        args: [],
      }),
    ])

    return {
      address: pairAddress,
      token0,
      token1,
      reserve0: reserves[0],
      reserve1: reserves[1],
      totalSupply,
      chainId: this.chainId,
    }
  }

  /**
   * Get user's V2 position in a pool
   */
  async getV2Position(
    pairAddress: Address,
    owner: Address,
  ): Promise<V2Position | null> {
    const pool = await this.getV2Pool(pairAddress)
    if (!pool) return null

    const client = this.getClient()
    const lpBalance = await client.readContract({
      address: pairAddress,
      abi: XLP_V2_PAIR_ABI,
      functionName: 'balanceOf',
      args: [owner],
    })

    if (lpBalance === 0n) return null

    const share = Number((lpBalance * 10000n) / pool.totalSupply) / 100
    const token0Amount = (pool.reserve0 * lpBalance) / pool.totalSupply
    const token1Amount = (pool.reserve1 * lpBalance) / pool.totalSupply

    return { pool, lpBalance, share, token0Amount, token1Amount }
  }

  /**
   * Get all V2 positions for a user
   */
  async getAllV2Positions(owner: Address): Promise<V2Position[]> {
    const factory = this.getContracts().xlpV2Factory
    if (!factory) return []

    const client = this.getClient()
    const pairsLength = await client.readContract({
      address: factory,
      abi: XLP_V2_FACTORY_ABI,
      functionName: 'allPairsLength',
      args: [],
    })

    const positions: V2Position[] = []

    // Check each pair for user balance (in production, use indexer)
    for (let i = 0n; i < pairsLength && i < 100n; i++) {
      const pairAddress = await client.readContract({
        address: factory,
        abi: XLP_V2_FACTORY_ABI,
        functionName: 'allPairs',
        args: [i],
      })

      const position = await this.getV2Position(pairAddress, owner)
      if (position) positions.push(position)
    }

    return positions
  }

  /**
   * Build add liquidity V2 transaction
   */
  buildAddLiquidityV2Tx(
    params: AddLiquidityV2Params,
  ): { to: Address; data: Hex; value: bigint } | null {
    const router = this.getContracts().swapRouter
    if (!router) return null

    const amountAMin =
      (params.amountADesired * BigInt(10000 - params.slippageBps)) / 10000n
    const amountBMin =
      (params.amountBDesired * BigInt(10000 - params.slippageBps)) / 10000n
    const deadline = DEFAULT_DEADLINE()

    if (params.isETH) {
      const data = encodeFunctionData({
        abi: XLP_V2_ROUTER_ABI,
        functionName: 'addLiquidityETH',
        args: [
          params.tokenA,
          params.amountADesired,
          amountAMin,
          amountBMin,
          params.recipient,
          deadline,
        ],
      })
      return { to: router, data, value: params.amountBDesired }
    }

    const data = encodeFunctionData({
      abi: XLP_V2_ROUTER_ABI,
      functionName: 'addLiquidity',
      args: [
        params.tokenA,
        params.tokenB,
        params.amountADesired,
        params.amountBDesired,
        amountAMin,
        amountBMin,
        params.recipient,
        deadline,
      ],
    })
    return { to: router, data, value: 0n }
  }

  /**
   * Build remove liquidity V2 transaction
   */
  buildRemoveLiquidityV2Tx(
    params: RemoveLiquidityV2Params,
    expectedAmountA: bigint,
    expectedAmountB: bigint,
  ): { to: Address; data: Hex } | null {
    const router = this.getContracts().swapRouter
    if (!router) return null

    const amountAMin =
      (expectedAmountA * BigInt(10000 - params.slippageBps)) / 10000n
    const amountBMin =
      (expectedAmountB * BigInt(10000 - params.slippageBps)) / 10000n
    const deadline = DEFAULT_DEADLINE()

    if (params.isETH) {
      const data = encodeFunctionData({
        abi: XLP_V2_ROUTER_ABI,
        functionName: 'removeLiquidityETH',
        args: [
          params.tokenA,
          params.liquidity,
          amountAMin,
          amountBMin,
          params.recipient,
          deadline,
        ],
      })
      return { to: router, data }
    }

    const data = encodeFunctionData({
      abi: XLP_V2_ROUTER_ABI,
      functionName: 'removeLiquidity',
      args: [
        params.tokenA,
        params.tokenB,
        params.liquidity,
        amountAMin,
        amountBMin,
        params.recipient,
        deadline,
      ],
    })
    return { to: router, data }
  }

  /**
   * Get all V3 positions for a user
   */
  async getAllV3Positions(owner: Address): Promise<V3Position[]> {
    const positionManager = this.getContracts().positionManager
    if (!positionManager) return []

    const client = this.getClient()
    const balance = await client.readContract({
      address: positionManager,
      abi: XLP_V3_POSITION_ABI,
      functionName: 'balanceOf',
      args: [owner],
    })

    const positions: V3Position[] = []

    for (let i = 0n; i < balance; i++) {
      const tokenId = await client.readContract({
        address: positionManager,
        abi: XLP_V3_POSITION_ABI,
        functionName: 'tokenOfOwnerByIndex',
        args: [owner, i],
      })

      // Returns tuple: [nonce, operator, token0, token1, fee, tickLower, tickUpper, liquidity, feeGrowthInside0, feeGrowthInside1, tokensOwed0, tokensOwed1]
      const result = await client.readContract({
        address: positionManager,
        abi: XLP_V3_POSITION_ABI,
        functionName: 'positions',
        args: [tokenId],
      })

      const [
        _nonce,
        _operator,
        token0,
        token1,
        fee,
        tickLower,
        tickUpper,
        liquidity,
        _fg0,
        _fg1,
        tokensOwed0,
        tokensOwed1,
      ] = result as [
        bigint,
        Address,
        Address,
        Address,
        number,
        number,
        number,
        bigint,
        bigint,
        bigint,
        bigint,
        bigint,
      ]

      if (liquidity > 0n) {
        positions.push({
          tokenId,
          token0,
          token1,
          fee,
          tickLower,
          tickUpper,
          liquidity,
          tokensOwed0,
          tokensOwed1,
          chainId: this.chainId,
        })
      }
    }

    return positions
  }

  /**
   * Build collect fees V3 transaction
   */
  buildCollectFeesV3Tx(
    tokenId: bigint,
    recipient: Address,
  ): { to: Address; data: Hex } | null {
    const positionManager = this.getContracts().positionManager
    if (!positionManager) return null

    const MAX_UINT128 = 2n ** 128n - 1n
    const data = encodeFunctionData({
      abi: XLP_V3_POSITION_ABI,
      functionName: 'collect',
      args: [
        {
          tokenId,
          recipient,
          amount0Max: MAX_UINT128,
          amount1Max: MAX_UINT128,
        },
      ],
    })

    return { to: positionManager, data }
  }

  /**
   * Calculate optimal amounts for adding liquidity
   */
  async calculateOptimalAmounts(
    tokenA: Address,
    tokenB: Address,
    amountA: bigint,
  ): Promise<{ amountA: bigint; amountB: bigint } | null> {
    const pairAddress = await this.getPairAddress(tokenA, tokenB)
    if (!pairAddress) return null

    const pool = await this.getV2Pool(pairAddress)
    if (!pool || pool.reserve0 === 0n) return null

    // Determine order
    const isToken0 = tokenA.toLowerCase() < tokenB.toLowerCase()
    const reserveA = isToken0 ? pool.reserve0 : pool.reserve1
    const reserveB = isToken0 ? pool.reserve1 : pool.reserve0

    const amountB = (amountA * reserveB) / reserveA

    return { amountA, amountB }
  }
}

export const poolsService = new PoolsService()
