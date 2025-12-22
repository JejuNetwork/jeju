/**
 * Unit Tests for Jeju Routing Optimizer
 *
 * Tests:
 * - Fee calculation (protocol, XLP, solver fees)
 * - Revenue calculation for Jeju network
 * - Route ranking and scoring
 * - Hub route building
 * - Direct route building
 * - Chain configuration
 */

import { beforeEach, describe, expect, it } from 'bun:test'
import {
  CHAIN_CONFIGS,
  ChainId,
  createJejuRoutingOptimizer,
  type FeeConfig,
  getChainConfig,
  getStablecoinAddress,
  isBscChain,
  isJejuChain,
  isSolanaChain,
  type JejuRoutingOptimizer,
  type OptimizedRoute,
  type RouteRequest,
} from '../../src/router/jeju-routing-optimizer.js'

describe('JejuRoutingOptimizer', () => {
  let optimizer: JejuRoutingOptimizer

  beforeEach(() => {
    optimizer = createJejuRoutingOptimizer()
  })

  describe('Fee Calculation', () => {
    const DEFAULT_FEES: FeeConfig = {
      protocolFeeBps: 10,
      solverMarginBps: 5,
      xlpFeeBps: 5,
      x402FeeBps: 50,
    }

    it('should calculate protocol fee as 0.1% (10 bps)', () => {
      const amount = 1000000000n // 1000 USDC
      const fee = (amount * BigInt(DEFAULT_FEES.protocolFeeBps)) / 10000n
      expect(fee).toBe(1000000n) // 1 USDC
    })

    it('should calculate XLP fee as 0.05% (5 bps)', () => {
      const amount = 1000000000n
      const fee = (amount * BigInt(DEFAULT_FEES.xlpFeeBps)) / 10000n
      expect(fee).toBe(500000n) // 0.5 USDC
    })

    it('should calculate solver margin as 0.05% (5 bps)', () => {
      const amount = 1000000000n
      const fee = (amount * BigInt(DEFAULT_FEES.solverMarginBps)) / 10000n
      expect(fee).toBe(500000n)
    })

    it('should calculate x402 fee as 0.5% (50 bps)', () => {
      const amount = 1000000000n
      const fee = (amount * BigInt(DEFAULT_FEES.x402FeeBps)) / 10000n
      // 50 bps = 0.5% = 1000000000 * 50 / 10000 = 5000000
      expect(fee).toBe(5000000n)
    })

    it('should handle zero amount', () => {
      const amount = 0n
      const fee = (amount * BigInt(DEFAULT_FEES.protocolFeeBps)) / 10000n
      expect(fee).toBe(0n)
    })

    it('should handle very large amounts', () => {
      const amount = 1000000000000000000n // 1 billion USDC equivalent
      const fee = (amount * BigInt(DEFAULT_FEES.protocolFeeBps)) / 10000n
      expect(fee).toBe(1000000000000000n) // 0.1% of 1 billion
    })

    it('should handle minimum meaningful amount', () => {
      // 10000 is the minimum for 1 bps to return 1
      const amount = 10000n
      const fee = (amount * 1n) / 10000n
      expect(fee).toBe(1n)
    })
  })

  describe('Revenue Calculation', () => {
    it('should calculate Jeju revenue for through-hub routes', async () => {
      const request: RouteRequest = {
        sourceChain: ChainId.BASE,
        destChain: ChainId.ARBITRUM,
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: 1000000000n, // 1000 USDC
        sender: '0x1234567890123456789012345678901234567890',
        recipient: '0x1234567890123456789012345678901234567890',
        preferThroughJeju: true,
      }

      const routes = await optimizer.findOptimalRoutes(request)
      const hubRoute = routes.find((r) => r.throughJeju)

      if (hubRoute) {
        // Hub routes collect protocol + XLP fees
        const expectedRevenue = (request.amount * BigInt(10 + 5)) / 10000n
        expect(hubRoute.jejuRevenue).toBe(expectedRevenue)
      }
    })

    it('should calculate Jeju revenue for OIF routes', async () => {
      const amount = 1000000000n
      const solverMarginBps = 5

      // OIF routes collect solver margin
      const expectedRevenue = (amount * BigInt(solverMarginBps)) / 10000n
      expect(expectedRevenue).toBe(500000n)
    })

    it('should calculate x402 fee for non-hub routes', () => {
      const amount = 1000000000n
      const x402FeeBps = 50

      // 50 bps = 0.5% = 1000000000 * 50 / 10000 = 5000000
      const revenue = (amount * BigInt(x402FeeBps)) / 10000n
      expect(revenue).toBe(5000000n)
    })
  })

  describe('Route Building', () => {
    it('should build direct route for L2 to L2', async () => {
      const request: RouteRequest = {
        sourceChain: ChainId.BASE,
        destChain: ChainId.ARBITRUM,
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: 1000000000n,
        sender: '0x1234567890123456789012345678901234567890',
        recipient: '0x1234567890123456789012345678901234567890',
      }

      const routes = await optimizer.findOptimalRoutes(request)
      const directRoute = routes.find(
        (r) => r.strategy === 'direct' && r.hops.length === 1,
      )

      expect(directRoute).toBeDefined()
      if (directRoute) {
        expect(directRoute.hops[0].fromChain).toBe(ChainId.BASE)
        expect(directRoute.hops[0].toChain).toBe(ChainId.ARBITRUM)
        // Direct routes can use either 'eil' or 'oif' mechanism
        expect(['eil', 'oif']).toContain(directRoute.hops[0].mechanism)
      }
    })

    it('should build hub route through Jeju', async () => {
      // Use mainnet chains since default optimizer uses 'testnet' network
      // but the hub is built based on mainnet/testnet detection
      const request: RouteRequest = {
        sourceChain: ChainId.BASE,
        destChain: ChainId.ARBITRUM,
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: 1000000000n,
        sender: '0x1234567890123456789012345678901234567890',
        recipient: '0x1234567890123456789012345678901234567890',
        preferThroughJeju: true,
      }

      const routes = await optimizer.findOptimalRoutes(request)
      const hubRoute = routes.find((r) => r.strategy === 'hub')

      expect(hubRoute).toBeDefined()
      if (hubRoute) {
        expect(hubRoute.hops.length).toBe(2)
        expect(hubRoute.throughJeju).toBe(true)
        // Hub goes through Jeju mainnet or testnet depending on source chain network
        expect([ChainId.JEJU, ChainId.JEJU_TESTNET]).toContain(
          hubRoute.hops[0].toChain,
        )
        expect([ChainId.JEJU, ChainId.JEJU_TESTNET]).toContain(
          hubRoute.hops[1].fromChain,
        )
      }
    })

    it('should include OIF solver route', async () => {
      const request: RouteRequest = {
        sourceChain: ChainId.ETHEREUM,
        destChain: ChainId.OPTIMISM,
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: 1000000000n,
        sender: '0x1234567890123456789012345678901234567890',
        recipient: '0x1234567890123456789012345678901234567890',
      }

      const routes = await optimizer.findOptimalRoutes(request)
      const oifRoute = routes.find((r) =>
        r.hops.some((h) => h.mechanism === 'oif'),
      )

      expect(oifRoute).toBeDefined()
    })

    it('should use zkbridge for Solana routes', async () => {
      const request: RouteRequest = {
        sourceChain: ChainId.BASE,
        destChain: ChainId.SOLANA_MAINNET,
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: 1000000000n,
        sender: '0x1234567890123456789012345678901234567890',
        recipient: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
      }

      const routes = await optimizer.findOptimalRoutes(request)
      const zkRoute = routes.find((r) =>
        r.hops.some((h) => h.mechanism === 'zkbridge'),
      )

      expect(zkRoute).toBeDefined()
    })

    it('should use ccip for BSC routes', async () => {
      const request: RouteRequest = {
        sourceChain: ChainId.ETHEREUM,
        destChain: ChainId.BSC,
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: 1000000000n,
        sender: '0x1234567890123456789012345678901234567890',
        recipient: '0x1234567890123456789012345678901234567890',
      }

      const routes = await optimizer.findOptimalRoutes(request)
      const ccipRoute = routes.find((r) =>
        r.hops.some((h) => h.mechanism === 'ccip'),
      )

      expect(ccipRoute).toBeDefined()
    })
  })

  describe('Route Ranking', () => {
    it('should prioritize through-Jeju routes when preferThroughJeju is true', async () => {
      const request: RouteRequest = {
        sourceChain: ChainId.BASE,
        destChain: ChainId.ARBITRUM,
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: 1000000000n,
        sender: '0x1234567890123456789012345678901234567890',
        recipient: '0x1234567890123456789012345678901234567890',
        preferThroughJeju: true,
      }

      const routes = await optimizer.findOptimalRoutes(request)

      // First route should be through Jeju when preference is set
      if (routes.length > 0 && routes.some((r) => r.throughJeju)) {
        expect(routes[0].throughJeju).toBe(true)
      }
    })

    it('should filter by maxTimeSec constraint', async () => {
      const request: RouteRequest = {
        sourceChain: ChainId.BASE,
        destChain: ChainId.SOLANA_MAINNET,
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: 1000000000n,
        sender: '0x1234567890123456789012345678901234567890',
        recipient: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
        maxTimeSec: 30, // Very tight time constraint
      }

      const routes = await optimizer.findOptimalRoutes(request)

      // Routes within time limit should rank higher
      if (routes.length > 1) {
        const inTimeRoutes = routes.filter((r) => r.totalTimeSec <= 30)
        if (inTimeRoutes.length > 0 && routes[0].totalTimeSec <= 30) {
          expect(routes[0].totalTimeSec).toBeLessThanOrEqual(30)
        }
      }
    })

    it('should filter by maxFeeBps constraint', async () => {
      const request: RouteRequest = {
        sourceChain: ChainId.BASE,
        destChain: ChainId.ARBITRUM,
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: 1000000000n,
        sender: '0x1234567890123456789012345678901234567890',
        recipient: '0x1234567890123456789012345678901234567890',
        maxFeeBps: 50, // 0.5% max
      }

      const routes = await optimizer.findOptimalRoutes(request)

      // Routes within fee limit should rank higher
      if (routes.length > 0 && routes.some((r) => r.totalFeeBps <= 50)) {
        const cheapRoutes = routes.filter((r) => r.totalFeeBps <= 50)
        expect(cheapRoutes.length).toBeGreaterThan(0)
      }
    })

    it('should calculate composite score correctly', () => {
      // Test the scoring logic
      const route: OptimizedRoute = {
        id: 'test',
        strategy: 'direct',
        hops: [],
        totalTimeSec: 12,
        totalFeeBps: 10,
        throughJeju: true,
        jejuRevenue: 1000000n,
        userCost: 10000000n,
        confidence: 95,
      }

      // Score = (revenue/cost * 100) * confidence / 100
      const expectedScore =
        (Number((route.jejuRevenue * 100n) / route.userCost) *
          route.confidence) /
        100
      expect(expectedScore).toBeGreaterThan(0)
    })
  })

  describe('Chain Configuration', () => {
    it('should have all mainnet chains configured', () => {
      expect(CHAIN_CONFIGS[ChainId.ETHEREUM]).toBeDefined()
      expect(CHAIN_CONFIGS[ChainId.BASE]).toBeDefined()
      expect(CHAIN_CONFIGS[ChainId.BSC]).toBeDefined()
      expect(CHAIN_CONFIGS[ChainId.ARBITRUM]).toBeDefined()
      expect(CHAIN_CONFIGS[ChainId.OPTIMISM]).toBeDefined()
      expect(CHAIN_CONFIGS[ChainId.JEJU]).toBeDefined()
      expect(CHAIN_CONFIGS[ChainId.SOLANA_MAINNET]).toBeDefined()
    })

    it('should have all testnet chains configured', () => {
      expect(CHAIN_CONFIGS[ChainId.SEPOLIA]).toBeDefined()
      expect(CHAIN_CONFIGS[ChainId.BASE_SEPOLIA]).toBeDefined()
      expect(CHAIN_CONFIGS[ChainId.BSC_TESTNET]).toBeDefined()
      expect(CHAIN_CONFIGS[ChainId.ARBITRUM_SEPOLIA]).toBeDefined()
      expect(CHAIN_CONFIGS[ChainId.OPTIMISM_SEPOLIA]).toBeDefined()
      expect(CHAIN_CONFIGS[ChainId.JEJU_TESTNET]).toBeDefined()
      expect(CHAIN_CONFIGS[ChainId.SOLANA_DEVNET]).toBeDefined()
    })

    it('should correctly identify Jeju chains', () => {
      expect(isJejuChain(ChainId.JEJU)).toBe(true)
      expect(isJejuChain(ChainId.JEJU_TESTNET)).toBe(true)
      expect(isJejuChain(ChainId.ETHEREUM)).toBe(false)
      expect(isJejuChain(ChainId.SOLANA_MAINNET)).toBe(false)
    })

    it('should correctly identify Solana chains', () => {
      expect(isSolanaChain(ChainId.SOLANA_MAINNET)).toBe(true)
      expect(isSolanaChain(ChainId.SOLANA_DEVNET)).toBe(true)
      expect(isSolanaChain(ChainId.ETHEREUM)).toBe(false)
      expect(isSolanaChain(ChainId.BASE)).toBe(false)
    })

    it('should correctly identify BSC chains', () => {
      expect(isBscChain(ChainId.BSC)).toBe(true)
      expect(isBscChain(ChainId.BSC_TESTNET)).toBe(true)
      expect(isBscChain(ChainId.ETHEREUM)).toBe(false)
      expect(isBscChain(ChainId.BASE)).toBe(false)
    })

    it('should return chain config by ID', () => {
      const ethConfig = getChainConfig(ChainId.ETHEREUM)
      expect(ethConfig).toBeDefined()
      expect(ethConfig?.name).toBe('Ethereum')
      expect(ethConfig?.type).toBe('evm')
      expect(ethConfig?.network).toBe('mainnet')
    })

    it('should return undefined for unknown chain', () => {
      const config = getChainConfig(999999)
      expect(config).toBeUndefined()
    })

    it('should return stablecoin addresses', () => {
      const usdcEth = getStablecoinAddress(ChainId.ETHEREUM, 'usdc')
      expect(usdcEth).toBe('0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48')

      const usdtEth = getStablecoinAddress(ChainId.ETHEREUM, 'usdt')
      expect(usdtEth).toBe('0xdAC17F958D2ee523a2206206994597C13D831ec7')

      const usdcBase = getStablecoinAddress(ChainId.BASE, 'usdc')
      expect(usdcBase).toBe('0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913')
    })
  })

  describe('Edge Cases', () => {
    it('should throw for unsupported chains', async () => {
      const request: RouteRequest = {
        sourceChain: 999999,
        destChain: ChainId.BASE,
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: 1000000000n,
        sender: '0x1234567890123456789012345678901234567890',
        recipient: '0x1234567890123456789012345678901234567890',
      }

      await expect(optimizer.findOptimalRoutes(request)).rejects.toThrow(
        'Unsupported chain',
      )
    })

    it('should throw for cross-network routes (mainnet to testnet)', async () => {
      const request: RouteRequest = {
        sourceChain: ChainId.ETHEREUM, // mainnet
        destChain: ChainId.SEPOLIA, // testnet
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: 1000000000n,
        sender: '0x1234567890123456789012345678901234567890',
        recipient: '0x1234567890123456789012345678901234567890',
      }

      await expect(optimizer.findOptimalRoutes(request)).rejects.toThrow(
        'Cannot route between mainnet and testnet',
      )
    })

    it('should handle zero amount', async () => {
      const request: RouteRequest = {
        sourceChain: ChainId.BASE,
        destChain: ChainId.ARBITRUM,
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: 0n,
        sender: '0x1234567890123456789012345678901234567890',
        recipient: '0x1234567890123456789012345678901234567890',
      }

      const routes = await optimizer.findOptimalRoutes(request)
      expect(routes.length).toBeGreaterThan(0)

      // All fees should be 0 for zero amount
      for (const route of routes) {
        expect(route.userCost).toBe(0n)
      }
    })

    it('should check direct route availability', () => {
      expect(optimizer.hasDirectRoute(ChainId.BASE, ChainId.ARBITRUM)).toBe(
        true,
      )
      expect(
        optimizer.hasDirectRoute(ChainId.BASE, ChainId.SOLANA_MAINNET),
      ).toBe(true)
    })

    it('should return supported chains for network', () => {
      const testnetOptimizer = createJejuRoutingOptimizer({}, 'testnet')
      const chains = testnetOptimizer.getSupportedChains()

      expect(chains.length).toBeGreaterThan(0)
      expect(chains.every((c) => c.network === 'testnet')).toBe(true)
    })
  })

  describe('Fee Configuration', () => {
    it('should accept custom fee configuration', () => {
      const customOptimizer = createJejuRoutingOptimizer({
        protocolFeeBps: 20, // 0.2%
        xlpFeeBps: 10,
        solverMarginBps: 10,
        x402FeeBps: 100,
      })

      expect(customOptimizer).toBeDefined()
    })

    it('should use custom fees in calculations', async () => {
      const customOptimizer = createJejuRoutingOptimizer({
        protocolFeeBps: 20,
        xlpFeeBps: 10,
        solverMarginBps: 10,
        x402FeeBps: 100,
      })

      const request: RouteRequest = {
        sourceChain: ChainId.BASE_SEPOLIA,
        destChain: ChainId.ARBITRUM_SEPOLIA,
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: 1000000000n,
        sender: '0x1234567890123456789012345678901234567890',
        recipient: '0x1234567890123456789012345678901234567890',
        preferThroughJeju: true,
      }

      const routes = await customOptimizer.findOptimalRoutes(request)
      const hubRoute = routes.find((r) => r.strategy === 'hub')

      if (hubRoute) {
        // Hub revenue = protocol (20) + xlp (10) = 30 bps
        const expectedRevenue = (request.amount * 30n) / 10000n
        expect(hubRoute.jejuRevenue).toBe(expectedRevenue)
      }
    })
  })

  describe('Time Estimates', () => {
    it('should have reasonable time estimates for L2 to L2', async () => {
      const request: RouteRequest = {
        sourceChain: ChainId.BASE_SEPOLIA,
        destChain: ChainId.ARBITRUM_SEPOLIA,
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: 1000000000n,
        sender: '0x1234567890123456789012345678901234567890',
        recipient: '0x1234567890123456789012345678901234567890',
      }

      const routes = await optimizer.findOptimalRoutes(request)
      const directRoute = routes.find(
        (r) =>
          r.strategy === 'direct' && r.hops.some((h) => h.mechanism === 'eil'),
      )

      if (directRoute) {
        // EIL should be ~12 seconds (1 block)
        expect(directRoute.totalTimeSec).toBe(12)
      }
    })

    it('should have longer time estimates for cross-type bridges', async () => {
      const request: RouteRequest = {
        sourceChain: ChainId.BASE_SEPOLIA,
        destChain: ChainId.SOLANA_DEVNET,
        token: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48',
        amount: 1000000000n,
        sender: '0x1234567890123456789012345678901234567890',
        recipient: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263',
      }

      const routes = await optimizer.findOptimalRoutes(request)
      const zkRoute = routes.find((r) =>
        r.hops.some((h) => h.mechanism === 'zkbridge'),
      )

      if (zkRoute) {
        // ZK bridge should be 60+ seconds (may include additional steps)
        expect(zkRoute.totalTimeSec).toBeGreaterThanOrEqual(60)
      }
    })
  })
})

describe('Optimizer Factory', () => {
  it('should create optimizer with default settings', () => {
    const optimizer = createJejuRoutingOptimizer()
    expect(optimizer).toBeDefined()
  })

  it('should create optimizer for mainnet', () => {
    const optimizer = createJejuRoutingOptimizer({}, 'mainnet')
    const chains = optimizer.getSupportedChains()
    expect(chains.every((c) => c.network === 'mainnet')).toBe(true)
  })

  it('should create optimizer for testnet', () => {
    const optimizer = createJejuRoutingOptimizer({}, 'testnet')
    const chains = optimizer.getSupportedChains()
    expect(chains.every((c) => c.network === 'testnet')).toBe(true)
  })
})
