/**
 * @fileoverview Comprehensive tests for defi.ts
 *
 * Tests cover:
 * - TokenSchema: Token metadata validation
 * - UniswapV4PoolSchema: Pool configuration validation
 * - SynthetixMarketSchema: Perps market validation
 * - CompoundV3MarketSchema: Lending market validation
 * - ChainlinkFeedSchema: Oracle feed validation
 * - LiquidityPositionSchema: LP position validation
 * - PerpPositionSchema: Perpetual position validation
 * - LendingPositionSchema: Lending position validation
 * - PaymasterDeploymentSchema: Paymaster configuration
 * - PaymasterStatsSchema: Paymaster statistics
 */

import { describe, expect, test } from 'bun:test'
import {
  ChainlinkFeedSchema,
  CompoundV3MarketSchema,
  type DexProtocol,
  LendingPositionSchema,
  LiquidityPositionSchema,
  LPPositionSchema,
  MultiTokenSystemSchema,
  PaymasterDeploymentSchema,
  PaymasterStatsSchema,
  PerpPositionSchema,
  type StakeStatus,
  type SwapQuote,
  SynthetixMarketSchema,
  type Token,
  TokenSchema,
  UniswapV4PoolSchema,
} from '../defi'

const TEST_ADDRESS = '0x1234567890123456789012345678901234567890'

describe('StakeStatus type', () => {
  test('allows valid status values', () => {
    const statuses: StakeStatus[] = ['idle', 'pending', 'complete', 'error']
    expect(statuses.length).toBe(4)
  })
})

describe('DexProtocol type', () => {
  test('allows valid protocol values', () => {
    const protocols: DexProtocol[] = [
      'uniswap-v2',
      'uniswap-v3',
      'sushiswap',
      'curve',
      'balancer',
      'pancakeswap-v2',
      'pancakeswap-v3',
      'xlp-v2',
      'xlp-v3',
      'tfmm',
    ]
    expect(protocols.length).toBe(10)
  })
})

describe('TokenSchema', () => {
  const validToken: Token = {
    address: TEST_ADDRESS,
    name: 'Wrapped Ether',
    symbol: 'WETH',
    decimals: 18,
    chainId: 1,
  }

  test('accepts valid token', () => {
    const result = TokenSchema.safeParse(validToken)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.symbol).toBe('WETH')
    }
  })

  test('rejects invalid address', () => {
    const token = { ...validToken, address: 'not-an-address' }
    expect(TokenSchema.safeParse(token).success).toBe(false)
  })

  test('rejects non-numeric decimals', () => {
    const token = { ...validToken, decimals: 'eighteen' }
    expect(TokenSchema.safeParse(token).success).toBe(false)
  })
})

describe('SwapQuote type', () => {
  test('has correct structure', () => {
    const quote: SwapQuote = {
      tokenIn: TEST_ADDRESS as `0x${string}`,
      tokenOut: TEST_ADDRESS as `0x${string}`,
      amountIn: 1000000000000000000n,
      amountOut: 2000000000n,
      amountOutMin: 1980000000n,
      priceImpact: 0.001,
      route: [TEST_ADDRESS as `0x${string}`],
      fee: 3000000000000000n,
    }

    expect(quote.amountIn).toBe(1000000000000000000n)
    expect(quote.priceImpact).toBe(0.001)
  })
})

describe('UniswapV4PoolSchema', () => {
  const validPool = {
    poolId: 'pool-123',
    token0: {
      address: TEST_ADDRESS,
      name: 'Token A',
      symbol: 'TKA',
      decimals: 18,
      chainId: 1,
    },
    token1: {
      address: TEST_ADDRESS,
      name: 'Token B',
      symbol: 'TKB',
      decimals: 18,
      chainId: 1,
    },
    fee: 3000,
    tickSpacing: 60,
    sqrtPriceX96: '79228162514264337593543950336',
    tick: 0,
    liquidity: '1000000000000000000',
  }

  test('accepts valid pool', () => {
    const result = UniswapV4PoolSchema.safeParse(validPool)
    expect(result.success).toBe(true)
  })

  test('accepts pool with hooks', () => {
    const pool = { ...validPool, hooks: TEST_ADDRESS }
    const result = UniswapV4PoolSchema.safeParse(pool)
    expect(result.success).toBe(true)
  })
})

describe('SynthetixMarketSchema', () => {
  const validMarket = {
    marketId: 1,
    marketName: 'Ethereum',
    marketSymbol: 'sETH-PERP',
    maxFundingVelocity: '10000000000000000',
    skewScale: '100000000000000000000000',
    makerFee: '200000000000000',
    takerFee: '500000000000000',
    priceFeeds: [TEST_ADDRESS],
  }

  test('accepts valid market', () => {
    const result = SynthetixMarketSchema.safeParse(validMarket)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.marketId).toBe(1)
    }
  })

  test('rejects overly long market name', () => {
    const market = { ...validMarket, marketName: 'a'.repeat(1000) }
    expect(SynthetixMarketSchema.safeParse(market).success).toBe(false)
  })
})

describe('CompoundV3MarketSchema', () => {
  const validMarket = {
    cometAddress: TEST_ADDRESS,
    baseToken: {
      address: TEST_ADDRESS,
      name: 'USD Coin',
      symbol: 'USDC',
      decimals: 6,
      chainId: 1,
    },
    collateralTokens: [
      {
        token: {
          address: TEST_ADDRESS,
          name: 'Wrapped Ether',
          symbol: 'WETH',
          decimals: 18,
          chainId: 1,
        },
        borrowCollateralFactor: '820000000000000000',
        liquidateCollateralFactor: '850000000000000000',
        liquidationFactor: '930000000000000000',
        supplyCap: '500000000000000000000000',
      },
    ],
    governor: TEST_ADDRESS,
    pauseGuardian: TEST_ADDRESS,
    baseBorrowMin: '100000000',
    targetReserves: '5000000000000',
  }

  test('accepts valid market', () => {
    const result = CompoundV3MarketSchema.safeParse(validMarket)
    expect(result.success).toBe(true)
  })

  test('accepts market with multiple collateral tokens', () => {
    const market = {
      ...validMarket,
      collateralTokens: [
        ...validMarket.collateralTokens,
        {
          token: {
            address: TEST_ADDRESS,
            name: 'Wrapped Bitcoin',
            symbol: 'WBTC',
            decimals: 8,
            chainId: 1,
          },
          borrowCollateralFactor: '700000000000000000',
          liquidateCollateralFactor: '750000000000000000',
          liquidationFactor: '900000000000000000',
          supplyCap: '10000000000000',
        },
      ],
    }
    const result = CompoundV3MarketSchema.safeParse(market)
    expect(result.success).toBe(true)
  })
})

describe('ChainlinkFeedSchema', () => {
  const validFeed = {
    pair: 'ETH/USD',
    address: TEST_ADDRESS,
    decimals: 8,
    heartbeat: 3600,
    deviation: 1,
  }

  test('accepts valid feed', () => {
    const result = ChainlinkFeedSchema.safeParse(validFeed)
    expect(result.success).toBe(true)
  })

  test('accepts feed with optional fields', () => {
    const feed = {
      ...validFeed,
      latestRound: 12345,
      latestAnswer: '200000000000',
      latestTimestamp: Date.now(),
    }
    const result = ChainlinkFeedSchema.safeParse(feed)
    expect(result.success).toBe(true)
  })
})

describe('LiquidityPositionSchema', () => {
  const validPosition = {
    id: 'pos-123',
    owner: TEST_ADDRESS,
    pool: {
      poolId: 'pool-123',
      token0: {
        address: TEST_ADDRESS,
        name: 'Token A',
        symbol: 'TKA',
        decimals: 18,
        chainId: 1,
      },
      token1: {
        address: TEST_ADDRESS,
        name: 'Token B',
        symbol: 'TKB',
        decimals: 18,
        chainId: 1,
      },
      fee: 3000,
      tickSpacing: 60,
      sqrtPriceX96: '79228162514264337593543950336',
      tick: 0,
      liquidity: '1000000000000000000',
    },
    tickLower: -887220,
    tickUpper: 887220,
    liquidity: '1000000000000000000',
    token0Amount: '500000000000000000',
    token1Amount: '500000000000000000',
  }

  test('accepts valid position', () => {
    const result = LiquidityPositionSchema.safeParse(validPosition)
    expect(result.success).toBe(true)
  })
})

describe('PerpPositionSchema', () => {
  const validPosition = {
    accountId: 1,
    marketId: 1,
    size: '1000000000000000000',
    entryPrice: '2000000000000000000000',
    leverage: '5000000000000000000',
    margin: '400000000000000000000',
    unrealizedPnl: '50000000000000000000',
    liquidationPrice: '1600000000000000000000',
  }

  test('accepts valid position', () => {
    const result = PerpPositionSchema.safeParse(validPosition)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.accountId).toBe(1)
    }
  })
})

describe('LendingPositionSchema', () => {
  const validPosition = {
    account: TEST_ADDRESS,
    comet: TEST_ADDRESS,
    collateral: [
      {
        token: TEST_ADDRESS,
        balance: '1000000000000000000',
        valueUsd: '2000000000',
      },
    ],
    borrowed: '1000000000',
    borrowedUsd: '1000000000',
    borrowCapacity: '1600000000',
    liquidationThreshold: '1700000000',
    healthFactor: '1700000000000000000',
  }

  test('accepts valid position', () => {
    const result = LendingPositionSchema.safeParse(validPosition)
    expect(result.success).toBe(true)
  })
})

describe('PaymasterDeploymentSchema', () => {
  const validDeployment = {
    token: TEST_ADDRESS,
    tokenSymbol: 'USDC',
    tokenName: 'USD Coin',
    vault: TEST_ADDRESS,
    distributor: TEST_ADDRESS,
    paymaster: TEST_ADDRESS,
    deployedAt: Date.now(),
    deployer: TEST_ADDRESS,
    network: 'mainnet',
  }

  test('accepts valid deployment', () => {
    const result = PaymasterDeploymentSchema.safeParse(validDeployment)
    expect(result.success).toBe(true)
  })
})

describe('MultiTokenSystemSchema', () => {
  const validSystem = {
    oracle: TEST_ADDRESS,
    entryPoint: TEST_ADDRESS,
    deployments: {
      USDC: {
        token: TEST_ADDRESS,
        tokenSymbol: 'USDC',
        tokenName: 'USD Coin',
        vault: TEST_ADDRESS,
        distributor: TEST_ADDRESS,
        paymaster: TEST_ADDRESS,
        deployedAt: Date.now(),
        deployer: TEST_ADDRESS,
        network: 'mainnet',
      },
    },
    network: 'mainnet',
    chainId: 1,
    deployedAt: Date.now(),
  }

  test('accepts valid system', () => {
    const result = MultiTokenSystemSchema.safeParse(validSystem)
    expect(result.success).toBe(true)
  })
})

describe('LPPositionSchema', () => {
  const validPosition = {
    vault: TEST_ADDRESS,
    token: TEST_ADDRESS,
    tokenSymbol: 'USDC',
    ethShares: '1000000000000000000',
    ethValue: '1050000000000000000',
    tokenShares: '2000000000',
    tokenValue: '2100000000',
    pendingFees: '50000000000000000',
    sharePercentage: 5.5,
  }

  test('accepts valid LP position', () => {
    const result = LPPositionSchema.safeParse(validPosition)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.sharePercentage).toBe(5.5)
    }
  })
})

describe('PaymasterStatsSchema', () => {
  const validStats = {
    paymaster: TEST_ADDRESS,
    token: TEST_ADDRESS,
    tokenSymbol: 'USDC',
    entryPointBalance: '1000000000000000000',
    vaultLiquidity: '10000000000',
    totalTransactions: 1000,
    totalVolumeToken: '50000000000',
    totalFeesCollected: '500000000',
    isOperational: true,
    oracleFresh: true,
    lastUpdate: Date.now(),
  }

  test('accepts valid stats', () => {
    const result = PaymasterStatsSchema.safeParse(validStats)
    expect(result.success).toBe(true)
    if (result.success) {
      expect(result.data.isOperational).toBe(true)
    }
  })
})
