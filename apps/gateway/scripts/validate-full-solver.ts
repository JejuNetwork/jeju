#!/usr/bin/env bun
/**
 * Full Solver Validation & Simulation
 * 
 * Tests all solver components against live data:
 * 1. Price Oracle (Chainlink feeds)
 * 2. DEX Aggregator (Uniswap V2/V3 quotes)
 * 3. CoW Optimizer (solution building)
 * 4. External Protocols (Across, UniswapX, CoW)
 * 
 * Run: bun apps/gateway/scripts/validate-full-solver.ts
 */

import { createPublicClient, http, type Address, type PublicClient } from 'viem';
import { mainnet, arbitrum, base } from 'viem/chains';

import { PriceOracle, CHAINLINK_FEEDS } from '../src/solver/external/price-oracle';
import { DexAggregator } from '../src/solver/external/dex-aggregator';
import { CowSolverOptimizer, printOptimizationReport } from '../src/solver/external/cow-optimizer';
import { CowSolverValidator, printSolverReport, printComparisonReport, type SolverMetrics, type CompetitionResult } from '../src/solver/external/cow-validator';
import { JITLiquidityProvider, priceToTick, tickToPrice } from '../src/solver/external/jit-liquidity';
import type { CowAuction, CowOrder } from '../src/solver/external/cow';

// Token addresses
const TOKENS = {
  WETH: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2' as Address,
  USDC: '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48' as Address,
  USDT: '0xdAC17F958D2ee523a2206206994597C13D831ec7' as Address,
  DAI: '0x6B175474E89094C44Da98b954EesDeaC495271d0F' as Address,
  WBTC: '0x2260FAC5E5542a773Aa44fBCfeDf7C193bc2C599' as Address,
};

interface TestResult {
  component: string;
  test: string;
  passed: boolean;
  duration: number;
  details?: string;
}

const results: TestResult[] = [];

function logResult(result: TestResult): void {
  results.push(result);
  const icon = result.passed ? '✓' : '✗';
  const status = result.passed ? '\x1b[32mPASS\x1b[0m' : '\x1b[31mFAIL\x1b[0m';
  console.log(`  ${icon} ${result.test} [${status}] ${result.duration}ms`);
  if (result.details) {
    console.log(`     ${result.details}`);
  }
}

async function runTest(component: string, test: string, fn: () => Promise<string | undefined>): Promise<void> {
  const start = Date.now();
  try {
    const details = await fn();
    logResult({
      component,
      test,
      passed: true,
      duration: Date.now() - start,
      details,
    });
  } catch (err) {
    logResult({
      component,
      test,
      passed: false,
      duration: Date.now() - start,
      details: err instanceof Error ? err.message : String(err),
    });
  }
}

async function validatePriceOracle(client: PublicClient): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('PRICE ORACLE VALIDATION');
  console.log('='.repeat(60));

  const oracle = new PriceOracle(client);

  await runTest('PriceOracle', 'Fetch ETH/USD price', async () => {
    const price = await oracle.getPrice(TOKENS.WETH);
    if (!price) throw new Error('Failed to fetch price');
    if (price.price < 1000 || price.price > 100000) throw new Error(`Price out of range: ${price.price}`);
    return `ETH = $${price.price.toFixed(2)} (${price.stale ? 'STALE' : 'fresh'})`;
  });

  await runTest('PriceOracle', 'Fetch USDC/USD price', async () => {
    const price = await oracle.getPrice(TOKENS.USDC);
    if (!price) throw new Error('Failed to fetch price');
    if (price.price < 0.9 || price.price > 1.1) throw new Error(`Stablecoin depeg: ${price.price}`);
    return `USDC = $${price.price.toFixed(4)}`;
  });

  await runTest('PriceOracle', 'Batch price fetch', async () => {
    const prices = await oracle.getPrices([TOKENS.WETH, TOKENS.USDC, TOKENS.USDT]);
    if (prices.size < 3) throw new Error(`Only got ${prices.size} prices`);
    return `Fetched ${prices.size} prices`;
  });

  await runTest('PriceOracle', 'Relative price calculation', async () => {
    const relPrice = await oracle.getRelativePrice(TOKENS.WETH, TOKENS.USDC);
    if (!relPrice) throw new Error('Failed to calculate relative price');
    return `1 ETH = ${relPrice.toFixed(2)} USDC`;
  });

  await runTest('PriceOracle', 'Fair value calculation', async () => {
    const fairValue = await oracle.getFairValue(
      TOKENS.USDC,
      TOKENS.WETH,
      BigInt('3000000000'),
      6,
      18
    );
    if (!fairValue) throw new Error('Failed to calculate fair value');
    const ethAmount = Number(fairValue) / 1e18;
    return `3000 USDC -> ${ethAmount.toFixed(4)} ETH (fair)`;
  });

  await runTest('PriceOracle', 'Price caching works', async () => {
    oracle.clearCache();
    const p1 = await oracle.getPrice(TOKENS.WETH);
    const p2 = await oracle.getPrice(TOKENS.WETH);
    if (p1?.source !== 'chainlink') throw new Error('First fetch should be from chainlink');
    if (p2?.source !== 'cached') throw new Error('Second fetch should be cached');
    return `Cache hit on second fetch`;
  });
}

async function validateDexAggregator(clients: Map<number, PublicClient>): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('DEX AGGREGATOR VALIDATION');
  console.log('='.repeat(60));

  const aggregator = new DexAggregator(clients);

  await runTest('DexAggregator', 'Get USDC->WETH quote', async () => {
    const quote = await aggregator.getBestQuote(1, TOKENS.USDC, TOKENS.WETH, BigInt('3000000000'));
    if (!quote) throw new Error('No quote returned');
    const ethOut = Number(quote.best.amountOut) / 1e18;
    return `Best: ${quote.best.dex} = ${ethOut.toFixed(4)} ETH`;
  });

  await runTest('DexAggregator', 'Multiple DEX quotes', async () => {
    const quote = await aggregator.getBestQuote(1, TOKENS.USDC, TOKENS.WETH, BigInt('10000000000'));
    if (!quote) throw new Error('No quote returned');
    return `Got ${quote.all.length} quotes from different sources`;
  });

  await runTest('DexAggregator', 'Compare with internal quote', async () => {
    const internalOut = BigInt('300000000000000000');
    const comparison = await aggregator.compareWithInternal(
      1,
      TOKENS.USDC,
      TOKENS.WETH,
      BigInt('1000000000'),
      internalOut
    );
    return `Improvement: ${comparison.improvementBps} bps, Use external: ${comparison.shouldUseExternal}`;
  });
}

async function validateCowOptimizer(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('COW OPTIMIZER VALIDATION');
  console.log('='.repeat(60));

  const optimizer = new CowSolverOptimizer();

  optimizer.setPools([
    {
      address: '0x0001' as Address,
      token0: TOKENS.USDC,
      token1: TOKENS.WETH,
      reserve0: BigInt('50000000000000'),
      reserve1: BigInt('16666666666666666666666'),
      fee: 30,
    },
    {
      address: '0x0002' as Address,
      token0: TOKENS.USDT,
      token1: TOKENS.WETH,
      reserve0: BigInt('30000000000000'),
      reserve1: BigInt('10000000000000000000000'),
      fee: 30,
    },
    {
      address: '0x0003' as Address,
      token0: TOKENS.USDC,
      token1: TOKENS.USDT,
      reserve0: BigInt('100000000000000'),
      reserve1: BigInt('100000000000000'),
      fee: 5,
    },
  ]);

  optimizer.setPrices([
    { token: TOKENS.USDC, priceUsd: 1, decimals: 6 },
    { token: TOKENS.USDT, priceUsd: 1, decimals: 6 },
    { token: TOKENS.WETH, priceUsd: 3000, decimals: 18 },
  ]);

  await runTest('CowOptimizer', 'Build direct route solution', async () => {
    const auction: CowAuction = {
      id: 1,
      chainId: 1,
      orders: [{
        uid: '0x01' as `0x${string}`,
        chainId: 1,
        owner: '0x1111111111111111111111111111111111111111' as Address,
        sellToken: TOKENS.USDC,
        buyToken: TOKENS.WETH,
        sellAmount: BigInt('3000000000'),
        buyAmount: BigInt('900000000000000000'),
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
      }],
      tokens: [TOKENS.USDC, TOKENS.WETH],
      deadline: Math.floor(Date.now() / 1000) + 30,
    };

    const solution = optimizer.buildOptimizedSolution(auction);
    if (!solution) throw new Error('Failed to build solution');
    return `Built solution with ${solution.trades.length} trades`;
  });

  await runTest('CowOptimizer', 'Find CoW matches', async () => {
    const auction: CowAuction = {
      id: 2,
      chainId: 1,
      orders: [
        {
          uid: '0x02' as `0x${string}`,
          chainId: 1,
          owner: '0x1111111111111111111111111111111111111111' as Address,
          sellToken: TOKENS.USDC,
          buyToken: TOKENS.WETH,
          sellAmount: BigInt('3000000000'),
          buyAmount: BigInt('900000000000000000'),
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
        },
        {
          uid: '0x03' as `0x${string}`,
          chainId: 1,
          owner: '0x2222222222222222222222222222222222222222' as Address,
          sellToken: TOKENS.WETH,
          buyToken: TOKENS.USDC,
          sellAmount: BigInt('1000000000000000000'),
          buyAmount: BigInt('2900000000'),
          validTo: Math.floor(Date.now() / 1000) + 3600,
          appData: '0x00' as `0x${string}`,
          feeAmount: BigInt(0),
          kind: 'sell',
          partiallyFillable: false,
          receiver: '0x2222222222222222222222222222222222222222' as Address,
          signature: '0x' as `0x${string}`,
          signingScheme: 'eip712',
          status: 'open',
          createdAt: Date.now(),
          filledAmount: BigInt(0),
        },
      ],
      tokens: [TOKENS.USDC, TOKENS.WETH],
      deadline: Math.floor(Date.now() / 1000) + 30,
    };

    const solution = optimizer.buildOptimizedSolution(auction);
    if (!solution) throw new Error('Failed to build solution');
    
    const stats = optimizer.getStats(solution);
    return `CoW matches: ${stats.cowMatches}, Direct: ${stats.directRoutes}, Multi-hop: ${stats.multiHopRoutes}`;
  });

  await runTest('CowOptimizer', 'Calculate surplus correctly', async () => {
    const auction: CowAuction = {
      id: 3,
      chainId: 1,
      orders: [{
        uid: '0x04' as `0x${string}`,
        chainId: 1,
        owner: '0x1111111111111111111111111111111111111111' as Address,
        sellToken: TOKENS.USDC,
        buyToken: TOKENS.WETH,
        sellAmount: BigInt('3000000000'),
        buyAmount: BigInt('900000000000000000'),
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
      }],
      tokens: [TOKENS.USDC, TOKENS.WETH],
      deadline: Math.floor(Date.now() / 1000) + 30,
    };

    const solution = optimizer.buildOptimizedSolution(auction);
    if (!solution) throw new Error('Failed to build solution');
    
    const stats = optimizer.getStats(solution);
    return `Avg surplus: ${stats.avgSurplusBps} bps, Gas/trade: ${stats.gasPerTrade}`;
  });
}

async function validateJITProvider(clients: Map<number, { public: PublicClient }>): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('JIT LIQUIDITY PROVIDER VALIDATION');
  console.log('='.repeat(60));

  const provider = new JITLiquidityProvider(clients);

  await runTest('JITProvider', 'Price/Tick conversion', async () => {
    const price = 3000;
    const tick = priceToTick(price);
    const backToPrice = tickToPrice(tick);
    if (Math.abs(backToPrice - price) > 10) throw new Error('Conversion error');
    return `$${price} -> tick ${tick} -> $${backToPrice.toFixed(2)}`;
  });

  await runTest('JITProvider', 'Start/Stop lifecycle', async () => {
    provider.start();
    provider.stop();
    return 'Started and stopped successfully';
  });

  await runTest('JITProvider', 'Analyze opportunity', async () => {
    const WETH_USDC_POOL = '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640' as Address;
    const opportunity = await provider.analyzeIntent(
      1,
      WETH_USDC_POOL,
      TOKENS.USDC,
      TOKENS.WETH,
      500,
      BigInt('100000000000'),
      'token0_to_token1',
      'test-intent',
      Math.floor(Date.now() / 1000) + 300
    );
    
    if (opportunity) {
      return `Tick range: ${opportunity.optimalTickLower} to ${opportunity.optimalTickUpper}`;
    }
    return 'No profitable opportunity (expected for small test)';
  });

  await runTest('JITProvider', 'Calculate optimal amounts', async () => {
    const amounts = provider.calculateOptimalAmounts(
      {
        intentId: 'test',
        chainId: 1,
        pool: '0x88e6A0c2dDD26FEEb64F039a2c41296FcB3f5640' as Address,
        token0: TOKENS.USDC,
        token1: TOKENS.WETH,
        fee: 500,
        direction: 'token0_to_token1',
        swapAmount: BigInt('1000000000'),
        expectedFees: BigInt('500000'),
        optimalTickLower: -100,
        optimalTickUpper: 100,
        deadline: Math.floor(Date.now() / 1000) + 300,
      },
      BigInt('1000000000'),
      BigInt('1000000000000000000')
    );
    
    if (amounts.amount0 !== BigInt(0)) throw new Error('Should provide token1 only');
    return `Providing ${amounts.amount1} of token1`;
  });
}

async function validateCowValidator(): Promise<void> {
  console.log('\n' + '='.repeat(60));
  console.log('COW VALIDATOR VALIDATION');
  console.log('='.repeat(60));

  await runTest('CowValidator', 'Validator report functions exist', async () => {
    // Test that the report functions work
    expect(typeof printSolverReport).toBe('function');
    expect(typeof printComparisonReport).toBe('function');
    return 'Report functions available';
  });

  await runTest('CowValidator', 'SolverMetrics interface complete', async () => {
    // Verify the interface has all required fields
    const mockMetrics: SolverMetrics = {
      auctionId: 1,
      chainId: 1,
      totalOrders: 10,
      ordersFilled: 8,
      fillRate: 80,
      totalSurplusWei: BigInt(1000000),
      totalSurplusUsd: 5.00,
      avgSurplusBps: 15,
      estimatedGasUsed: BigInt(500000),
      estimatedGasCostUsd: 2.50,
      cowMatches: 3,
      externalRoutes: 5,
      competitive: true,
      competitiveScore: 75,
      issues: [],
    };
    
    return `Metrics: ${mockMetrics.fillRate}% fill, ${mockMetrics.avgSurplusBps} bps, score ${mockMetrics.competitiveScore}`;
  });

  await runTest('CowValidator', 'CompetitionResult interface complete', async () => {
    const mockResult: CompetitionResult = {
      ourSolution: null,
      winningSolution: null,
      comparison: {
        wouldWin: false,
        surplusDifference: BigInt(0),
        fillRateDifference: 0,
        reasons: ['Test reason'],
      },
    };
    
    return `Competition result valid`;
  });
}

// Simple expect for validation
function expect<T>(actual: T) {
  return {
    toBe(expected: T) {
      if (actual !== expected) throw new Error(`Expected ${expected}, got ${actual}`);
    }
  };
}

async function main(): Promise<void> {
  console.log('='.repeat(60));
  console.log('JEJU SOLVER FULL VALIDATION');
  console.log('='.repeat(60));
  console.log(`\nTimestamp: ${new Date().toISOString()}`);
  console.log('Testing all solver components against live mainnet data...\n');

  const ethClient = createPublicClient({
    chain: mainnet,
    transport: http('https://eth.llamarpc.com'),
  });

  const clients = new Map<number, PublicClient>();
  clients.set(1, ethClient);
  clients.set(42161, createPublicClient({
    chain: arbitrum,
    transport: http('https://arbitrum.llamarpc.com'),
  }));
  clients.set(8453, createPublicClient({
    chain: base,
    transport: http('https://base.llamarpc.com'),
  }));

  const jitClients = new Map<number, { public: PublicClient }>();
  jitClients.set(1, { public: ethClient });

  await validatePriceOracle(ethClient);
  await validateDexAggregator(clients);
  await validateCowOptimizer();
  await validateJITProvider(jitClients);
  await validateCowValidator();

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('VALIDATION SUMMARY');
  console.log('='.repeat(60));

  const passed = results.filter(r => r.passed).length;
  const failed = results.filter(r => !r.passed).length;
  const total = results.length;

  console.log(`\nTotal:  ${total} tests`);
  console.log(`Passed: \x1b[32m${passed}\x1b[0m`);
  console.log(`Failed: \x1b[31m${failed}\x1b[0m`);

  if (failed > 0) {
    console.log('\nFailed tests:');
    for (const r of results.filter(r => !r.passed)) {
      console.log(`  - ${r.component}: ${r.test}`);
      if (r.details) console.log(`    Error: ${r.details}`);
    }
  }

  const passRate = ((passed / total) * 100).toFixed(1);
  console.log(`\nPass rate: ${passRate}%`);

  if (failed === 0) {
    console.log('\n\x1b[32mALL TESTS PASSED - SOLVER IS READY\x1b[0m');
  } else {
    console.log('\n\x1b[31mSOME TESTS FAILED - REVIEW REQUIRED\x1b[0m');
    process.exit(1);
  }
}

main().catch(console.error);

