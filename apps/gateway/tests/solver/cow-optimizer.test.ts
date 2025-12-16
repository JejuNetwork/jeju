/**
 * CoW Solver Optimizer Tests
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { type Address, parseUnits, parseEther } from 'viem';

import { 
  CowSolverOptimizer,
  printOptimizationReport,
  type LiquidityPool,
} from '../../src/solver/external/cow-optimizer';
import type { CowOrder, CowAuction } from '../../src/solver/external/cow';

const USDC = '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' as Address;
const WETH = '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2' as Address;
const USDT = '0xdac17f958d2ee523a2206206994597c13d831ec7' as Address;

function createTestPools(): LiquidityPool[] {
  return [
    {
      address: '0x0001' as Address,
      token0: USDC,
      token1: WETH,
      reserve0: BigInt('50000000000000'),
      reserve1: BigInt('16666666666666666666666'),
      fee: 30,
    },
    {
      address: '0x0002' as Address,
      token0: USDT,
      token1: WETH,
      reserve0: BigInt('30000000000000'),
      reserve1: BigInt('10000000000000000000000'),
      fee: 30,
    },
    {
      address: '0x0003' as Address,
      token0: USDC,
      token1: USDT,
      reserve0: BigInt('100000000000000'),
      reserve1: BigInt('100000000000000'),
      fee: 5,
    },
  ];
}

function createOrder(params: Partial<CowOrder> & { sellToken: Address; buyToken: Address; sellAmount: bigint; buyAmount: bigint }): CowOrder {
  return {
    uid: `0x${Math.random().toString(16).slice(2, 66)}` as `0x${string}`,
    chainId: 1,
    owner: '0x1111111111111111111111111111111111111111' as Address,
    validTo: Math.floor(Date.now() / 1000) + 3600,
    appData: '0x00' as `0x${string}`,
    feeAmount: BigInt(0),
    kind: 'sell',
    partiallyFillable: false,
    receiver: '0x1111111111111111111111111111111111111111' as Address,
    signature: '0x' as `0x${string}`,
    signingScheme: 'eip712',
    status: 'open',
    createdAt: Date.now(),
    filledAmount: BigInt(0),
    ...params,
  };
}

describe('CowSolverOptimizer', () => {
  let optimizer: CowSolverOptimizer;

  beforeAll(() => {
    optimizer = new CowSolverOptimizer();
    optimizer.setPools(createTestPools());
  });

  it('should instantiate correctly', () => {
    expect(optimizer).toBeDefined();
  });
});

describe('Direct Routing', () => {
  let optimizer: CowSolverOptimizer;

  beforeAll(() => {
    optimizer = new CowSolverOptimizer();
    optimizer.setPools(createTestPools());
  });

  it('should route USDC to WETH through direct pool', () => {
    const auction: CowAuction = {
      id: 1,
      chainId: 1,
      orders: [
        createOrder({
          sellToken: USDC,
          buyToken: WETH,
          sellAmount: BigInt('3000000000'),
          buyAmount: BigInt('900000000000000000'),
        }),
      ],
      tokens: [USDC, WETH],
      deadline: Math.floor(Date.now() / 1000) + 30,
    };

    const solution = optimizer.buildOptimizedSolution(auction);
    
    expect(solution).not.toBeNull();
    if (solution) {
      expect(solution.trades.length).toBe(1);
      expect(solution.routing[0].type).toBe('direct');
      expect(solution.routing[0].path.length).toBe(2);
      expect(solution.trades[0].executedBuyAmount).toBeGreaterThan(BigInt('900000000000000000'));
    }
  });

  it('should route stablecoin swap with minimal slippage', () => {
    const auction: CowAuction = {
      id: 2,
      chainId: 1,
      orders: [
        createOrder({
          sellToken: USDC,
          buyToken: USDT,
          sellAmount: BigInt('10000000000'),
          buyAmount: BigInt('9990000000'),
        }),
      ],
      tokens: [USDC, USDT],
      deadline: Math.floor(Date.now() / 1000) + 30,
    };

    const solution = optimizer.buildOptimizedSolution(auction);
    
    expect(solution).not.toBeNull();
    if (solution) {
      expect(solution.trades.length).toBe(1);
      expect(solution.trades[0].executedBuyAmount).toBeGreaterThan(BigInt('9990000000'));
    }
  });
});

describe('CoW Matching', () => {
  let optimizer: CowSolverOptimizer;

  beforeAll(() => {
    optimizer = new CowSolverOptimizer();
    optimizer.setPools(createTestPools());
  });

  it('should match opposite orders (Coincidence of Wants)', () => {
    const auction: CowAuction = {
      id: 5,
      chainId: 1,
      orders: [
        createOrder({
          uid: '0x0001' as `0x${string}`,
          sellToken: USDC,
          buyToken: WETH,
          sellAmount: BigInt('3000000000'),
          buyAmount: BigInt('900000000000000000'),
        }),
        createOrder({
          uid: '0x0002' as `0x${string}`,
          sellToken: WETH,
          buyToken: USDC,
          sellAmount: BigInt('1000000000000000000'),
          buyAmount: BigInt('2900000000'),
        }),
      ],
      tokens: [USDC, WETH],
      deadline: Math.floor(Date.now() / 1000) + 30,
    };

    const solution = optimizer.buildOptimizedSolution(auction);
    
    expect(solution).not.toBeNull();
    if (solution) {
      expect(solution.trades.length).toBe(2);
      const cowMatches = solution.routing.filter(r => r.type === 'cow-match');
      expect(cowMatches.length).toBe(2);
    }
  });

  it('should generate surplus from CoW matches', () => {
    const auction: CowAuction = {
      id: 6,
      chainId: 1,
      orders: [
        createOrder({
          uid: '0x0003' as `0x${string}`,
          sellToken: USDC,
          buyToken: WETH,
          sellAmount: BigInt('3000000000'),
          buyAmount: BigInt('900000000000000000'),
        }),
        createOrder({
          uid: '0x0004' as `0x${string}`,
          sellToken: WETH,
          buyToken: USDC,
          sellAmount: BigInt('1000000000000000000'),
          buyAmount: BigInt('2800000000'),
        }),
      ],
      tokens: [USDC, WETH],
      deadline: Math.floor(Date.now() / 1000) + 30,
    };

    const solution = optimizer.buildOptimizedSolution(auction);
    
    expect(solution).not.toBeNull();
    if (solution) {
      const cowMatches = solution.routing.filter(r => r.type === 'cow-match');
      if (cowMatches.length > 0) {
        expect(cowMatches[0].surplusBps).toBeGreaterThan(0);
      }
    }
  });
});

describe('Solution Quality', () => {
  let optimizer: CowSolverOptimizer;

  beforeAll(() => {
    optimizer = new CowSolverOptimizer();
    optimizer.setPools(createTestPools());
    optimizer.setPrices([
      { token: USDC, priceUsd: 1, decimals: 6 },
      { token: USDT, priceUsd: 1, decimals: 6 },
      { token: WETH, priceUsd: 3000, decimals: 18 },
    ]);
  });

  it('should calculate solution stats correctly', () => {
    const auction: CowAuction = {
      id: 7,
      chainId: 1,
      orders: [
        createOrder({
          sellToken: USDC,
          buyToken: WETH,
          sellAmount: BigInt('3000000000'),
          buyAmount: BigInt('900000000000000000'),
        }),
      ],
      tokens: [USDC, WETH],
      deadline: Math.floor(Date.now() / 1000) + 30,
    };

    const solution = optimizer.buildOptimizedSolution(auction);
    
    expect(solution).not.toBeNull();
    if (solution) {
      const stats = optimizer.getStats(solution);
      expect(stats.directRoutes + stats.multiHopRoutes + stats.cowMatches).toBe(solution.routing.length);
      expect(stats.avgSurplusBps).toBeGreaterThanOrEqual(0);
      expect(stats.gasPerTrade).toBeGreaterThan(BigInt(0));
    }
  });

  it('should generate valid gas estimates', () => {
    const auction: CowAuction = {
      id: 8,
      chainId: 1,
      orders: [
        createOrder({
          sellToken: USDC,
          buyToken: WETH,
          sellAmount: BigInt('1000000000'),
          buyAmount: BigInt('300000000000000000'),
        }),
        createOrder({
          sellToken: USDC,
          buyToken: USDT,
          sellAmount: BigInt('5000000000'),
          buyAmount: BigInt('4990000000'),
        }),
      ],
      tokens: [USDC, WETH, USDT],
      deadline: Math.floor(Date.now() / 1000) + 30,
    };

    const solution = optimizer.buildOptimizedSolution(auction);
    
    expect(solution).not.toBeNull();
    if (solution) {
      expect(solution.gasEstimate).toBeGreaterThan(BigInt(100000));
      expect(solution.gasEstimate).toBeLessThan(BigInt(2000000));
    }
  });
});

describe('Report Generation', () => {
  it('should print optimization report without errors', () => {
    const optimizer = new CowSolverOptimizer();
    optimizer.setPools(createTestPools());

    const solution = {
      auctionId: 123,
      trades: [
        { orderUid: '0x01' as `0x${string}`, executedSellAmount: BigInt(1000), executedBuyAmount: BigInt(999) },
        { orderUid: '0x02' as `0x${string}`, executedSellAmount: BigInt(2000), executedBuyAmount: BigInt(1998) },
      ],
      interactions: [],
      prices: {},
      routing: [
        { orderUid: '0x01' as `0x${string}`, path: [USDC, WETH], type: 'direct' as const, surplusBps: 15 },
        { orderUid: '0x02' as `0x${string}`, path: [USDC, USDT, WETH], type: 'multi-hop' as const, surplusBps: 12 },
      ],
      totalSurplusUsd: 45.50,
      gasEstimate: BigInt(350000),
    };

    expect(() => printOptimizationReport(solution, optimizer)).not.toThrow();
  });
});



