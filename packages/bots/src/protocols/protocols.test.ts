import type { Address, PublicClient } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { IntentSolver } from './intent-solver'
import { RateArbitrage } from './rate-arbitrage'

// Create mock functions
const mockReadContract = vi.fn()
const mockSimulateContract = vi.fn()

// Mock PublicClient
const mockPublicClient = {
  readContract: mockReadContract,
  simulateContract: mockSimulateContract,
  getBlockNumber: vi.fn().mockResolvedValue(12345678n),
} as unknown as PublicClient

describe('RateArbitrage', () => {
  let rateArb: RateArbitrage

  beforeEach(() => {
    vi.clearAllMocks()
    rateArb = new RateArbitrage(
      {
        chainId: 1,
        minSpreadBps: 10,
        checkIntervalMs: 60000,
        assets: [],
      },
      mockPublicClient,
    )
  })

  it('should initialize with correct config', () => {
    const stats = rateArb.getStats()
    expect(stats.protocols).toBe(3) // Aave, Compound, Spark on mainnet
    expect(stats.opportunities).toBe(0)
    expect(stats.lastRates.size).toBe(0)
  })

  it('should start and stop correctly', async () => {
    // Start will trigger monitor loop
    await rateArb.start()
    expect(rateArb.running).toBe(true)

    rateArb.stop()
    expect(rateArb.running).toBe(false)
  })

  it('should have correct protocol list for mainnet', () => {
    const protocols = rateArb.protocols
    expect(protocols.length).toBe(3)
    expect(protocols.map((p) => p.name)).toContain('Aave V3')
    expect(protocols.map((p) => p.name)).toContain('Compound V3 USDC')
    expect(protocols.map((p) => p.name)).toContain('Spark')
  })

  it('should have correct protocol list for Base', () => {
    const baseArb = new RateArbitrage(
      {
        chainId: 8453,
        minSpreadBps: 10,
        checkIntervalMs: 60000,
        assets: [],
      },
      mockPublicClient,
    )
    const protocols = baseArb.protocols
    expect(protocols.length).toBe(2)
    expect(protocols.map((p) => p.name)).toContain('Aave V3')
    expect(protocols.map((p) => p.name)).toContain('Compound V3 USDC')
  })

  it('should emit opportunity events', () => {
    const handler = vi.fn()
    rateArb.on('opportunity', handler)

    rateArb.emit('opportunity', {
      asset: '0xUSDC' as Address,
      symbol: 'USDC',
      spreadBps: 50,
    })

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('should fetch Aave rates correctly', async () => {
    // Mock Aave getReserveData response
    mockReadContract.mockResolvedValue({
      currentLiquidityRate: 50000000000000000000000000n, // ~5% APY in ray
      currentVariableBorrowRate: 80000000000000000000000000n, // ~8% APY in ray
      liquidityIndex: 1000000000000000000000000000n,
    })

    const getAaveRate = rateArb.getAaveRate.bind(rateArb)
    const result = await getAaveRate(
      '0x87870Bca3F3fD6335C3F4ce8392D69350B4fA4E2' as Address,
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
    )

    expect(result).not.toBeNull()
    expect(typeof result?.supplyApy).toBe('number')
    expect(typeof result?.borrowApy).toBe('number')
    expect(typeof result?.utilization).toBe('number')
    expect(typeof result?.liquidity).toBe('bigint')
  })

  it('should fetch Compound rates correctly', async () => {
    // Mock Compound Comet responses
    mockReadContract
      .mockResolvedValueOnce(800000000000000000n) // utilization (80%)
      .mockResolvedValueOnce(1000000n * 10n ** 18n) // totalSupply
      .mockResolvedValueOnce(800000n * 10n ** 18n) // totalBorrow
      .mockResolvedValueOnce(1585489599n) // supplyRate per second
      .mockResolvedValueOnce(2536783359n) // borrowRate per second

    const getCompoundRate = rateArb.getCompoundRate.bind(rateArb)
    const result = await getCompoundRate(
      '0xc3d688B66703497DAA19211EEdff47f25384cdc3' as Address,
    )

    expect(result).not.toBeNull()
    expect(typeof result?.supplyApy).toBe('number')
    expect(typeof result?.borrowApy).toBe('number')
    expect(result?.utilization).toBeCloseTo(0.8, 1)
  })

  it('should return empty opportunities list initially', () => {
    const opportunities = rateArb.getOpportunities()
    expect(opportunities).toEqual([])
  })
})

describe('IntentSolver', () => {
  let solver: IntentSolver
  let mockFetch: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    mockFetch = vi.fn()
    global.fetch = mockFetch
    solver = new IntentSolver(
      {
        chainId: 1,
        protocols: ['cowswap', 'uniswapx'],
        minProfitBps: 10,
        solverAddress: '0x1234567890123456789012345678901234567890' as Address,
        privateKey:
          '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      },
      mockPublicClient,
    )
  })

  it('should initialize with correct config', () => {
    const stats = solver.getStats()
    expect(stats.pending).toBe(0)
    expect(stats.solved).toBe(0)
    expect(stats.totalProfit).toBe(0n)
  })

  it('should start and stop correctly', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.resolve([]),
    } as Response)

    await solver.start()
    expect(solver.running).toBe(true)

    solver.stop()
    expect(solver.running).toBe(false)
  })

  it('should fetch Cowswap orders correctly', async () => {
    const mockOrders = [
      {
        uid: 'order1',
        sellToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        buyToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
        sellAmount: '1000000000',
        buyAmount: '500000000000000000',
        validTo: Math.floor(Date.now() / 1000) + 3600,
        appData:
          '0x0000000000000000000000000000000000000000000000000000000000000000',
        feeAmount: '1000000',
        kind: 'sell',
        partiallyFillable: false,
        receiver: '0x1234567890123456789012345678901234567890',
        owner: '0x1234567890123456789012345678901234567890',
      },
    ]

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockOrders),
    } as Response)

    const fetchCowswap = solver.fetchCowswapOrders.bind(solver)
    const intents = await fetchCowswap()

    expect(intents.length).toBe(1)
    expect(intents[0].id).toBe('order1')
    expect(intents[0].protocol).toBe('cowswap')
  })

  it('should fetch UniswapX orders correctly', async () => {
    const mockResponse = {
      orders: [
        {
          orderHash: '0xhash1',
          chainId: 1,
          swapper: '0x1234567890123456789012345678901234567890',
          input: {
            token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
            amount: '1000000000',
          },
          outputs: [
            {
              token: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2',
              amount: '500000000000000000',
              recipient: '0x1234567890123456789012345678901234567890',
            },
          ],
          deadline: Math.floor(Date.now() / 1000) + 3600,
        },
      ],
    }

    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockResponse),
    } as Response)

    const fetchUniswapX = solver.fetchUniswapXOrders.bind(solver)
    const intents = await fetchUniswapX()

    expect(intents.length).toBe(1)
    expect(intents[0].id).toBe('0xhash1')
    expect(intents[0].protocol).toBe('uniswapx')
  })

  it('should return empty on API failure', async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: () => Promise.reject(new Error('API error')),
    } as Response)

    const fetchCowswap = solver.fetchCowswapOrders.bind(solver)
    const intents = await fetchCowswap()

    expect(intents).toEqual([])
  })

  it('should reject expired intents', async () => {
    const expiredIntent = {
      id: 'expired1',
      protocol: 'cowswap' as const,
      tokenIn: '0xUSDC' as Address,
      tokenOut: '0xWETH' as Address,
      amountIn: 1000000000n,
      minAmountOut: 500000000000000000n,
      deadline: BigInt(Math.floor(Date.now() / 1000) - 100), // Expired
      user: '0xuser' as Address,
      rawOrder: {} as Parameters<(typeof solver)['solve']>[0]['rawOrder'],
    }

    const solve = solver.solve.bind(solver)
    const solution = await solve(expiredIntent)

    expect(solution).toBeNull()
  })

  it('should get direct quotes from quoter', async () => {
    mockSimulateContract.mockResolvedValue({
      result: 550000000000000000n, // Better than minAmountOut
    } as unknown as Awaited<ReturnType<PublicClient['simulateContract']>>)

    const getDirectQuote = solver.getDirectQuote.bind(solver)
    const quote = await getDirectQuote(
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
      '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
      1000000000n,
    )

    expect(quote).toBe(550000000000000000n)
  })

  it('should emit solved events', () => {
    const handler = vi.fn()
    solver.on('solved', handler)

    solver.emit('solved', {
      intent: { id: 'test' },
      profit: 100n,
    })

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('should handle multi-hop quotes', async () => {
    // First hop
    mockSimulateContract
      .mockResolvedValueOnce({
        result: 500000000000000000n,
      } as unknown as Awaited<ReturnType<PublicClient['simulateContract']>>)
      // Second hop
      .mockResolvedValueOnce({
        result: 480000000n,
      } as unknown as Awaited<ReturnType<PublicClient['simulateContract']>>)

    const getMultiHopQuote = solver.getMultiHopQuote.bind(solver)
    const quote = await getMultiHopQuote(
      '0xUSDC' as Address,
      '0xWETH' as Address,
      '0xDAI' as Address,
      1000000000n,
    )

    expect(quote).toBe(480000000n)
  })
})

describe('Protocol Integration', () => {
  it('should export all protocol classes', async () => {
    const protocols = await import('./index')
    expect(protocols.RateArbitrage).toBeDefined()
    expect(protocols.IntentSolver).toBeDefined()
    expect(protocols.MEVShareClient).toBeDefined()
    expect(protocols.MorphoIntegration).toBeDefined()
    expect(protocols.BuilderClient).toBeDefined()
  })

  it('all protocols should implement EventEmitter pattern', () => {
    const rateArb = new RateArbitrage(
      {
        chainId: 1,
        minSpreadBps: 10,
        checkIntervalMs: 60000,
        assets: [],
      },
      mockPublicClient,
    )

    const solver = new IntentSolver(
      {
        chainId: 1,
        protocols: ['cowswap'],
        minProfitBps: 10,
        solverAddress: '0x1234' as Address,
        privateKey: '0xprivkey',
      },
      mockPublicClient,
    )

    // All should have event emitter methods
    expect(typeof rateArb.on).toBe('function')
    expect(typeof rateArb.emit).toBe('function')
    expect(typeof solver.on).toBe('function')
    expect(typeof solver.emit).toBe('function')
  })

  it('all protocols should have start/stop lifecycle', () => {
    const rateArb = new RateArbitrage(
      {
        chainId: 1,
        minSpreadBps: 10,
        checkIntervalMs: 60000,
        assets: [],
      },
      mockPublicClient,
    )

    const solver = new IntentSolver(
      {
        chainId: 1,
        protocols: ['cowswap'],
        minProfitBps: 10,
        solverAddress: '0x1234' as Address,
        privateKey: '0xprivkey',
      },
      mockPublicClient,
    )

    expect(typeof rateArb.start).toBe('function')
    expect(typeof rateArb.stop).toBe('function')
    expect(typeof solver.start).toBe('function')
    expect(typeof solver.stop).toBe('function')
  })

  it('all protocols should have getStats method', () => {
    const rateArb = new RateArbitrage(
      {
        chainId: 1,
        minSpreadBps: 10,
        checkIntervalMs: 60000,
        assets: [],
      },
      mockPublicClient,
    )

    const solver = new IntentSolver(
      {
        chainId: 1,
        protocols: ['cowswap'],
        minProfitBps: 10,
        solverAddress: '0x1234' as Address,
        privateKey: '0xprivkey',
      },
      mockPublicClient,
    )

    expect(typeof rateArb.getStats).toBe('function')
    expect(typeof solver.getStats).toBe('function')

    // Stats should return meaningful data
    const rateStats = rateArb.getStats()
    expect(rateStats).toHaveProperty('protocols')
    expect(rateStats).toHaveProperty('opportunities')

    const solverStats = solver.getStats()
    expect(solverStats).toHaveProperty('pending')
    expect(solverStats).toHaveProperty('solved')
    expect(solverStats).toHaveProperty('totalProfit')
  })
})
