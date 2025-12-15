/**
 * CoW Solver Competition Validator
 * 
 * Tests our solver against real CoW auctions to determine
 * if we would be competitive in the solver competition.
 * 
 * Key metrics:
 * - Surplus: Price improvement we provide over limit prices
 * - Fill rate: Percentage of orders we can fill
 * - Gas efficiency: Estimated gas cost per trade
 * - CoW matching: Orders we can match internally (best)
 */

import { type Address, formatEther } from 'viem';
import { CowProtocolSolver, type CowAuction, type CowSolution } from './cow';

// CoW API for historical data
const COW_API = {
  1: 'https://api.cow.fi/mainnet',
  42161: 'https://api.cow.fi/arbitrum_one',
  100: 'https://api.cow.fi/xdai',
};

export interface SolverMetrics {
  auctionId: number;
  chainId: number;
  totalOrders: number;
  ordersFilled: number;
  fillRate: number;
  totalSurplusWei: bigint;
  totalSurplusUsd: number;
  avgSurplusBps: number;
  estimatedGasUsed: bigint;
  estimatedGasCostUsd: number;
  cowMatches: number; // Orders matched internally
  externalRoutes: number; // Orders routed through DEXs
  competitive: boolean;
  competitiveScore: number; // 0-100
  issues: string[];
}

export interface CompetitionResult {
  ourSolution: SolverMetrics | null;
  winningSolution: WinningSolutionInfo | null;
  comparison: ComparisonResult;
}

interface WinningSolutionInfo {
  solver: string;
  totalSurplusWei: bigint;
  ordersFilled: number;
  gasUsed: bigint;
}

interface ComparisonResult {
  wouldWin: boolean;
  surplusDifference: bigint;
  fillRateDifference: number;
  reasons: string[];
}


export class CowSolverValidator {
  private solver: CowProtocolSolver;
  
  constructor(solver: CowProtocolSolver) {
    this.solver = solver;
  }

  /**
   * Validate our solver against the current live auction
   */
  async validateLiveAuction(
    chainId: number,
    liquidityPools: Map<string, { reserve0: bigint; reserve1: bigint; token0: Address; token1: Address }>
  ): Promise<SolverMetrics | null> {
    const auction = this.solver.getCurrentAuction(chainId);
    if (!auction || auction.orders.length === 0) {
      console.log('No live auction available');
      return null;
    }

    console.log(`\n🔍 Validating solver against auction ${auction.id}...`);
    console.log(`   Orders in auction: ${auction.orders.length}`);

    // Build our solution
    const solution = this.solver.buildSolution(auction, liquidityPools);
    
    return this.analyzeSolution(auction, solution, liquidityPools);
  }

  /**
   * Fetch and validate against a historical auction
   */
  async validateHistoricalAuction(
    chainId: number,
    auctionId: number,
    liquidityPools: Map<string, { reserve0: bigint; reserve1: bigint; token0: Address; token1: Address }>
  ): Promise<CompetitionResult> {
    const apiUrl = COW_API[chainId as keyof typeof COW_API];
    if (!apiUrl) {
      return {
        ourSolution: null,
        winningSolution: null,
        comparison: { wouldWin: false, surplusDifference: 0n, fillRateDifference: 0, reasons: ['Unsupported chain'] },
      };
    }

    // Fetch historical auction
    const auctionResponse = await fetch(`${apiUrl}/api/v1/solver_competition/by_id/${auctionId}`);
    if (!auctionResponse.ok) {
      return {
        ourSolution: null,
        winningSolution: null,
        comparison: { wouldWin: false, surplusDifference: 0n, fillRateDifference: 0, reasons: ['Could not fetch auction'] },
      };
    }

    const auctionData = await auctionResponse.json() as {
      auctionId: number;
      orders: Array<{
        uid: string;
        sellToken: string;
        buyToken: string;
        sellAmount: string;
        buyAmount: string;
        kind: string;
        partiallyFillable: boolean;
      }>;
      solutions: Array<{
        solver: string;
        score: string;
        ranking: number;
        orders: Array<{ id: string; executedAmount: string }>;
      }>;
    };

    // Convert to our auction format
    const auction: CowAuction = {
      id: auctionData.auctionId,
      chainId,
      orders: auctionData.orders.map(o => ({
        uid: o.uid as `0x${string}`,
        chainId,
        owner: '0x0000000000000000000000000000000000000000' as Address,
        sellToken: o.sellToken as Address,
        buyToken: o.buyToken as Address,
        sellAmount: BigInt(o.sellAmount),
        buyAmount: BigInt(o.buyAmount),
        validTo: Math.floor(Date.now() / 1000) + 3600,
        appData: '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`,
        feeAmount: 0n,
        kind: o.kind as 'sell' | 'buy',
        partiallyFillable: o.partiallyFillable,
        receiver: '0x0000000000000000000000000000000000000000' as Address,
        signature: '0x' as `0x${string}`,
        signingScheme: 'eip712' as const,
        status: 'open' as const,
        createdAt: Date.now(),
        filledAmount: 0n,
      })),
      tokens: [],
      deadline: Math.floor(Date.now() / 1000) + 30,
    };

    // Build our solution
    const ourSolution = this.solver.buildSolution(auction, liquidityPools);
    const ourMetrics = await this.analyzeSolution(auction, ourSolution, liquidityPools);

    // Get winning solution info
    const winningSolution = auctionData.solutions.find(s => s.ranking === 1);
    const winningSolutionInfo: WinningSolutionInfo | null = winningSolution ? {
      solver: winningSolution.solver,
      totalSurplusWei: BigInt(winningSolution.score),
      ordersFilled: winningSolution.orders.length,
      gasUsed: 0n, // Not available from API
    } : null;

    // Compare
    const comparison = this.compareSolutions(ourMetrics, winningSolutionInfo);

    return {
      ourSolution: ourMetrics,
      winningSolution: winningSolutionInfo,
      comparison,
    };
  }

  /**
   * Run continuous validation against live auctions
   */
  async runContinuousValidation(
    chainId: number,
    liquidityPools: Map<string, { reserve0: bigint; reserve1: bigint; token0: Address; token1: Address }>,
    durationMs: number = 60000,
    onResult?: (metrics: SolverMetrics) => void
  ): Promise<SolverMetrics[]> {
    const results: SolverMetrics[] = [];
    const startTime = Date.now();
    let lastAuctionId = 0;

    console.log(`\n🏃 Running continuous validation for ${durationMs / 1000}s...`);

    while (Date.now() - startTime < durationMs) {
      const auction = this.solver.getCurrentAuction(chainId);
      
      if (auction && auction.id !== lastAuctionId) {
        lastAuctionId = auction.id;
        
        const solution = this.solver.buildSolution(auction, liquidityPools);
        const metrics = await this.analyzeSolution(auction, solution, liquidityPools);
        
        if (metrics) {
          results.push(metrics);
          onResult?.(metrics);
          
          console.log(`   Auction ${metrics.auctionId}: ${metrics.fillRate.toFixed(1)}% fill, ${metrics.avgSurplusBps} bps surplus, score: ${metrics.competitiveScore}`);
        }
      }

      await new Promise(r => setTimeout(r, 2000));
    }

    return results;
  }

  /**
   * Analyze a solution and compute metrics
   */
  private async analyzeSolution(
    auction: CowAuction,
    solution: CowSolution | null,
    _liquidityPools: Map<string, { reserve0: bigint; reserve1: bigint; token0: Address; token1: Address }>
  ): Promise<SolverMetrics> {
    const metrics: SolverMetrics = {
      auctionId: auction.id,
      chainId: auction.chainId,
      totalOrders: auction.orders.length,
      ordersFilled: 0,
      fillRate: 0,
      totalSurplusWei: 0n,
      totalSurplusUsd: 0,
      avgSurplusBps: 0,
      estimatedGasUsed: 0n,
      estimatedGasCostUsd: 0,
      cowMatches: 0,
      externalRoutes: 0,
      competitive: false,
      competitiveScore: 0,
      issues: [],
    };

    if (!solution || solution.trades.length === 0) {
      metrics.issues.push('No trades generated - check liquidity pools');
      return metrics;
    }

    metrics.ordersFilled = solution.trades.length;
    metrics.fillRate = (metrics.ordersFilled / metrics.totalOrders) * 100;

    // Calculate surplus for each trade
    let totalSurplusBps = 0;
    
    for (const trade of solution.trades) {
      const order = auction.orders.find(o => o.uid === trade.orderUid);
      if (!order) continue;

      // Surplus = (executed buy - required buy) / required buy
      const surplusAmount = trade.executedBuyAmount - order.buyAmount;
      const surplusBps = Number((surplusAmount * 10000n) / order.buyAmount);
      totalSurplusBps += surplusBps;
      
      metrics.totalSurplusWei += surplusAmount;

      // Check if this is a CoW match (internal) or external route
      const hasReverseOrder = auction.orders.some(o => 
        o.sellToken.toLowerCase() === order.buyToken.toLowerCase() &&
        o.buyToken.toLowerCase() === order.sellToken.toLowerCase()
      );
      
      if (hasReverseOrder) {
        metrics.cowMatches++;
      } else {
        metrics.externalRoutes++;
      }
    }

    metrics.avgSurplusBps = metrics.ordersFilled > 0 
      ? Math.round(totalSurplusBps / metrics.ordersFilled)
      : 0;

    // Estimate gas usage (rough estimates)
    const BASE_GAS = 100000n;
    const GAS_PER_TRADE = 80000n;
    const GAS_PER_INTERACTION = 50000n;
    
    metrics.estimatedGasUsed = BASE_GAS + 
      (GAS_PER_TRADE * BigInt(solution.trades.length)) +
      (GAS_PER_INTERACTION * BigInt(solution.interactions.length));

    // Estimate gas cost in USD (assuming 30 gwei, $3000 ETH)
    const gasPriceWei = 30n * 10n ** 9n;
    const gasCostWei = metrics.estimatedGasUsed * gasPriceWei;
    metrics.estimatedGasCostUsd = Number(gasCostWei) / 1e18 * 3000;

    // Calculate competitive score (0-100)
    metrics.competitiveScore = this.calculateCompetitiveScore(metrics);
    metrics.competitive = metrics.competitiveScore >= 50;

    // Identify issues
    if (metrics.fillRate < 50) {
      metrics.issues.push(`Low fill rate: ${metrics.fillRate.toFixed(1)}% (need liquidity for more pairs)`);
    }
    if (metrics.avgSurplusBps < 5) {
      metrics.issues.push(`Low surplus: ${metrics.avgSurplusBps} bps (prices may not be competitive)`);
    }
    if (metrics.cowMatches === 0 && metrics.ordersFilled > 1) {
      metrics.issues.push('No CoW matches - missing internal matching optimization');
    }
    if (metrics.estimatedGasCostUsd > 50) {
      metrics.issues.push(`High gas cost: $${metrics.estimatedGasCostUsd.toFixed(2)} (optimize interactions)`);
    }

    return metrics;
  }

  /**
   * Calculate competitive score (0-100)
   */
  private calculateCompetitiveScore(metrics: SolverMetrics): number {
    let score = 0;

    // Fill rate (40 points max)
    score += Math.min(40, (metrics.fillRate / 100) * 40);

    // Surplus (30 points max)
    // 10+ bps is excellent, 5 bps is good, 0 is bad
    const surplusScore = Math.min(30, (metrics.avgSurplusBps / 10) * 30);
    score += surplusScore;

    // CoW matching bonus (15 points max)
    // Internal matching is more efficient
    if (metrics.ordersFilled > 0) {
      const cowRatio = metrics.cowMatches / metrics.ordersFilled;
      score += cowRatio * 15;
    }

    // Gas efficiency (15 points max)
    // Lower gas = better
    const gasPerTrade = metrics.ordersFilled > 0 
      ? Number(metrics.estimatedGasUsed) / metrics.ordersFilled 
      : 200000;
    const gasScore = Math.max(0, 15 - (gasPerTrade / 200000) * 15);
    score += gasScore;

    return Math.round(score);
  }

  /**
   * Compare our solution to the winning solution
   */
  private compareSolutions(
    ourMetrics: SolverMetrics | null,
    winningSolution: WinningSolutionInfo | null
  ): ComparisonResult {
    const reasons: string[] = [];
    let wouldWin = false;
    let surplusDiff = 0n;
    let fillRateDiff = 0;

    if (!ourMetrics) {
      reasons.push('We did not generate a solution');
      return { wouldWin: false, surplusDifference: 0n, fillRateDifference: 0, reasons };
    }

    if (!winningSolution) {
      reasons.push('No winning solution to compare against');
      return { wouldWin: ourMetrics.ordersFilled > 0, surplusDifference: 0n, fillRateDifference: 0, reasons };
    }

    // Compare surplus
    surplusDiff = ourMetrics.totalSurplusWei - winningSolution.totalSurplusWei;
    if (surplusDiff > 0n) {
      reasons.push(`Our surplus is ${formatEther(surplusDiff)} higher`);
    } else if (surplusDiff < 0n) {
      reasons.push(`Winner's surplus is ${formatEther(-surplusDiff)} higher`);
    }

    // Compare fill count
    fillRateDiff = ourMetrics.ordersFilled - winningSolution.ordersFilled;
    if (fillRateDiff > 0) {
      reasons.push(`We fill ${fillRateDiff} more orders`);
    } else if (fillRateDiff < 0) {
      reasons.push(`Winner fills ${-fillRateDiff} more orders`);
    }

    // CoW scoring is primarily based on surplus
    wouldWin = surplusDiff > 0n;

    if (wouldWin) {
      reasons.push('✅ Our solution would win based on surplus');
    } else {
      reasons.push('❌ Winner has better surplus');
    }

    return { wouldWin, surplusDifference: surplusDiff, fillRateDifference: fillRateDiff, reasons };
  }

  private _getPoolKey(token0: Address, token1: Address): string {
    const [a, b] = token0.toLowerCase() < token1.toLowerCase()
      ? [token0, token1]
      : [token1, token0];
    return `${a}-${b}`;
  }
  
  // Expose for potential external use
  getPoolKey = this._getPoolKey.bind(this);
}

/**
 * Print a formatted report of solver metrics
 */
export function printSolverReport(metrics: SolverMetrics): void {
  console.log('\n' + '='.repeat(60));
  console.log(`🐮 SOLVER VALIDATION REPORT - Auction #${metrics.auctionId}`);
  console.log('='.repeat(60));
  
  console.log('\n📊 PERFORMANCE METRICS');
  console.log(`   Fill Rate:      ${metrics.fillRate.toFixed(1)}% (${metrics.ordersFilled}/${metrics.totalOrders} orders)`);
  console.log(`   Avg Surplus:    ${metrics.avgSurplusBps} bps`);
  console.log(`   CoW Matches:    ${metrics.cowMatches} internal, ${metrics.externalRoutes} external`);
  console.log(`   Est. Gas:       ${metrics.estimatedGasUsed.toLocaleString()} (~$${metrics.estimatedGasCostUsd.toFixed(2)})`);
  
  console.log('\n🏆 COMPETITIVE ASSESSMENT');
  console.log(`   Score:          ${metrics.competitiveScore}/100`);
  console.log(`   Competitive:    ${metrics.competitive ? '✅ YES' : '❌ NO'}`);
  
  if (metrics.issues.length > 0) {
    console.log('\n⚠️  ISSUES TO ADDRESS');
    for (const issue of metrics.issues) {
      console.log(`   • ${issue}`);
    }
  }
  
  console.log('\n' + '='.repeat(60));
}

/**
 * Print comparison between our solution and winning solution
 */
export function printComparisonReport(result: CompetitionResult): void {
  console.log('\n' + '='.repeat(60));
  console.log('🏁 COMPETITION COMPARISON');
  console.log('='.repeat(60));
  
  if (result.ourSolution) {
    console.log(`\n📊 OUR SOLUTION`);
    console.log(`   Orders Filled: ${result.ourSolution.ordersFilled}`);
    console.log(`   Total Surplus: ${formatEther(result.ourSolution.totalSurplusWei)} ETH`);
    console.log(`   Score:         ${result.ourSolution.competitiveScore}/100`);
  }
  
  if (result.winningSolution) {
    console.log(`\n🥇 WINNING SOLUTION`);
    console.log(`   Solver:        ${result.winningSolution.solver}`);
    console.log(`   Orders Filled: ${result.winningSolution.ordersFilled}`);
    console.log(`   Total Surplus: ${formatEther(result.winningSolution.totalSurplusWei)} ETH`);
  }
  
  console.log(`\n📈 COMPARISON`);
  for (const reason of result.comparison.reasons) {
    console.log(`   ${reason}`);
  }
  
  console.log(`\n   Would Win: ${result.comparison.wouldWin ? '✅ YES' : '❌ NO'}`);
  console.log('='.repeat(60));
}

