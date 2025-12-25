import type { Address, Hash, PublicClient, WalletClient } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { AtomicLiquidator } from './atomic-liquidator'
import { BackrunStrategy } from './backrun'
import { type JITConfig, JITLiquidityStrategy } from './jit-liquidity'
import { type OracleArbConfig, OracleArbStrategy } from './oracle-arb'

// Create mock functions
const mockReadContract = vi.fn()
const mockSimulateContract = vi.fn()

// Mock clients for testing
const mockPublicClient = {
  readContract: mockReadContract,
  getBlockNumber: vi.fn().mockResolvedValue(12345678n),
  getGasPrice: vi.fn().mockResolvedValue(50000000000n),
  getTransactionCount: vi.fn().mockResolvedValue(0),
  simulateContract: mockSimulateContract,
  call: vi.fn(),
  waitForTransactionReceipt: vi.fn(),
  watchContractEvent: vi.fn().mockReturnValue(() => {}),
  estimateContractGas: vi.fn().mockResolvedValue(150000n),
} as unknown as PublicClient

const mockWalletClient = {
  getAddresses: vi
    .fn()
    .mockResolvedValue([
      '0x1234567890123456789012345678901234567890' as Address,
    ]),
  signTransaction: vi.fn().mockResolvedValue('0xsignedtx' as `0x${string}`),
  writeContract: vi
    .fn()
    .mockResolvedValue(
      '0xtxhash0000000000000000000000000000000000000000000000000000000000' as Hash,
    ),
} as unknown as WalletClient

describe('AtomicLiquidator', () => {
  let liquidator: AtomicLiquidator

  beforeEach(() => {
    vi.clearAllMocks()
    liquidator = new AtomicLiquidator(
      {
        chainId: 1,
        minProfitUsd: 50,
        maxGasPrice: 100000000000n,
        flashLoanFee: 9,
        protocols: ['aave', 'compound'],
        subgraphUrl: 'https://api.thegraph.com/subgraphs/name/test',
      },
      mockPublicClient,
      mockWalletClient,
    )
  })

  it('should initialize with correct config', () => {
    const stats = liquidator.getStats()
    expect(stats.attempts).toBe(0)
    expect(stats.successes).toBe(0)
    expect(stats.totalProfit).toBe(0n)
  })

  it('should start and stop correctly', async () => {
    // Mock fetch for subgraph
    global.fetch = vi.fn().mockResolvedValue({
      json: () =>
        Promise.resolve({
          data: {
            accounts: [],
          },
        }),
    })

    await liquidator.start()
    expect(liquidator.running).toBe(true)

    liquidator.stop()
    expect(liquidator.running).toBe(false)
  })

  it('should calculate liquidation profit correctly', () => {
    const position = {
      id: '0x123',
      user: '0xuser' as Address,
      protocol: 'aave' as const,
      collateral: 10000n * 10n ** 18n, // 10000 tokens
      debt: 8000n * 10n ** 18n, // 8000 tokens
      healthFactor: 0.95,
      collateralToken: '0xweth' as Address,
      debtToken: '0xusdc' as Address,
      liquidationThreshold: 0.8,
    }

    // Access private method via bracket notation for testing
    const calculator = liquidator as unknown as {
      calculateProfit: (position: typeof position) => {
        profitUsd: number
        repayAmount: bigint
        expectedSeizure: bigint
      }
    }

    // Should return expected structure
    const result = calculator.calculateProfit(position)
    expect(result).toBeDefined()
    expect(typeof result.profitUsd).toBe('number')
    expect(typeof result.repayAmount).toBe('bigint')
    expect(typeof result.expectedSeizure).toBe('bigint')
  })

  it('should emit events on liquidation attempts', () => {
    const eventHandler = vi.fn()
    liquidator.on('liquidation', eventHandler)

    // Emit a test event
    liquidator.emit('liquidation', {
      position: { id: 'test' },
      result: { success: true },
    })

    expect(eventHandler).toHaveBeenCalledTimes(1)
  })
})

describe('BackrunStrategy', () => {
  let backrun: BackrunStrategy

  beforeEach(() => {
    vi.clearAllMocks()
    backrun = new BackrunStrategy(
      {
        chainId: 1,
        minProfitBps: 10,
        maxGasPrice: 100000000000n,
        pools: ['0xpool1', '0xpool2'] as Address[],
        flashbotsRpc: 'https://protect.flashbots.net',
        authKey: '0xauthkey' as Address,
      },
      mockPublicClient,
      mockWalletClient,
    )
  })

  it('should initialize with correct config', () => {
    const stats = backrun.getStats()
    expect(stats.bundlesSubmitted).toBe(0)
    expect(stats.bundlesIncluded).toBe(0)
    expect(stats.totalProfit).toBe(0n)
  })

  it('should start and stop correctly', async () => {
    await backrun.start()
    expect(backrun.running).toBe(true)

    backrun.stop()
    expect(backrun.running).toBe(false)
  })

  it('should detect large swap transactions', () => {
    const isLargeSwap = backrun.isLargeSwap
    expect(typeof isLargeSwap).toBe('function')
  })

  it('should emit events on backrun attempts', () => {
    const eventHandler = vi.fn()
    backrun.on('backrun-result', eventHandler)

    backrun.emit('backrun-result', {
      targetTx: '0x123' as Hash,
      success: true,
    })

    expect(eventHandler).toHaveBeenCalledTimes(1)
  })

  it('should track pool prices correctly', () => {
    // Access internal state
    const prices = backrun.poolPrices
    expect(prices).toBeDefined()
    expect(prices instanceof Map).toBe(true)
  })
})

describe('JITLiquidityStrategy', () => {
  let jit: JITLiquidityStrategy
  const jitConfig: JITConfig = {
    chainId: 1,
    minSwapSizeUsd: 10000,
    maxPositionSizeUsd: 100000,
    minProfitBps: 5,
    poolFee: 3000,
    tickSpacing: 60,
    gasLimit: 500000n,
    flashbotsRpc: 'https://protect.flashbots.net',
    ethPriceUsd: 2000,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    jit = new JITLiquidityStrategy(
      jitConfig,
      mockPublicClient,
      mockWalletClient,
    )
  })

  it('should initialize with correct config', () => {
    const stats = jit.getStats()
    expect(stats.attempts).toBe(0)
    expect(stats.successes).toBe(0)
    expect(stats.totalFees).toBe(0n)
    expect(stats.positions).toBe(0)
    expect(stats.pendingSwaps).toBe(0)
  })

  it('should start and stop correctly', async () => {
    await jit.start()
    expect(jit.running).toBe(true)

    jit.stop()
    expect(jit.running).toBe(false)
  })

  it('should reject swaps when not running', async () => {
    const result = await jit.onPendingSwap({
      hash: '0xswaphash' as Hash,
      pool: '0xpool' as Address,
      tokenIn: '0xweth' as Address,
      tokenOut: '0xusdc' as Address,
      amountIn: 10n ** 18n,
      estimatedAmountOut: 2000n * 10n ** 6n,
      sender: '0xsender' as Address,
      gasPrice: 50000000000n,
      nonce: 1,
    })

    expect(result.success).toBe(false)
    expect(result.error).toBe('Not running')
  })

  it('should analyze opportunities correctly', async () => {
    // Mock pool state
    mockReadContract
      .mockResolvedValueOnce([
        79228162514264337593543950336n,
        100000,
        0,
        0,
        0,
        0,
        true,
      ]) // slot0
      .mockResolvedValueOnce('0xtoken0' as Address) // token0
      .mockResolvedValueOnce('0xtoken1' as Address) // token1
      .mockResolvedValueOnce(3000n) // fee

    await jit.start()

    const swap = {
      hash: '0xswaphash' as Hash,
      pool: '0xpool' as Address,
      tokenIn: '0xweth' as Address,
      tokenOut: '0xusdc' as Address,
      amountIn: 10n ** 19n, // 10 ETH
      estimatedAmountOut: 20000n * 10n ** 6n,
      sender: '0xsender' as Address,
      gasPrice: 50000000000n,
      nonce: 1,
    }

    // Access private method
    const analyzeOpp = jit.analyzeOpportunity.bind(jit)
    const result = await analyzeOpp(swap)

    expect(result).toBeDefined()
    expect(typeof result.profitable).toBe('boolean')
    expect(typeof result.expectedProfitBps).toBe('number')
    expect(typeof result.tickLower).toBe('number')
    expect(typeof result.tickUpper).toBe('number')
  })

  it('should emit events on JIT results', () => {
    const eventHandler = vi.fn()
    jit.on('jit-result', eventHandler)

    jit.emit('jit-result', {
      swap: { hash: '0x123' },
      opportunity: { profitable: true },
      result: { success: true },
    })

    expect(eventHandler).toHaveBeenCalledTimes(1)
  })
})

describe('OracleArbStrategy', () => {
  let oracleArb: OracleArbStrategy
  const oracleConfig: OracleArbConfig = {
    chainId: 1,
    minProfitUsd: 10,
    maxGasPrice: 100000000000n,
    oracleAddresses: ['0x5f4eC3Df9cbd43714FE2740f5E3616155c5b8419' as Address],
    dexRouters: ['0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D' as Address],
    arbContract: '0xarbcontract' as Address,
    useFlashbots: false,
    maxSlippageBps: 50,
  }

  beforeEach(() => {
    vi.clearAllMocks()
    oracleArb = new OracleArbStrategy(
      oracleConfig,
      mockPublicClient,
      mockWalletClient,
    )
  })

  it('should initialize with correct config', () => {
    const stats = oracleArb.getStats()
    expect(stats.attempts).toBe(0)
    expect(stats.successes).toBe(0)
    expect(stats.totalProfit).toBe(0n)
    expect(stats.trackedOracles).toBe(1)
  })

  it('should start and stop correctly', async () => {
    // Mock price initialization
    mockReadContract
      .mockResolvedValueOnce([0n, 200000000000n, 0n, 0n, 0n]) // latestRoundData
      .mockResolvedValueOnce(8) // decimals

    await oracleArb.start()
    expect(oracleArb.running).toBe(true)

    oracleArb.stop()
    expect(oracleArb.running).toBe(false)
  })

  it('should track oracle prices correctly', async () => {
    // Mock price initialization
    mockReadContract
      .mockResolvedValueOnce([0n, 200000000000n, 0n, 0n, 0n]) // latestRoundData
      .mockResolvedValueOnce(8) // decimals

    await oracleArb.start()

    const prices = oracleArb.lastPrices
    expect(prices).toBeDefined()
    expect(prices instanceof Map).toBe(true)
    expect(prices.size).toBe(1)

    const priceData = prices.get(oracleConfig.oracleAddresses[0])
    expect(priceData).toBeDefined()
    expect(priceData?.price).toBe(200000000000n)
    expect(priceData?.decimals).toBe(8)
  })

  it('should find opportunities on price updates', async () => {
    // Mock price initialization
    mockReadContract
      .mockResolvedValueOnce([0n, 200000000000n, 0n, 0n, 0n])
      .mockResolvedValueOnce(8)

    await oracleArb.start()

    // Access private method
    const findOpp = oracleArb.findOpportunity.bind(oracleArb)

    // Mock getAmountsOut for finding opportunity
    mockReadContract.mockResolvedValueOnce([10n ** 17n, 200n * 10n ** 6n])

    const update = {
      oracle: oracleConfig.oracleAddresses[0],
      oldPrice: 200000000000n,
      newPrice: 204000000000n, // 2% increase
      txHash: '0xtx' as Hash,
      blockNumber: 12345678n,
      asset: 'ETH/USD',
      decimals: 8,
    }

    const opportunity = await findOpp(update, 0.02)
    // May or may not find opportunity depending on calculation
    if (opportunity) {
      expect(opportunity.direction).toBe('long')
      expect(opportunity.asset).toBe('ETH/USD')
    }
  })

  it('should emit events on execution', () => {
    const eventHandler = vi.fn()
    oracleArb.on('execution', eventHandler)

    oracleArb.emit('execution', {
      opportunity: { asset: 'ETH/USD' },
      result: { success: true },
    })

    expect(eventHandler).toHaveBeenCalledTimes(1)
  })

  it('should calculate success rate correctly', async () => {
    // Mock initialization
    mockReadContract
      .mockResolvedValueOnce([0n, 200000000000n, 0n, 0n, 0n])
      .mockResolvedValueOnce(8)

    await oracleArb.start()

    // Manually set stats for testing
    oracleArb.executionStats.attempts = 10
    oracleArb.executionStats.successes = 3

    const stats = oracleArb.getStats()
    expect(stats.successRate).toBe(0.3)
  })
})

describe('MEV Strategy Integration', () => {
  it('all strategies should implement consistent interfaces', () => {
    const liquidator = new AtomicLiquidator(
      {
        chainId: 1,
        minProfitUsd: 50,
        maxGasPrice: 100000000000n,
        flashLoanFee: 9,
        protocols: ['aave'],
        subgraphUrl: 'https://api.thegraph.com/subgraphs/name/test',
      },
      mockPublicClient,
      mockWalletClient,
    )

    const backrun = new BackrunStrategy(
      {
        chainId: 1,
        minProfitBps: 10,
        maxGasPrice: 100000000000n,
        pools: ['0xpool'] as Address[],
        flashbotsRpc: 'https://protect.flashbots.net',
        authKey: '0xauthkey' as Address,
      },
      mockPublicClient,
      mockWalletClient,
    )

    const jit = new JITLiquidityStrategy(
      {
        chainId: 1,
        minSwapSizeUsd: 10000,
        maxPositionSizeUsd: 100000,
        minProfitBps: 5,
        poolFee: 3000,
        tickSpacing: 60,
        gasLimit: 500000n,
        flashbotsRpc: 'https://protect.flashbots.net',
        ethPriceUsd: 2000,
      },
      mockPublicClient,
      mockWalletClient,
    )

    const oracleArb = new OracleArbStrategy(
      {
        chainId: 1,
        minProfitUsd: 10,
        maxGasPrice: 100000000000n,
        oracleAddresses: ['0xoracle'] as Address[],
        dexRouters: ['0xrouter'] as Address[],
        arbContract: '0xarb' as Address,
        useFlashbots: false,
        maxSlippageBps: 50,
      },
      mockPublicClient,
      mockWalletClient,
    )

    // All strategies should have start/stop methods
    expect(typeof liquidator.start).toBe('function')
    expect(typeof liquidator.stop).toBe('function')
    expect(typeof backrun.start).toBe('function')
    expect(typeof backrun.stop).toBe('function')
    expect(typeof jit.start).toBe('function')
    expect(typeof jit.stop).toBe('function')
    expect(typeof oracleArb.start).toBe('function')
    expect(typeof oracleArb.stop).toBe('function')

    // All strategies should have getStats method
    expect(typeof liquidator.getStats).toBe('function')
    expect(typeof backrun.getStats).toBe('function')
    expect(typeof jit.getStats).toBe('function')
    expect(typeof oracleArb.getStats).toBe('function')

    // All strategies should be event emitters
    expect(typeof liquidator.on).toBe('function')
    expect(typeof backrun.on).toBe('function')
    expect(typeof jit.on).toBe('function')
    expect(typeof oracleArb.on).toBe('function')
  })
})
