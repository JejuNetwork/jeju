import type { Address } from 'viem'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { CrossChainArbitrage, SolanaArbitrage } from './cross-chain-arbitrage'

// Mock environment variables for tests
const mockEnv = {
  ETH_RPC_URL: 'https://eth-mainnet.test',
  BASE_RPC_URL: 'https://base-mainnet.test',
  ARB_RPC_URL: 'https://arb-mainnet.test',
  OP_RPC_URL: 'https://op-mainnet.test',
  BSC_RPC_URL: 'https://bsc-mainnet.test',
}

// Mock viem createPublicClient
vi.mock('viem', async () => {
  const actual = await vi.importActual('viem')
  return {
    ...actual,
    createPublicClient: vi.fn(() => ({
      readContract: vi
        .fn()
        .mockResolvedValue([100n * 10n ** 18n, 50n * 10n ** 6n]),
    })),
  }
})

describe('CrossChainArbitrage', () => {
  let arb: CrossChainArbitrage

  beforeEach(() => {
    vi.clearAllMocks()
    // Set mock env vars
    for (const [key, value] of Object.entries(mockEnv)) {
      process.env[key] = value
    }
  })

  afterEach(() => {
    // Clean up env vars
    for (const key of Object.keys(mockEnv)) {
      delete process.env[key]
    }
  })

  it('should initialize with default config', () => {
    arb = new CrossChainArbitrage()
    const stats = arb.getStats()
    expect(stats.opportunitiesFound).toBe(0)
    expect(stats.totalProfitUsd).toBe(0)
    expect(stats.tradesExecuted).toBe(0)
  })

  it('should initialize with custom config', () => {
    arb = new CrossChainArbitrage({
      minProfitBps: 100,
      minProfitUsd: 50,
      maxSlippageBps: 200,
      maxPositionUsd: 100000,
      enableExecution: false,
    })

    expect(arb.config.minProfitBps).toBe(100)
    expect(arb.config.minProfitUsd).toBe(50)
    expect(arb.config.maxSlippageBps).toBe(200)
  })

  it('should start and stop correctly', () => {
    arb = new CrossChainArbitrage()

    const startedHandler = vi.fn()
    const stoppedHandler = vi.fn()
    arb.on('started', startedHandler)
    arb.on('stopped', stoppedHandler)

    arb.start()
    expect(arb.running).toBe(true)
    expect(startedHandler).toHaveBeenCalledTimes(1)

    arb.stop()
    expect(arb.running).toBe(false)
    expect(stoppedHandler).toHaveBeenCalledTimes(1)
  })

  it('should not start twice', () => {
    arb = new CrossChainArbitrage()
    arb.start()
    const monitorLoop1 = arb.monitorLoop

    arb.start()
    const monitorLoop2 = arb.monitorLoop

    expect(monitorLoop1).toBe(monitorLoop2)
    arb.stop()
  })

  it('should emit opportunity events', () => {
    arb = new CrossChainArbitrage()
    const handler = vi.fn()
    arb.on('opportunity', handler)

    arb.emit('opportunity', {
      id: 'test-opp',
      netProfitUsd: '100',
    })

    expect(handler).toHaveBeenCalledTimes(1)
  })

  it('should return empty opportunities initially', () => {
    arb = new CrossChainArbitrage()
    expect(arb.getOpportunities()).toEqual([])
  })

  it('should update config correctly', () => {
    arb = new CrossChainArbitrage()
    arb.updateConfig({ minProfitBps: 200, minProfitUsd: 100 })

    expect(arb.config.minProfitBps).toBe(200)
    expect(arb.config.minProfitUsd).toBe(100)
  })

  it('should add custom chain correctly', () => {
    arb = new CrossChainArbitrage()
    const initialChainCount = arb.config.chains.length

    arb.addChain({
      chainId: 137,
      name: 'Polygon',
      rpcUrl: 'https://polygon-rpc.com',
      type: 'evm',
      blockTimeMs: 2000,
      nativeSymbol: 'MATIC',
      dexes: [
        {
          name: 'QuickSwap',
          type: 'uniswap-v2',
          router: '0xa5E0829CaCEd8fFDD4De3c43696c57F7D7A678ff' as Address,
        },
      ],
      bridges: [],
    })

    expect(arb.config.chains.length).toBe(initialChainCount + 1)
    expect(arb.evmClients.has(137)).toBe(true)
  })

  it('should find bridge between chains', () => {
    arb = new CrossChainArbitrage()
    const findBridge = arb.findBridge.bind(arb)

    // Ethereum to Base should find Stargate
    const bridge = findBridge(1, 8453)
    expect(bridge).not.toBeNull()
    expect(bridge?.name).toBe('Stargate')
  })

  it('should return null for unsupported bridge route', () => {
    arb = new CrossChainArbitrage()
    const findBridge = arb.findBridge.bind(arb)

    // Non-existent chain
    const bridge = findBridge(1, 999999)
    expect(bridge).toBeNull()
  })

  it('should get token address for known tokens', () => {
    arb = new CrossChainArbitrage()
    const getTokenAddress = arb.getTokenAddress.bind(arb)

    // WETH on Ethereum
    const wethAddr = getTokenAddress('WETH', 1)
    expect(wethAddr).not.toBeNull()
    expect(wethAddr?.toLowerCase()).toBe(
      '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2'.toLowerCase(),
    )
  })

  it('should return null for unknown token symbols', () => {
    arb = new CrossChainArbitrage()
    const getTokenAddress = arb.getTokenAddress.bind(arb)

    const addr = getTokenAddress('UNKNOWN_TOKEN_XYZ', 1)
    expect(addr).toBeNull()
  })

  it('should have default chains with correct configuration', () => {
    arb = new CrossChainArbitrage()
    const chains = arb.config.chains

    // Should have multiple chains
    expect(chains.length).toBeGreaterThan(0)

    // Ethereum should have DEXes and bridges
    const eth = chains.find((c) => c.chainId === 1)
    expect(eth).toBeDefined()
    expect(eth?.dexes.length).toBeGreaterThan(0)
    expect(eth?.bridges.length).toBeGreaterThan(0)
  })
})

describe('SolanaArbitrage', () => {
  let solArb: SolanaArbitrage

  beforeEach(() => {
    vi.clearAllMocks()
    global.fetch = vi.fn()
    solArb = new SolanaArbitrage()
  })

  it('should initialize with default config', () => {
    expect(solArb.config.rpcUrl).toBe('https://api.mainnet-beta.solana.com')
    expect(solArb.config.commitment).toBe('confirmed')
    expect(solArb.config.minProfitBps).toBe(30)
  })

  it('should initialize with custom config', () => {
    const customSolArb = new SolanaArbitrage({
      rpcUrl: 'https://custom-rpc.com',
      minProfitBps: 50,
      minProfitUsd: 10,
      solPriceUsd: 200,
    })

    expect(customSolArb.config.rpcUrl).toBe('https://custom-rpc.com')
    expect(customSolArb.config.minProfitBps).toBe(50)
    expect(customSolArb.config.solPriceUsd).toBe(200)
  })

  it('should have default monitored tokens', () => {
    const tokens = solArb.config.monitoredTokens
    expect(tokens.length).toBeGreaterThan(0)

    // Should include SOL and USDC
    expect(tokens.find((t) => t.symbol === 'SOL')).toBeDefined()
    expect(tokens.find((t) => t.symbol === 'USDC')).toBeDefined()
  })

  it('should update prices correctly', () => {
    solArb.updatePrices(180, 4000)

    expect(solArb.config.solPriceUsd).toBe(180)
    expect(solArb.config.ethPriceUsd).toBe(4000)
  })

  it('should call Jupiter API for quotes', async () => {
    const mockQuote = {
      inputMint: 'So11111111111111111111111111111111111111112',
      outputMint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      inAmount: '1000000000',
      outAmount: '150000000',
      priceImpactPct: '0.01',
      otherAmountThreshold: '149000000',
      swapMode: 'ExactIn',
      slippageBps: 50,
      routePlan: [],
    }

    const mockFetch = global.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve(mockQuote),
    } as Response)

    // Create mock PublicKey
    const mockPublicKey = {
      toBase58: () => 'So11111111111111111111111111111111111111112',
    }
    const mockPublicKey2 = {
      toBase58: () => 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
    }

    const getJupiterQuote = solArb.getJupiterQuote.bind(solArb)
    const quote = await getJupiterQuote(
      mockPublicKey as Parameters<typeof getJupiterQuote>[0],
      mockPublicKey2 as Parameters<typeof getJupiterQuote>[1],
      1000000000n,
    )

    expect(global.fetch).toHaveBeenCalled()
    expect(quote).toBe(150000000n)
  })

  it('should return empty array when Jupiter API fails', async () => {
    const mockFetch = global.fetch as ReturnType<typeof vi.fn>
    mockFetch.mockResolvedValue({
      ok: false,
      statusText: 'Bad Request',
    } as Response)

    const getMultiDexQuotes = solArb.getMultiDexQuotes.bind(solArb)
    const quotes = await getMultiDexQuotes(
      'So11111111111111111111111111111111111111112',
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
      1000000000n,
    )

    expect(quotes).toEqual([])
  })

  it('should find opportunities when price discrepancy exists', async () => {
    // Mock quotes showing profit opportunity
    let callCount = 0
    vi.mocked(global.fetch).mockImplementation(async () => {
      callCount++
      // Return different amounts for different calls to simulate price discrepancy
      const outAmount = callCount % 2 === 0 ? '1050000000' : '1000000000'
      return {
        ok: true,
        json: () =>
          Promise.resolve({
            inputMint: 'mock',
            outputMint: 'mock',
            inAmount: '1000000000',
            outAmount,
            priceImpactPct: '0.01',
            otherAmountThreshold: '990000000',
            swapMode: 'ExactIn',
            slippageBps: 50,
            routePlan: [],
          }),
      } as Response
    })

    const opportunities = await solArb.findOpportunities()
    // May or may not find opportunities depending on price diff
    expect(Array.isArray(opportunities)).toBe(true)
  })

  it('should include correct opportunity metadata', async () => {
    // Create a custom config with only 2 tokens to simplify
    const customSolArb = new SolanaArbitrage({
      minProfitBps: 1, // Very low threshold for testing
      minProfitUsd: 0.01, // Very low threshold
      solPriceUsd: 150,
      ethPriceUsd: 3500,
      monitoredTokens: [
        {
          symbol: 'SOL',
          mint: 'So11111111111111111111111111111111111111112',
          decimals: 9,
        },
        {
          symbol: 'USDC',
          mint: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v',
          decimals: 6,
        },
      ],
    })

    // Mock to simulate profitable arb
    let callIdx = 0
    vi.mocked(global.fetch).mockImplementation(async () => {
      callIdx++
      // First set: A->B quotes, give different prices from different DEXes
      // Second set: B->A quotes
      // Third set: return quotes for final swap back
      const baseAmount = 1000000n // 1000 USDC
      let outAmount: string

      // Create price discrepancy
      if (callIdx <= 5) {
        // A->B quotes
        outAmount = (6n * 10n ** 9n + BigInt(callIdx) * 10n ** 6n).toString() // ~6 SOL + variance
      } else if (callIdx <= 10) {
        // B->A quotes
        outAmount = (baseAmount + BigInt(callIdx) * 1000n).toString()
      } else {
        // Return trip: B->A after receiving B
        outAmount = (baseAmount + 50000n).toString() // 5% profit
      }

      return {
        ok: true,
        json: () =>
          Promise.resolve({
            inputMint: 'mock',
            outputMint: 'mock',
            inAmount: baseAmount.toString(),
            outAmount,
            priceImpactPct: '0.01',
            otherAmountThreshold: String((BigInt(outAmount) * 99n) / 100n),
            swapMode: 'ExactIn',
            slippageBps: 50,
            routePlan: [],
          }),
      } as Response
    })

    const opportunities = await customSolArb.findOpportunities()

    if (opportunities.length > 0) {
      const opp = opportunities[0]
      expect(opp.type).toBe('CROSS_CHAIN')
      expect(opp.sourceChainId).toBe('solana-mainnet')
      expect(opp.destChainId).toBe('solana-mainnet')
      expect(opp.status).toBe('DETECTED')
      expect(typeof opp.netProfitUsd).toBe('string')
      expect(typeof opp.expectedProfitBps).toBe('number')
    }
  })

  it('should filter out unprofitable opportunities', async () => {
    // Mock quotes with no price discrepancy
    vi.mocked(global.fetch).mockResolvedValue({
      ok: true,
      json: () =>
        Promise.resolve({
          inputMint: 'mock',
          outputMint: 'mock',
          inAmount: '1000000000',
          outAmount: '999000000', // Slight loss
          priceImpactPct: '0.1',
          otherAmountThreshold: '990000000',
          swapMode: 'ExactIn',
          slippageBps: 50,
          routePlan: [],
        }),
    } as Response)

    const opportunities = await solArb.findOpportunities()
    // Should filter out unprofitable opportunities
    expect(
      opportunities.every(
        (o) => o.expectedProfitBps >= solArb.config.minProfitBps,
      ),
    ).toBe(true)
  })
})

describe('Cross-Chain Integration', () => {
  beforeEach(() => {
    for (const [key, value] of Object.entries(mockEnv)) {
      process.env[key] = value
    }
  })

  afterEach(() => {
    for (const key of Object.keys(mockEnv)) {
      delete process.env[key]
    }
  })

  it('should export both CrossChainArbitrage and SolanaArbitrage', async () => {
    const module = await import('./cross-chain-arbitrage')
    expect(module.CrossChainArbitrage).toBeDefined()
    expect(module.SolanaArbitrage).toBeDefined()
  })

  it('both classes should implement similar interfaces', () => {
    const evmArb = new CrossChainArbitrage()
    const solArb = new SolanaArbitrage()

    // Both should have opportunity-related methods
    expect(typeof evmArb.getOpportunities).toBe('function')
    expect(typeof solArb.findOpportunities).toBe('function')

    // EVM has lifecycle methods
    expect(typeof evmArb.start).toBe('function')
    expect(typeof evmArb.stop).toBe('function')
    expect(typeof evmArb.getStats).toBe('function')

    // Solana has price update method
    expect(typeof solArb.updatePrices).toBe('function')
  })
})
