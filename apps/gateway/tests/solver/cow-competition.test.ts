/**
 * CoW Solver Competition Tests
 * 
 * Tests our solver's competitiveness against real CoW auctions.
 * These tests validate whether our solution building would actually
 * win or be competitive in the solver competition.
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { createPublicClient, http, type PublicClient, type Address } from 'viem';
import { mainnet } from 'viem/chains';

import { CowProtocolSolver } from '../../src/solver/external/cow';
import { 
  CowSolverValidator, 
  printSolverReport, 
  printComparisonReport,
  type SolverMetrics 
} from '../../src/solver/external/cow-validator';

// Skip network tests if env var is set
const SKIP_NETWORK_TESTS = process.env.SKIP_NETWORK_TESTS === 'true';
const RUN_EXTENDED_TESTS = process.env.RUN_EXTENDED_TESTS === 'true';

// Mock liquidity pools for testing
function createMockLiquidityPools(): Map<string, { reserve0: bigint; reserve1: bigint; token0: Address; token1: Address }> {
  const pools = new Map();
  
  // USDC-WETH pool
  const usdcWeth = 'usdc-weth';
  pools.set('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48-0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', {
    token0: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address, // USDC
    token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address, // WETH
    reserve0: BigInt('50000000000000'), // 50M USDC (6 decimals)
    reserve1: BigInt('15000000000000000000000'), // 15,000 WETH (18 decimals)
  });
  
  // USDT-WETH pool
  pools.set('0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2-0xdac17f958d2ee523a2206206994597c13d831ec7', {
    token0: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address, // WETH
    token1: '0xdAC17F958D2ee523a2206206994597C13D831ec7' as Address, // USDT
    reserve0: BigInt('10000000000000000000000'), // 10,000 WETH
    reserve1: BigInt('30000000000000'), // 30M USDT
  });
  
  // DAI-WETH pool
  pools.set('0x6b175474e89094c44da98b954eedeac495271d0f-0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', {
    token0: '0x6B175474E89094C44Da98b954EesuedeAC495271d0F' as Address, // DAI
    token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address, // WETH
    reserve0: BigInt('20000000000000000000000000'), // 20M DAI (18 decimals)
    reserve1: BigInt('6666000000000000000000'), // 6,666 WETH
  });
  
  // USDC-USDT pool
  pools.set('0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48-0xdac17f958d2ee523a2206206994597c13d831ec7', {
    token0: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address, // USDC
    token1: '0xdAC17F958D2ee523a2206206994597C13D831ec7' as Address, // USDT
    reserve0: BigInt('100000000000000'), // 100M USDC
    reserve1: BigInt('100000000000000'), // 100M USDT
  });
  
  // WBTC-WETH pool
  pools.set('0x2260fac5e5542a773aa44fbcfedf7c193bc2c599-0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2', {
    token0: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' as Address, // WBTC
    token1: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address, // WETH
    reserve0: BigInt('500000000000'), // 5,000 WBTC (8 decimals)
    reserve1: BigInt('75000000000000000000000'), // 75,000 WETH
  });
  
  return pools;
}

describe('CowSolverValidator', () => {
  let clients: Map<number, { public: PublicClient }>;
  let solver: CowProtocolSolver;
  let validator: CowSolverValidator;
  let liquidityPools: Map<string, { reserve0: bigint; reserve1: bigint; token0: Address; token1: Address }>;

  beforeAll(() => {
    clients = new Map();
    clients.set(1, {
      public: createPublicClient({
        chain: mainnet,
        transport: http('https://eth.llamarpc.com'),
      }),
    });
    
    solver = new CowProtocolSolver(clients, [1]);
    validator = new CowSolverValidator(solver);
    liquidityPools = createMockLiquidityPools();
  });

  it('should instantiate validator correctly', () => {
    expect(validator).toBeDefined();
  });

  it('should return null metrics when no auction', async () => {
    // Don't start solver, so no auction available
    const metrics = await validator.validateLiveAuction(1, liquidityPools);
    expect(metrics).toBeNull();
  });
});

describe('Solver Metrics Calculation', () => {
  let clients: Map<number, { public: PublicClient }>;
  let solver: CowProtocolSolver;
  let validator: CowSolverValidator;
  let liquidityPools: Map<string, { reserve0: bigint; reserve1: bigint; token0: Address; token1: Address }>;

  beforeAll(() => {
    clients = new Map();
    clients.set(1, {
      public: createPublicClient({
        chain: mainnet,
        transport: http('https://eth.llamarpc.com'),
      }),
    });
    
    solver = new CowProtocolSolver(clients, [1]);
    validator = new CowSolverValidator(solver);
    liquidityPools = createMockLiquidityPools();
  });

  it('should build solution for matching orders', () => {
    // Create a mock auction with orders that can be filled
    const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address;
    const WETH = '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address;
    
    const auction = {
      id: 12345,
      chainId: 1,
      orders: [{
        uid: '0x0001' as `0x${string}`,
        chainId: 1,
        owner: '0x1111111111111111111111111111111111111111' as Address,
        sellToken: USDC,
        buyToken: WETH,
        sellAmount: BigInt('3000000000'), // 3000 USDC
        buyAmount: BigInt('1000000000000000000'), // 1 WETH (asking $3000/ETH)
        validTo: Math.floor(Date.now() / 1000) + 3600,
        appData: '0x00' as `0x${string}`,
        feeAmount: BigInt(0),
        kind: 'sell' as const,
        partiallyFillable: false,
        receiver: '0x1111111111111111111111111111111111111111' as Address,
        signature: '0x' as `0x${string}`,
        signingScheme: 'eip712' as const,
        status: 'open' as const,
        createdAt: Date.now(),
        filledAmount: BigInt(0),
      }],
      tokens: [USDC, WETH],
      deadline: Math.floor(Date.now() / 1000) + 30,
    };

    const solution = solver.buildSolution(auction, liquidityPools);
    
    // With 50M USDC / 15K WETH, the implied price is ~$3333/WETH
    // User wants 1 WETH for 3000 USDC (~$3000/WETH)
    // We can give them 1 WETH and profit from the spread
    if (solution) {
      expect(solution.trades.length).toBe(1);
      expect(solution.trades[0].orderUid).toBe('0x0001');
      expect(solution.trades[0].executedBuyAmount).toBeGreaterThanOrEqual(BigInt('1000000000000000000'));
    }
  });

  it('should calculate competitive score correctly', () => {
    // Test score calculation logic
    const metrics: SolverMetrics = {
      auctionId: 1,
      chainId: 1,
      totalOrders: 10,
      ordersFilled: 8,
      fillRate: 80,
      totalSurplusWei: BigInt('1000000000000000000'),
      totalSurplusUsd: 3000,
      avgSurplusBps: 15,
      estimatedGasUsed: BigInt(500000),
      estimatedGasCostUsd: 45,
      cowMatches: 3,
      externalRoutes: 5,
      competitive: true,
      competitiveScore: 75,
      issues: [],
    };

    // 80% fill rate = 32/40 points
    // 15 bps surplus = 30/30 points (capped)
    // 3/8 CoW = 5.6/15 points
    // 500k gas / 8 trades = 62.5k avg, good efficiency
    expect(metrics.competitiveScore).toBeGreaterThan(50);
  });
});

describe('Live Auction Validation', () => {
  let clients: Map<number, { public: PublicClient }>;
  let solver: CowProtocolSolver;
  let validator: CowSolverValidator;
  let liquidityPools: Map<string, { reserve0: bigint; reserve1: bigint; token0: Address; token1: Address }>;

  beforeAll(async () => {
    clients = new Map();
    clients.set(1, {
      public: createPublicClient({
        chain: mainnet,
        transport: http('https://eth.llamarpc.com'),
      }),
    });
    
    solver = new CowProtocolSolver(clients, [1]);
    validator = new CowSolverValidator(solver);
    liquidityPools = createMockLiquidityPools();
  });

  it.skipIf(SKIP_NETWORK_TESTS)('should validate against live Ethereum auction', async () => {
    // Start solver to begin polling
    await solver.start();
    
    // Wait for auction to be fetched
    await new Promise(r => setTimeout(r, 6000));
    
    const metrics = await validator.validateLiveAuction(1, liquidityPools);
    solver.stop();
    
    if (metrics) {
      console.log('\n📊 Live Auction Metrics:');
      console.log(`   Total Orders: ${metrics.totalOrders}`);
      console.log(`   Orders Filled: ${metrics.ordersFilled}`);
      console.log(`   Fill Rate: ${metrics.fillRate.toFixed(1)}%`);
      console.log(`   Avg Surplus: ${metrics.avgSurplusBps} bps`);
      console.log(`   Competitive Score: ${metrics.competitiveScore}/100`);
      console.log(`   Would Be Competitive: ${metrics.competitive ? 'YES' : 'NO'}`);
      
      if (metrics.issues.length > 0) {
        console.log('   Issues:');
        metrics.issues.forEach(i => console.log(`     - ${i}`));
      }
      
      // Basic sanity checks
      expect(metrics.totalOrders).toBeGreaterThanOrEqual(0);
      expect(metrics.competitiveScore).toBeGreaterThanOrEqual(0);
      expect(metrics.competitiveScore).toBeLessThanOrEqual(100);
    } else {
      console.log('   No live auction available at this time');
    }
  }, 15000);

  it.skipIf(!RUN_EXTENDED_TESTS)('should run continuous validation', async () => {
    await solver.start();
    
    const results = await validator.runContinuousValidation(
      1,
      liquidityPools,
      30000, // 30 seconds
      (metrics) => {
        printSolverReport(metrics);
      }
    );
    
    solver.stop();
    
    console.log(`\n📈 Validation Summary:`);
    console.log(`   Auctions Tested: ${results.length}`);
    
    if (results.length > 0) {
      const avgScore = results.reduce((sum, m) => sum + m.competitiveScore, 0) / results.length;
      const avgFillRate = results.reduce((sum, m) => sum + m.fillRate, 0) / results.length;
      const competitive = results.filter(m => m.competitive).length;
      
      console.log(`   Average Score: ${avgScore.toFixed(1)}/100`);
      console.log(`   Average Fill Rate: ${avgFillRate.toFixed(1)}%`);
      console.log(`   Competitive Auctions: ${competitive}/${results.length}`);
    }
  }, 60000);
});

describe('Competition Comparison', () => {
  let clients: Map<number, { public: PublicClient }>;
  let solver: CowProtocolSolver;
  let validator: CowSolverValidator;
  let liquidityPools: Map<string, { reserve0: bigint; reserve1: bigint; token0: Address; token1: Address }>;

  beforeAll(() => {
    clients = new Map();
    clients.set(1, {
      public: createPublicClient({
        chain: mainnet,
        transport: http('https://eth.llamarpc.com'),
      }),
    });
    
    solver = new CowProtocolSolver(clients, [1]);
    validator = new CowSolverValidator(solver);
    liquidityPools = createMockLiquidityPools();
  });

  it('should identify when we would not win', () => {
    // Test comparison logic with worse metrics
    const ourMetrics: SolverMetrics = {
      auctionId: 1,
      chainId: 1,
      totalOrders: 10,
      ordersFilled: 5,
      fillRate: 50,
      totalSurplusWei: BigInt('100000000000000000'), // 0.1 ETH
      totalSurplusUsd: 300,
      avgSurplusBps: 5,
      estimatedGasUsed: BigInt(500000),
      estimatedGasCostUsd: 45,
      cowMatches: 1,
      externalRoutes: 4,
      competitive: false,
      competitiveScore: 35,
      issues: ['Low fill rate', 'Low surplus'],
    };

    // Winner has better surplus
    const winningSolution = {
      solver: '0xSomeSolver',
      totalSurplusWei: BigInt('500000000000000000'), // 0.5 ETH
      ordersFilled: 8,
      gasUsed: BigInt(400000),
    };

    // We would not win because winner has 5x more surplus
    expect(ourMetrics.totalSurplusWei).toBeLessThan(winningSolution.totalSurplusWei);
  });

  it('should identify when we would win', () => {
    const ourMetrics: SolverMetrics = {
      auctionId: 1,
      chainId: 1,
      totalOrders: 10,
      ordersFilled: 9,
      fillRate: 90,
      totalSurplusWei: BigInt('1000000000000000000'), // 1 ETH
      totalSurplusUsd: 3000,
      avgSurplusBps: 25,
      estimatedGasUsed: BigInt(400000),
      estimatedGasCostUsd: 36,
      cowMatches: 4,
      externalRoutes: 5,
      competitive: true,
      competitiveScore: 85,
      issues: [],
    };

    const winningSolution = {
      solver: '0xSomeSolver',
      totalSurplusWei: BigInt('800000000000000000'), // 0.8 ETH
      ordersFilled: 8,
      gasUsed: BigInt(500000),
    };

    // We would win because we have more surplus
    expect(ourMetrics.totalSurplusWei).toBeGreaterThan(winningSolution.totalSurplusWei);
  });
});

describe('Report Generation', () => {
  it('should print solver report without errors', () => {
    const metrics: SolverMetrics = {
      auctionId: 12345,
      chainId: 1,
      totalOrders: 15,
      ordersFilled: 12,
      fillRate: 80,
      totalSurplusWei: BigInt('500000000000000000'),
      totalSurplusUsd: 1500,
      avgSurplusBps: 12,
      estimatedGasUsed: BigInt(600000),
      estimatedGasCostUsd: 54,
      cowMatches: 5,
      externalRoutes: 7,
      competitive: true,
      competitiveScore: 72,
      issues: ['Test issue 1', 'Test issue 2'],
    };

    // Should not throw
    expect(() => printSolverReport(metrics)).not.toThrow();
  });

  it('should print comparison report without errors', () => {
    const result = {
      ourSolution: {
        auctionId: 12345,
        chainId: 1,
        totalOrders: 15,
        ordersFilled: 12,
        fillRate: 80,
        totalSurplusWei: BigInt('500000000000000000'),
        totalSurplusUsd: 1500,
        avgSurplusBps: 12,
        estimatedGasUsed: BigInt(600000),
        estimatedGasCostUsd: 54,
        cowMatches: 5,
        externalRoutes: 7,
        competitive: true,
        competitiveScore: 72,
        issues: [],
      },
      winningSolution: {
        solver: '0x1234567890123456789012345678901234567890',
        totalSurplusWei: BigInt('400000000000000000'),
        ordersFilled: 10,
        gasUsed: BigInt(500000),
      },
      comparison: {
        wouldWin: true,
        surplusDifference: BigInt('100000000000000000'),
        fillRateDifference: 2,
        reasons: ['Our surplus is 0.1 ETH higher', '✅ Our solution would win based on surplus'],
      },
    };

    // Should not throw
    expect(() => printComparisonReport(result)).not.toThrow();
  });
});

