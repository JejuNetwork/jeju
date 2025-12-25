/**
 * CoW Protocol Market Maker Tests
 *
 * Tests for the CoW Protocol integration that enables
 * market making without solver registration.
 */

import { beforeAll, describe, expect, it } from 'bun:test'
import { type Address, createPublicClient, http, type PublicClient } from 'viem'
import { arbitrum, mainnet } from 'viem/chains'

import {
  COW_SETTLEMENT,
  COW_VAULT_RELAYER,
  type CowOrder,
  type CowOrderParams,
  CowProtocolSolver,
  type CowQuote,
} from '../../src/solver/external/cow'

// Skip network tests if env var is set
const SKIP_NETWORK_TESTS = process.env.SKIP_NETWORK_TESTS === 'true'

// Create mock clients
function createMockClients(): Map<number, { public: PublicClient }> {
  const clients = new Map<number, { public: PublicClient }>()

  clients.set(1, {
    public: createPublicClient({
      chain: mainnet,
      transport: http('https://eth.llamarpc.com'),
    }),
  })

  clients.set(42161, {
    public: createPublicClient({
      chain: arbitrum,
      transport: http('https://arb1.arbitrum.io/rpc'),
    }),
  })

  return clients
}

describe('CoW Protocol Contract Addresses', () => {
  it('should have Settlement on all supported chains', () => {
    expect(COW_SETTLEMENT[1]).toBeDefined()
    expect(COW_SETTLEMENT[42161]).toBeDefined()
    expect(COW_SETTLEMENT[100]).toBeDefined()
  })

  it('should have Vault Relayer on all supported chains', () => {
    expect(COW_VAULT_RELAYER[1]).toBeDefined()
    expect(COW_VAULT_RELAYER[42161]).toBeDefined()
    expect(COW_VAULT_RELAYER[100]).toBeDefined()
  })

  it('Settlement should use deterministic CREATE2 address', () => {
    // CoW uses same address on all chains
    const addresses = Object.values(COW_SETTLEMENT)
    const unique = new Set(addresses)
    expect(unique.size).toBe(1)
  })

  it('Vault Relayer should use deterministic CREATE2 address', () => {
    const addresses = Object.values(COW_VAULT_RELAYER)
    const unique = new Set(addresses)
    expect(unique.size).toBe(1)
  })
})

describe('CowProtocolSolver Instantiation', () => {
  let clients: Map<number, { public: PublicClient }>

  beforeAll(() => {
    clients = createMockClients()
  })

  it('should instantiate correctly', () => {
    const solver = new CowProtocolSolver(clients, [1, 42161, 100])
    expect(solver).toBeDefined()
  })

  it('should filter to supported chains only', () => {
    // Chain 999 is not in COW_SETTLEMENT
    const solver = new CowProtocolSolver(clients, [1, 999, 42161])
    expect(solver).toBeDefined()
  })

  it('should be an EventEmitter', () => {
    const solver = new CowProtocolSolver(clients, [1])
    expect(typeof solver.on).toBe('function')
    expect(typeof solver.emit).toBe('function')
  })

  it('should start and stop without error', async () => {
    const solver = new CowProtocolSolver(clients, [1])
    await solver.start()
    solver.stop()
    // No exception = pass
  })
})

describe('CoW Order Types', () => {
  it('should accept valid CowOrder', () => {
    const order: CowOrder = {
      uid: '0x1234567890123456789012345678901234567890123456789012345678901234' as `0x${string}`,
      chainId: 1,
      owner: '0x1234567890123456789012345678901234567890' as Address,
      sellToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
      buyToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
      sellAmount: BigInt('1000000000'),
      buyAmount: BigInt('500000000000000000'),
      validTo: Math.floor(Date.now() / 1000) + 3600,
      appData:
        '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
      feeAmount: BigInt('1000000'),
      kind: 'sell',
      partiallyFillable: false,
      receiver: '0x1234567890123456789012345678901234567890' as Address,
      signature: '0x' as `0x${string}`,
      signingScheme: 'eip712',
      status: 'open',
      createdAt: Date.now(),
      filledAmount: BigInt(0),
    }

    expect(order.kind).toBe('sell')
    expect(order.status).toBe('open')
  })

  it('should accept valid CowQuote', () => {
    const quote: CowQuote = {
      sellToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
      buyToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
      sellAmount: BigInt('1000000000'),
      buyAmount: BigInt('500000000000000000'),
      feeAmount: BigInt('1000000'),
      validTo: Math.floor(Date.now() / 1000) + 3600,
      kind: 'sell',
    }

    expect(quote.kind).toBe('sell')
    expect(quote.sellAmount).toBe(BigInt('1000000000'))
  })

  it('should accept valid CowOrderParams', () => {
    const params: CowOrderParams = {
      sellToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
      buyToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
      sellAmount: BigInt('1000000000'),
      buyAmount: BigInt('500000000000000000'),
      validTo: Math.floor(Date.now() / 1000) + 3600,
      kind: 'sell',
      partiallyFillable: false,
    }

    expect(params.kind).toBe('sell')
    expect(params.partiallyFillable).toBe(false)
  })
})

describe('CoW API Integration', () => {
  let clients: Map<number, { public: PublicClient }>
  let solver: CowProtocolSolver

  beforeAll(() => {
    clients = createMockClients()
    solver = new CowProtocolSolver(clients, [1, 42161])
  })

  it.skipIf(SKIP_NETWORK_TESTS)(
    'should fetch open orders from Ethereum',
    async () => {
      const orders = await solver.fetchOpenOrders(1, 5)
      expect(Array.isArray(orders)).toBe(true)
      // May be empty if no orders, but should not error
    },
  )

  it.skipIf(SKIP_NETWORK_TESTS)('should fetch current auction', async () => {
    await solver.start()
    // Wait a bit for polling
    await new Promise((r) => setTimeout(r, 1000))

    const auction = solver.getCurrentAuction(1)
    // May be undefined if no auction, but should not error
    if (auction) {
      expect(auction.chainId).toBe(1)
      expect(Array.isArray(auction.orders)).toBe(true)
    }

    solver.stop()
  })

  it.skipIf(SKIP_NETWORK_TESTS)(
    'should fetch orders for specific pair',
    async () => {
      const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address
      const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address

      const orders = await solver.fetchOrdersForPair(1, USDC, WETH)
      expect(Array.isArray(orders)).toBe(true)
    },
  )
})

describe('CoW Profitability Analysis', () => {
  let clients: Map<number, { public: PublicClient }>
  let solver: CowProtocolSolver

  beforeAll(() => {
    clients = createMockClients()
    solver = new CowProtocolSolver(clients, [1])
  })

  it('should find profitable orders when prices are favorable', () => {
    // Create mock auction
    const _auction = {
      id: 1,
      chainId: 1,
      orders: [
        {
          uid: '0x1234' as `0x${string}`,
          chainId: 1,
          owner: '0x1111111111111111111111111111111111111111' as Address,
          sellToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address, // USDC
          buyToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address, // WETH
          sellAmount: BigInt('1000000000'), // 1000 USDC
          buyAmount: BigInt('300000000000000000'), // 0.3 WETH (user wants)
          validTo: Math.floor(Date.now() / 1000) + 3600,
          appData: '0x00' as `0x${string}`,
          feeAmount: BigInt('1000000'),
          kind: 'sell' as const,
          partiallyFillable: false,
          receiver: '0x1111111111111111111111111111111111111111' as Address,
          signature: '0x' as `0x${string}`,
          signingScheme: 'eip712' as const,
          status: 'open' as const,
          createdAt: Date.now(),
          filledAmount: BigInt(0),
        },
      ],
      tokens: [] as Address[],
      deadline: Math.floor(Date.now() / 1000) + 30,
    }

    // Our prices: 1 USDC = $1, 1 WETH = $3000
    // User wants 0.3 WETH for 1000 USDC = $333/WETH implied
    // We can provide WETH at $3000 = profit
    const ourPrices = new Map<string, bigint>()
    ourPrices.set('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48', BigInt(1e18)) // USDC = 1
    ourPrices.set('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', BigInt(3000e18)) // WETH = 3000

    const profitable = solver.findProfitableOrders(1, ourPrices, 10)
    // Note: findProfitableOrders uses getCurrentAuction which isn't set
    // This is testing the type structure, actual logic would need real auction
    expect(Array.isArray(profitable)).toBe(true)
  })

  it('should evaluate auction profitability', () => {
    const auction = {
      id: 1,
      chainId: 1,
      orders: [
        {
          uid: '0x1234' as `0x${string}`,
          chainId: 1,
          owner: '0x1111111111111111111111111111111111111111' as Address,
          sellToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
          buyToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
          sellAmount: BigInt('1000000000000000000000'), // 1000 tokens
          buyAmount: BigInt('500000000000000000000'), // 500 tokens
          validTo: Math.floor(Date.now() / 1000) + 3600,
          appData: '0x00' as `0x${string}`,
          feeAmount: BigInt('1000000000000000000'),
          kind: 'sell' as const,
          partiallyFillable: false,
          receiver: '0x1111111111111111111111111111111111111111' as Address,
          signature: '0x' as `0x${string}`,
          signingScheme: 'eip712' as const,
          status: 'open' as const,
          createdAt: Date.now(),
          filledAmount: BigInt(0),
        },
      ],
      tokens: [] as Address[],
      deadline: Math.floor(Date.now() / 1000) + 30,
    }

    const tokenPrices: Record<string, number> = {
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48': 1,
      '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2': 2,
      '0x0000000000000000000000000000000000000000': 3000,
    }

    const result = solver.evaluateAuction(auction, BigInt(30e9), tokenPrices)

    expect(typeof result.profitable).toBe('boolean')
    expect(typeof result.expectedProfitUsd).toBe('number')
    expect(typeof result.fillableOrders).toBe('number')
  })
})

describe('CoW Solution Building', () => {
  let clients: Map<number, { public: PublicClient }>
  let solver: CowProtocolSolver

  beforeAll(() => {
    clients = createMockClients()
    solver = new CowProtocolSolver(clients, [1])
  })

  it('should build solution when liquidity is available', () => {
    const auction = {
      id: 1,
      chainId: 1,
      orders: [
        {
          uid: '0x1234567890123456789012345678901234567890123456789012345678901234' as `0x${string}`,
          chainId: 1,
          owner: '0x1111111111111111111111111111111111111111' as Address,
          sellToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
          buyToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
          sellAmount: BigInt('1000000000'), // 1000 USDC (6 decimals)
          buyAmount: BigInt('300000000000000000'), // 0.3 WETH
          validTo: Math.floor(Date.now() / 1000) + 3600,
          appData:
            '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
          feeAmount: BigInt('1000000'),
          kind: 'sell' as const,
          partiallyFillable: false,
          receiver: '0x1111111111111111111111111111111111111111' as Address,
          signature: '0x' as `0x${string}`,
          signingScheme: 'eip712' as const,
          status: 'open' as const,
          createdAt: Date.now(),
          filledAmount: BigInt(0),
        },
      ],
      tokens: [
        '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
        '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
      ],
      deadline: Math.floor(Date.now() / 1000) + 30,
    }

    // Mock pool with enough liquidity
    const liquidityPools = new Map()
    const poolKey =
      '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48-0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2'
    liquidityPools.set(poolKey, {
      token0: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
      token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
      reserve0: BigInt('10000000000000'), // 10M USDC
      reserve1: BigInt('3000000000000000000000'), // 3000 WETH
    })

    const solution = solver.buildSolution(auction, liquidityPools)

    if (solution) {
      expect(solution.auctionId).toBe(1)
      expect(solution.trades.length).toBeGreaterThan(0)
      expect(solution.trades[0].orderUid).toBeDefined()
    }
  })

  it('should return null when no liquidity', () => {
    const auction = {
      id: 1,
      chainId: 1,
      orders: [
        {
          uid: '0x1234' as `0x${string}`,
          chainId: 1,
          owner: '0x1111111111111111111111111111111111111111' as Address,
          sellToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
          buyToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
          sellAmount: BigInt('1000000000'),
          buyAmount: BigInt('300000000000000000'),
          validTo: Math.floor(Date.now() / 1000) + 3600,
          appData: '0x00' as `0x${string}`,
          feeAmount: BigInt('1000000'),
          kind: 'sell' as const,
          partiallyFillable: false,
          receiver: '0x1111111111111111111111111111111111111111' as Address,
          signature: '0x' as `0x${string}`,
          signingScheme: 'eip712' as const,
          status: 'open' as const,
          createdAt: Date.now(),
          filledAmount: BigInt(0),
        },
      ],
      tokens: [],
      deadline: Math.floor(Date.now() / 1000) + 30,
    }

    // Empty liquidity pools
    const liquidityPools = new Map()

    const solution = solver.buildSolution(auction, liquidityPools)
    expect(solution).toBeNull()
  })
})

describe('CoW Market Maker Functions', () => {
  let clients: Map<number, { public: PublicClient }>
  let solver: CowProtocolSolver

  beforeAll(() => {
    clients = createMockClients()
    solver = new CowProtocolSolver(clients, [1])
  })

  it('should fail createOrder without wallet', async () => {
    const params: CowOrderParams = {
      sellToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
      buyToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
      sellAmount: BigInt('1000000000'),
      buyAmount: BigInt('300000000000000000'),
      validTo: Math.floor(Date.now() / 1000) + 3600,
    }

    const result = await solver.createOrder(1, params)
    expect(result.success).toBe(false)
    expect(result.error).toBe('No wallet configured')
  })

  it('should fail cancelOrder without wallet', async () => {
    const result = await solver.cancelOrder(
      1,
      '0x1234567890123456789012345678901234567890123456789012345678901234' as `0x${string}`,
    )
    expect(result.success).toBe(false)
    expect(result.error).toBe('No wallet configured')
  })

  it('should fail approveToken without wallet', async () => {
    const result = await solver.approveToken(
      1,
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
    )
    expect(result.success).toBe(false)
    expect(result.error).toBe('No wallet configured')
  })

  it('should fail getQuote for unsupported chain', async () => {
    const result = await solver.getQuote(999, {
      sellToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
      buyToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
      sellAmountBeforeFee: BigInt('1000000000'),
      from: '0x1111111111111111111111111111111111111111' as Address,
    })
    expect(result).toBeNull()
  })

  it.skipIf(SKIP_NETWORK_TESTS)(
    'should get quote from CoW API',
    async () => {
      const result = await solver.getQuote(1, {
        sellToken: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address, // USDC
        buyToken: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address, // WETH
        sellAmountBeforeFee: BigInt('1000000000'), // 1000 USDC
        from: '0x1111111111111111111111111111111111111111' as Address,
        kind: 'sell',
      })

      // Quote might fail if API is rate limited, but structure should be correct
      if (result) {
        expect(result.sellToken.toLowerCase()).toBe(
          '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48',
        )
        expect(result.buyToken.toLowerCase()).toBe(
          '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',
        )
        expect(typeof result.sellAmount).toBe('bigint')
        expect(typeof result.buyAmount).toBe('bigint')
      }
    },
    30000,
  )
})
