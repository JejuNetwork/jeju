/**
 * DEX Arbitrage Strategy - Optimized with closed-form solutions
 * 
 * Features:
 * - Optimal arbitrage sizing using mathematical formulas
 * - Graph-based path finding for multi-hop arbitrage
 * - Dynamic gas estimation
 * - Cross-pool and triangular arbitrage detection
 */

import type { ChainId, Pool, ArbitrageOpportunity, StrategyConfig } from '../autocrat-types';
import type { SyncEvent, SwapEvent } from '../engine/collector';
import {
  getAmountOut,
  getSpotPrice,
  calculateOptimalCrossPoolArbitrage,
  calculateOptimalTriangularArbitrage,
  calculateOptimalMultiHopArbitrage,
  calculateNetProfit,
  bigintSqrt,
  bigintMin,
  bigintMax,
} from '../lib/math';

interface PoolState {
  pool: Pool;
  reserve0: bigint;
  reserve1: bigint;
  lastUpdate: number;
}

interface ArbitragePath {
  pools: Pool[];
  tokenPath: string[];
  optimalInput: bigint;
  expectedOutput: bigint;
  profit: bigint;
  profitBps: number;
  pathType: 'cross_pool' | 'triangular' | 'multi_hop';
}

// Graph node for path finding
interface TokenNode {
  address: string;
  pools: Map<string, PoolEdge>; // token address -> pool edge
}

interface PoolEdge {
  pool: PoolState;
  otherToken: string;
  isToken0ToToken1: boolean;
}

const FEE_BPS = 30;
const MIN_LIQUIDITY = BigInt(1e18);
const OPPORTUNITY_TTL_MS = 2000;
const MAX_PATH_LENGTH = 4;
const MIN_TRADE_AMOUNT = BigInt(1e17); // 0.1 ETH minimum
const MAX_TRADE_AMOUNT = BigInt(100e18); // 100 ETH maximum

// Gas estimates
const GAS_PER_SWAP = 150000n;
const GAS_BASE = 50000n;

export class DexArbitrageStrategy {
  private pools: Map<string, PoolState> = new Map();
  private tokenGraph: Map<string, TokenNode> = new Map();
  private opportunities: Map<string, ArbitrageOpportunity> = new Map();
  private config: StrategyConfig;
  private chainId: ChainId;
  private currentBaseFee: bigint = BigInt(30e9); // 30 gwei default
  private currentPriorityFee: bigint = BigInt(2e9); // 2 gwei default

  constructor(chainId: ChainId, config: StrategyConfig) {
    this.chainId = chainId;
    this.config = config;
  }

  /**
   * Initialize with pools and build token graph
   */
  initialize(pools: Pool[]): void {
    console.log(`🔄 Initializing DEX arbitrage strategy with ${pools.length} pools`);

    for (const pool of pools) {
      if (pool.chainId === this.chainId) {
        this.addPool(pool);
      }
    }

    console.log(`   Indexed ${this.pools.size} pools, ${this.tokenGraph.size} unique tokens`);
  }

  /**
   * Add a pool and update the token graph
   */
  addPool(pool: Pool): void {
    const poolState: PoolState = {
      pool,
      reserve0: BigInt(pool.reserve0 ?? '0'),
      reserve1: BigInt(pool.reserve1 ?? '0'),
      lastUpdate: pool.lastUpdate || Date.now(),
    };

    this.pools.set(pool.address.toLowerCase(), poolState);

    // Build graph edges
    this.addToGraph(pool.token0.address, pool.token1.address, poolState, true);
    this.addToGraph(pool.token1.address, pool.token0.address, poolState, false);
  }

  /**
   * Handle pool sync event
   */
  onSync(event: SyncEvent): void {
    const poolState = this.pools.get(event.poolAddress.toLowerCase());
    if (!poolState) return;

    poolState.reserve0 = event.reserve0;
    poolState.reserve1 = event.reserve1;
    poolState.lastUpdate = Date.now();

    // Check for arbitrage opportunities immediately
    this.checkAllArbitrageForPool(poolState);
  }

  /**
   * Handle swap event
   */
  onSwap(event: SwapEvent): void {
    const poolState = this.pools.get(event.poolAddress.toLowerCase());
    if (!poolState) return;

    // Update reserves based on swap
    // Note: Real implementation would calculate exact reserve changes
    this.checkAllArbitrageForPool(poolState);
  }

  /**
   * Update gas prices for profit calculation
   */
  updateGasPrices(baseFee: bigint, priorityFee: bigint): void {
    this.currentBaseFee = baseFee;
    this.currentPriorityFee = priorityFee;
  }

  /**
   * Get current opportunities sorted by profit
   */
  getOpportunities(): ArbitrageOpportunity[] {
    const now = Date.now();

    // Clean expired opportunities
    for (const [id, opp] of this.opportunities) {
      if (opp.expiresAt < now) {
        this.opportunities.delete(id);
      }
    }

    return Array.from(this.opportunities.values())
      .filter(o => o.status === 'DETECTED')
      .sort((a, b) => Number(BigInt(b.netProfitWei) - BigInt(a.netProfitWei)));
  }

  markExecuting(opportunityId: string): void {
    const opp = this.opportunities.get(opportunityId);
    if (opp) opp.status = 'EXECUTING';
  }

  markCompleted(opportunityId: string, success: boolean): void {
    const opp = this.opportunities.get(opportunityId);
    if (opp) opp.status = success ? 'COMPLETED' : 'FAILED';
  }

  // ============ Private: Graph Building ============

  private addToGraph(
    fromToken: string,
    toToken: string,
    poolState: PoolState,
    isToken0ToToken1: boolean
  ): void {
    const from = fromToken.toLowerCase();
    const to = toToken.toLowerCase();

    if (!this.tokenGraph.has(from)) {
      this.tokenGraph.set(from, {
        address: from,
        pools: new Map(),
      });
    }

    const node = this.tokenGraph.get(from)!;
    node.pools.set(to, {
      pool: poolState,
      otherToken: to,
      isToken0ToToken1,
    });
  }

  // ============ Private: Arbitrage Detection ============

  private checkAllArbitrageForPool(poolState: PoolState): void {
    const { token0, token1 } = poolState.pool;

    // 1. Check cross-pool arbitrage (same pair, different pools)
    this.findCrossPoolArbitrage(token0.address, token1.address);

    // 2. Check triangular arbitrage starting from each token
    this.findTriangularArbitrage(token0.address);
    this.findTriangularArbitrage(token1.address);

    // 3. Check multi-hop paths (up to MAX_PATH_LENGTH)
    this.findMultiHopArbitrage(token0.address);
  }

  /**
   * Find cross-pool arbitrage between pools trading the same pair
   */
  private findCrossPoolArbitrage(token0: string, token1: string): void {
    const t0 = token0.toLowerCase();
    const t1 = token1.toLowerCase();

    const node = this.tokenGraph.get(t0);
    if (!node) return;

    // Find all pools that trade t0/t1
    const samePairPools: PoolState[] = [];
    for (const [otherToken, edge] of node.pools) {
      if (otherToken === t1 && this.hasMinLiquidity(edge.pool)) {
        samePairPools.push(edge.pool);
      }
    }

    if (samePairPools.length < 2) return;

    // Compare each pair of pools
    for (let i = 0; i < samePairPools.length; i++) {
      for (let j = i + 1; j < samePairPools.length; j++) {
        const pool1 = samePairPools[i];
        const pool2 = samePairPools[j];

        // Try buying from pool1, selling to pool2
        this.evaluateCrossPoolArb(pool1, pool2, t0, t1);

        // Try buying from pool2, selling to pool1
        this.evaluateCrossPoolArb(pool2, pool1, t0, t1);
      }
    }
  }

  private evaluateCrossPoolArb(
    buyPool: PoolState,
    sellPool: PoolState,
    token0: string,
    token1: string
  ): void {
    // Determine which direction has the arbitrage
    const buyPrice = getSpotPrice(buyPool.reserve0, buyPool.reserve1);
    const sellPrice = getSpotPrice(sellPool.reserve0, sellPool.reserve1);

    if (buyPrice >= sellPrice) return; // No arbitrage

    // Calculate optimal input using closed-form solution
    const { optimalInput, expectedProfit } = calculateOptimalCrossPoolArbitrage(
      buyPool.reserve0,
      buyPool.reserve1,
      sellPool.reserve1, // Note: reversed for sell direction
      sellPool.reserve0
    );

    if (optimalInput <= 0n || expectedProfit <= 0n) return;

    // Clamp to reasonable range
    const clampedInput = bigintMin(
      bigintMax(optimalInput, MIN_TRADE_AMOUNT),
      MAX_TRADE_AMOUNT
    );

    // Recalculate profit with clamped input
    const buyOutput = getAmountOut(clampedInput, buyPool.reserve0, buyPool.reserve1);
    const sellOutput = getAmountOut(buyOutput, sellPool.reserve1, sellPool.reserve0);
    const actualProfit = sellOutput - clampedInput;

    if (actualProfit <= 0n) return;

    const profitBps = Number((actualProfit * 10000n) / clampedInput);
    if (profitBps < this.config.minProfitBps) return;

    this.recordOpportunity({
      pools: [buyPool.pool, sellPool.pool],
      tokenPath: [token0, token1, token0],
      optimalInput: clampedInput,
      expectedOutput: sellOutput,
      profit: actualProfit,
      profitBps,
      pathType: 'cross_pool',
    });
  }

  /**
   * Find triangular arbitrage: A -> B -> C -> A
   */
  private findTriangularArbitrage(startToken: string): void {
    const start = startToken.toLowerCase();
    const startNode = this.tokenGraph.get(start);
    if (!startNode) return;

    // First hop: start -> token1
    for (const [token1, edge1] of startNode.pools) {
      if (!this.hasMinLiquidity(edge1.pool)) continue;

      const node1 = this.tokenGraph.get(token1);
      if (!node1) continue;

      // Second hop: token1 -> token2
      for (const [token2, edge2] of node1.pools) {
        if (token2 === start || !this.hasMinLiquidity(edge2.pool)) continue;

        const node2 = this.tokenGraph.get(token2);
        if (!node2) continue;

        // Third hop: token2 -> start (must complete the triangle)
        const edge3 = node2.pools.get(start);
        if (!edge3 || !this.hasMinLiquidity(edge3.pool)) continue;

        // Don't reuse same pool
        if (
          edge1.pool.pool.address === edge2.pool.pool.address ||
          edge2.pool.pool.address === edge3.pool.pool.address ||
          edge1.pool.pool.address === edge3.pool.pool.address
        ) {
          continue;
        }

        this.evaluateTriangularArb(
          start,
          token1,
          token2,
          edge1,
          edge2,
          edge3
        );
      }
    }
  }

  private evaluateTriangularArb(
    start: string,
    token1: string,
    token2: string,
    edge1: PoolEdge,
    edge2: PoolEdge,
    edge3: PoolEdge
  ): void {
    // Get reserves for each swap direction
    const [r1In, r1Out] = edge1.isToken0ToToken1
      ? [edge1.pool.reserve0, edge1.pool.reserve1]
      : [edge1.pool.reserve1, edge1.pool.reserve0];

    const [r2In, r2Out] = edge2.isToken0ToToken1
      ? [edge2.pool.reserve0, edge2.pool.reserve1]
      : [edge2.pool.reserve1, edge2.pool.reserve0];

    const [r3In, r3Out] = edge3.isToken0ToToken1
      ? [edge3.pool.reserve0, edge3.pool.reserve1]
      : [edge3.pool.reserve1, edge3.pool.reserve0];

    // Calculate optimal input using numerical optimization
    const { optimalInput, expectedProfit } = calculateOptimalTriangularArbitrage(
      r1In, r1Out,
      r2In, r2Out,
      r3In, r3Out
    );

    if (optimalInput <= 0n || expectedProfit <= 0n) return;

    // Clamp input
    const clampedInput = bigintMin(
      bigintMax(optimalInput, MIN_TRADE_AMOUNT),
      MAX_TRADE_AMOUNT
    );

    // Recalculate with clamped input
    const out1 = getAmountOut(clampedInput, r1In, r1Out);
    const out2 = getAmountOut(out1, r2In, r2Out);
    const out3 = getAmountOut(out2, r3In, r3Out);
    const actualProfit = out3 - clampedInput;

    if (actualProfit <= 0n) return;

    const profitBps = Number((actualProfit * 10000n) / clampedInput);
    if (profitBps < this.config.minProfitBps) return;

    this.recordOpportunity({
      pools: [edge1.pool.pool, edge2.pool.pool, edge3.pool.pool],
      tokenPath: [start, token1, token2, start],
      optimalInput: clampedInput,
      expectedOutput: out3,
      profit: actualProfit,
      profitBps,
      pathType: 'triangular',
    });
  }

  /**
   * Find multi-hop arbitrage using BFS
   */
  private findMultiHopArbitrage(startToken: string): void {
    const start = startToken.toLowerCase();
    const startNode = this.tokenGraph.get(start);
    if (!startNode) return;

    // BFS to find profitable cycles back to start
    interface PathState {
      token: string;
      pools: PoolEdge[];
      visited: Set<string>;
    }

    const queue: PathState[] = [];

    // Initialize with first-hop paths
    for (const [nextToken, edge] of startNode.pools) {
      if (!this.hasMinLiquidity(edge.pool)) continue;

      queue.push({
        token: nextToken,
        pools: [edge],
        visited: new Set([start, nextToken]),
      });
    }

    while (queue.length > 0) {
      const state = queue.shift()!;

      // Check if path length exceeded
      if (state.pools.length >= MAX_PATH_LENGTH) continue;

      const currentNode = this.tokenGraph.get(state.token);
      if (!currentNode) continue;

      for (const [nextToken, edge] of currentNode.pools) {
        if (!this.hasMinLiquidity(edge.pool)) continue;

        // Don't reuse same pool
        if (state.pools.some(e => e.pool.pool.address === edge.pool.pool.address)) continue;

        if (nextToken === start && state.pools.length >= 2) {
          // Found a cycle back to start - evaluate it
          this.evaluateMultiHopArb(start, [...state.pools, edge]);
        } else if (!state.visited.has(nextToken) && state.pools.length < MAX_PATH_LENGTH - 1) {
          // Continue exploring
          const newVisited = new Set(state.visited);
          newVisited.add(nextToken);
          queue.push({
            token: nextToken,
            pools: [...state.pools, edge],
            visited: newVisited,
          });
        }
      }
    }
  }

  private evaluateMultiHopArb(startToken: string, edges: PoolEdge[]): void {
    // Build pool array for calculation
    const pools = edges.map(edge => {
      const [reserveIn, reserveOut] = edge.isToken0ToToken1
        ? [edge.pool.reserve0, edge.pool.reserve1]
        : [edge.pool.reserve1, edge.pool.reserve0];
      return { reserveIn, reserveOut };
    });

    // Calculate optimal input
    const { optimalInput, expectedProfit } = calculateOptimalMultiHopArbitrage(pools);

    if (optimalInput <= 0n || expectedProfit <= 0n) return;

    // Clamp input
    const clampedInput = bigintMin(
      bigintMax(optimalInput, MIN_TRADE_AMOUNT),
      MAX_TRADE_AMOUNT
    );

    // Recalculate with clamped input
    let current = clampedInput;
    for (const pool of pools) {
      current = getAmountOut(current, pool.reserveIn, pool.reserveOut);
      if (current <= 0n) return;
    }
    const actualProfit = current - clampedInput;

    if (actualProfit <= 0n) return;

    const profitBps = Number((actualProfit * 10000n) / clampedInput);
    if (profitBps < this.config.minProfitBps) return;

    // Build token path
    const tokenPath = [startToken];
    for (const edge of edges) {
      tokenPath.push(edge.otherToken);
    }

    this.recordOpportunity({
      pools: edges.map(e => e.pool.pool),
      tokenPath,
      optimalInput: clampedInput,
      expectedOutput: current,
      profit: actualProfit,
      profitBps,
      pathType: 'multi_hop',
    });
  }

  // ============ Private: Opportunity Recording ============

  private recordOpportunity(path: ArbitragePath): void {
    // Calculate gas cost
    const gasUnits = GAS_BASE + GAS_PER_SWAP * BigInt(path.pools.length);
    const netProfit = calculateNetProfit(
      path.profit,
      gasUnits,
      this.currentBaseFee,
      this.currentPriorityFee
    );

    // Skip if not profitable after gas
    if (netProfit <= 0n) {
      return;
    }

    const id = `arb-${this.chainId}-${path.pathType}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const opportunity: ArbitrageOpportunity = {
      id,
      type: 'DEX_ARBITRAGE',
      chainId: this.chainId,
      inputToken: {
        address: path.tokenPath[0],
        symbol: '',
        decimals: 18,
        chainId: this.chainId,
      },
      outputToken: {
        address: path.tokenPath[path.tokenPath.length - 1],
        symbol: '',
        decimals: 18,
        chainId: this.chainId,
      },
      path: path.pools,
      inputAmount: path.optimalInput.toString(),
      expectedOutput: path.expectedOutput.toString(),
      expectedProfit: path.profit.toString(),
      expectedProfitBps: path.profitBps,
      gasEstimate: gasUnits.toString(),
      netProfitWei: netProfit.toString(),
      netProfitUsd: this.calculateUsdProfit(netProfit),
      detectedAt: Date.now(),
      expiresAt: Date.now() + OPPORTUNITY_TTL_MS,
      status: 'DETECTED',
    };

    // Only keep if better than existing opportunity with same path
    const existingKey = `${path.pools.map(p => p.address).join('-')}`;
    const existing = Array.from(this.opportunities.values()).find(
      o => o.path.map(p => p.address).join('-') === existingKey
    );

    if (!existing || BigInt(existing.netProfitWei) < netProfit) {
      if (existing) {
        this.opportunities.delete(existing.id);
      }
      this.opportunities.set(id, opportunity);

      console.log(
        `📊 ${path.pathType} arb: ${path.profitBps} bps, ` +
        `${Number(netProfit) / 1e18} ETH net, ` +
        `${path.pools.length} pools, ` +
        `optimal input: ${Number(path.optimalInput) / 1e18} ETH`
      );
    }
  }

  private hasMinLiquidity(poolState: PoolState): boolean {
    return poolState.reserve0 >= MIN_LIQUIDITY && poolState.reserve1 >= MIN_LIQUIDITY;
  }

  private calculateUsdProfit(profitWei: bigint): string {
    const ethPriceUsd = 3000;
    const profitEth = Number(profitWei) / 1e18;
    return (profitEth * ethPriceUsd).toFixed(2);
  }
}
