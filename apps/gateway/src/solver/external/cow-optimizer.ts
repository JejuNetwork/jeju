/**
 * CoW Solver Optimizer
 * 
 * Enhances solution quality through:
 * 1. Multi-hop routing (A→C via B when direct A→C is worse)
 * 2. Internal CoW matching (match buy/sell orders directly)
 * 3. Surplus calculation
 */

import { type Address } from 'viem';
import type { CowOrder, CowAuction, CowSolution } from './cow';

export interface LiquidityPool {
  address: Address;
  token0: Address;
  token1: Address;
  reserve0: bigint;
  reserve1: bigint;
  fee: number; // In bps (e.g., 30 = 0.3%)
}

export interface PriceFeed {
  token: Address;
  priceUsd: number;
  decimals: number;
}

export interface OptimizedSolution extends CowSolution {
  routing: Array<{
    orderUid: `0x${string}`;
    path: Address[];
    type: 'direct' | 'multi-hop' | 'cow-match';
    surplusBps: number;
  }>;
  totalSurplusUsd: number;
  gasEstimate: bigint;
}

export class CowSolverOptimizer {
  private pools: Map<string, LiquidityPool> = new Map();
  private prices: Map<string, PriceFeed> = new Map();
  private intermediateTokens: Address[] = [];

  constructor() {
    this.intermediateTokens = [
      '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
      '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48', // USDC
      '0xdAC17F958D2ee523a2206206994597C13D831ec7', // USDT
    ].map(a => a.toLowerCase() as Address);
  }

  setPools(pools: LiquidityPool[]): void {
    this.pools.clear();
    for (const pool of pools) {
      const key = this.getPoolKey(pool.token0, pool.token1);
      this.pools.set(key, pool);
    }
  }

  setPrices(prices: PriceFeed[]): void {
    this.prices.clear();
    for (const price of prices) {
      this.prices.set(price.token.toLowerCase(), price);
    }
  }

  /**
   * Build an optimized solution for an auction
   */
  buildOptimizedSolution(auction: CowAuction): OptimizedSolution | null {
    const trades: CowSolution['trades'] = [];
    const interactions: CowSolution['interactions'] = [];
    const routing: OptimizedSolution['routing'] = [];
    const prices: Record<string, bigint> = {};

    // Step 1: Find CoW matches
    const { matched, unmatched } = this.findCowMatches(auction.orders);
    
    for (const match of matched) {
      trades.push({
        orderUid: match.buyOrder.uid,
        executedSellAmount: match.buyOrder.sellAmount,
        executedBuyAmount: match.executedBuyAmount,
      });
      trades.push({
        orderUid: match.sellOrder.uid,
        executedSellAmount: match.sellOrder.sellAmount,
        executedBuyAmount: match.executedSellAmount,
      });
      
      routing.push({
        orderUid: match.buyOrder.uid,
        path: [match.buyOrder.sellToken, match.buyOrder.buyToken],
        type: 'cow-match',
        surplusBps: match.surplusBps,
      });
      routing.push({
        orderUid: match.sellOrder.uid,
        path: [match.sellOrder.sellToken, match.sellOrder.buyToken],
        type: 'cow-match',
        surplusBps: match.surplusBps,
      });
    }

    // Step 2: Route remaining orders through pools
    for (const order of unmatched) {
      const route = this.findBestRoute(order);
      if (!route) continue;

      trades.push({
        orderUid: order.uid,
        executedSellAmount: order.sellAmount,
        executedBuyAmount: route.amountOut,
      });

      routing.push({
        orderUid: order.uid,
        path: route.path,
        type: route.path.length > 2 ? 'multi-hop' : 'direct',
        surplusBps: route.surplusBps,
      });
    }

    if (trades.length === 0) return null;

    // Set clearing prices
    for (const order of auction.orders) {
      if (!prices[order.sellToken.toLowerCase()]) {
        prices[order.sellToken.toLowerCase()] = BigInt(10) ** BigInt(18);
      }
    }

    // Calculate total surplus
    let totalSurplusUsd = 0;
    for (const r of routing) {
      const order = auction.orders.find(o => o.uid === r.orderUid);
      if (order) {
        const trade = trades.find(t => t.orderUid === r.orderUid);
        if (trade) {
          const surplus = trade.executedBuyAmount - order.buyAmount;
          const price = this.prices.get(order.buyToken.toLowerCase());
          if (price) {
            totalSurplusUsd += Number(surplus) / (10 ** price.decimals) * price.priceUsd;
          }
        }
      }
    }

    // Estimate gas
    const BASE_GAS = BigInt(100000);
    const GAS_PER_TRADE = BigInt(80000);
    
    const gasEstimate = BASE_GAS + GAS_PER_TRADE * BigInt(trades.length);

    return {
      auctionId: auction.id,
      trades,
      interactions,
      prices,
      routing,
      totalSurplusUsd,
      gasEstimate,
    };
  }

  /**
   * Find orders that can be matched internally (Coincidence of Wants)
   */
  private findCowMatches(orders: CowOrder[]): {
    matched: Array<{
      buyOrder: CowOrder;
      sellOrder: CowOrder;
      executedBuyAmount: bigint;
      executedSellAmount: bigint;
      surplusBps: number;
    }>;
    unmatched: CowOrder[];
  } {
    const matched: Array<{
      buyOrder: CowOrder;
      sellOrder: CowOrder;
      executedBuyAmount: bigint;
      executedSellAmount: bigint;
      surplusBps: number;
    }> = [];
    const matchedIds = new Set<string>();

    for (let i = 0; i < orders.length; i++) {
      if (matchedIds.has(orders[i].uid)) continue;

      for (let j = i + 1; j < orders.length; j++) {
        if (matchedIds.has(orders[j].uid)) continue;

        const buyer = orders[i];
        const seller = orders[j];

        // Check if they match (buyer sells A for B, seller sells B for A)
        if (buyer.sellToken.toLowerCase() === seller.buyToken.toLowerCase() &&
            buyer.buyToken.toLowerCase() === seller.sellToken.toLowerCase()) {
          
          const buyerProvides = buyer.sellAmount;
          const sellerWants = seller.buyAmount;
          const sellerProvides = seller.sellAmount;
          const buyerWants = buyer.buyAmount;
          
          if (buyerProvides >= sellerWants && sellerProvides >= buyerWants) {
            const buyerSurplus = sellerProvides - buyerWants;
            const sellerSurplus = buyerProvides - sellerWants;
            
            const surplusBps = Number(
              ((buyerSurplus + sellerSurplus) * BigInt(10000)) / 
              (buyerWants + sellerWants)
            );

            matched.push({
              buyOrder: buyer,
              sellOrder: seller,
              executedBuyAmount: sellerProvides,
              executedSellAmount: buyerProvides,
              surplusBps,
            });

            matchedIds.add(buyer.uid);
            matchedIds.add(seller.uid);
            break;
          }
        }
      }
    }

    const unmatched = orders.filter(o => !matchedIds.has(o.uid));
    return { matched, unmatched };
  }

  /**
   * Find the best route for an order
   */
  private findBestRoute(order: CowOrder): {
    path: Address[];
    amountOut: bigint;
    surplusBps: number;
  } | null {
    const directRoute = this.getDirectRoute(order);
    const multiHopRoutes = this.getMultiHopRoutes(order);

    let bestRoute = directRoute;
    
    for (const route of multiHopRoutes) {
      if (!bestRoute || route.amountOut > bestRoute.amountOut) {
        bestRoute = route;
      }
    }

    if (!bestRoute || bestRoute.amountOut < order.buyAmount) {
      return null;
    }

    return bestRoute;
  }

  private getDirectRoute(order: CowOrder): {
    path: Address[];
    amountOut: bigint;
    surplusBps: number;
  } | null {
    const poolKey = this.getPoolKey(order.sellToken, order.buyToken);
    const pool = this.pools.get(poolKey);
    
    if (!pool) return null;

    const amountOut = this.getAmountOut(order.sellAmount, order.sellToken, pool);

    if (amountOut < order.buyAmount) return null;

    const surplusBps = Number(
      ((amountOut - order.buyAmount) * BigInt(10000)) / order.buyAmount
    );

    return {
      path: [order.sellToken, order.buyToken],
      amountOut,
      surplusBps,
    };
  }

  private getMultiHopRoutes(order: CowOrder): Array<{
    path: Address[];
    amountOut: bigint;
    surplusBps: number;
  }> {
    const routes: Array<{
      path: Address[];
      amountOut: bigint;
      surplusBps: number;
    }> = [];

    for (const intermediate of this.intermediateTokens) {
      if (intermediate === order.sellToken.toLowerCase() ||
          intermediate === order.buyToken.toLowerCase()) {
        continue;
      }

      const pool1Key = this.getPoolKey(order.sellToken, intermediate as Address);
      const pool2Key = this.getPoolKey(intermediate as Address, order.buyToken);
      
      const pool1 = this.pools.get(pool1Key);
      const pool2 = this.pools.get(pool2Key);
      
      if (!pool1 || !pool2) continue;

      const intermediateAmount = this.getAmountOut(order.sellAmount, order.sellToken, pool1);
      const finalAmount = this.getAmountOut(intermediateAmount, intermediate as Address, pool2);

      if (finalAmount < order.buyAmount) continue;

      const surplusBps = Number(
        ((finalAmount - order.buyAmount) * BigInt(10000)) / order.buyAmount
      );

      routes.push({
        path: [order.sellToken, intermediate as Address, order.buyToken],
        amountOut: finalAmount,
        surplusBps,
      });
    }

    return routes;
  }

  private getAmountOut(amountIn: bigint, tokenIn: Address, pool: LiquidityPool): bigint {
    const isToken0 = pool.token0.toLowerCase() === tokenIn.toLowerCase();
    const reserveIn = isToken0 ? pool.reserve0 : pool.reserve1;
    const reserveOut = isToken0 ? pool.reserve1 : pool.reserve0;

    const feeMultiplier = BigInt(10000 - pool.fee);
    const amountInWithFee = amountIn * feeMultiplier;
    
    const numerator = amountInWithFee * reserveOut;
    const denominator = reserveIn * BigInt(10000) + amountInWithFee;
    
    return numerator / denominator;
  }

  private getPoolKey(token0: Address, token1: Address): string {
    const [a, b] = [token0.toLowerCase(), token1.toLowerCase()].sort();
    return `${a}-${b}`;
  }

  /**
   * Get optimization stats
   */
  getStats(solution: OptimizedSolution): {
    directRoutes: number;
    multiHopRoutes: number;
    cowMatches: number;
    avgSurplusBps: number;
    gasPerTrade: bigint;
  } {
    const directRoutes = solution.routing.filter(r => r.type === 'direct').length;
    const multiHopRoutes = solution.routing.filter(r => r.type === 'multi-hop').length;
    const cowMatches = solution.routing.filter(r => r.type === 'cow-match').length;
    
    const avgSurplusBps = solution.routing.length > 0
      ? Math.round(solution.routing.reduce((sum, r) => sum + r.surplusBps, 0) / solution.routing.length)
      : 0;

    const gasPerTrade = solution.trades.length > 0
      ? solution.gasEstimate / BigInt(solution.trades.length)
      : BigInt(0);

    return {
      directRoutes,
      multiHopRoutes,
      cowMatches,
      avgSurplusBps,
      gasPerTrade,
    };
  }
}

/**
 * Print optimization report
 */
export function printOptimizationReport(solution: OptimizedSolution, optimizer: CowSolverOptimizer): void {
  const stats = optimizer.getStats(solution);
  
  console.log('\n' + '='.repeat(60));
  console.log('OPTIMIZED SOLUTION REPORT');
  console.log('='.repeat(60));
  
  console.log(`\nROUTING BREAKDOWN`);
  console.log(`   Direct Routes:    ${stats.directRoutes}`);
  console.log(`   Multi-Hop Routes: ${stats.multiHopRoutes}`);
  console.log(`   CoW Matches:      ${stats.cowMatches}`);
  console.log(`   Total Trades:     ${solution.trades.length}`);
  
  console.log(`\nSURPLUS`);
  console.log(`   Average:    ${stats.avgSurplusBps} bps`);
  console.log(`   Total USD:  $${solution.totalSurplusUsd.toFixed(2)}`);
  
  console.log(`\nGAS`);
  console.log(`   Total:      ${solution.gasEstimate.toLocaleString()}`);
  console.log(`   Per Trade:  ${stats.gasPerTrade.toLocaleString()}`);
  
  console.log('='.repeat(60));
}



