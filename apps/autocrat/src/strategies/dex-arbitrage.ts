import type { ChainId, Pool, ArbitrageOpportunity, StrategyConfig } from '../types';
import type { SyncEvent, SwapEvent } from '../engine/collector';

interface PoolState {
  pool: Pool;
  reserve0: bigint;
  reserve1: bigint;
  lastUpdate: number;
}

interface ArbitragePath {
  pools: Pool[];
  tokenPath: string[];
  expectedOutput: bigint;
  profit: bigint;
  profitBps: number;
}

const FEE_BPS = 30;
const MIN_LIQUIDITY = BigInt(1e18);
const OPPORTUNITY_TTL_MS = 2000;

export class DexArbitrageStrategy {
  private pools: Map<string, PoolState> = new Map();
  private tokenPairs: Map<string, Set<string>> = new Map(); // token -> pools containing it
  private opportunities: Map<string, ArbitrageOpportunity> = new Map();
  private config: StrategyConfig;
  private chainId: ChainId;

  constructor(chainId: ChainId, config: StrategyConfig) {
    this.chainId = chainId;
    this.config = config;
  }

  initialize(pools: Pool[]): void {
    console.log(`🔄 Initializing DEX arbitrage strategy with ${pools.length} pools`);
    for (const pool of pools) {
      if (pool.chainId === this.chainId) this.addPool(pool);
    }
    console.log(`   Indexed ${this.pools.size} pools, ${this.tokenPairs.size} unique tokens`);
  }

  addPool(pool: Pool): void {
    const poolState: PoolState = {
      pool,
      reserve0: BigInt(pool.reserve0 ?? '0'),
      reserve1: BigInt(pool.reserve1 ?? '0'),
      lastUpdate: pool.lastUpdate || Date.now(),
    };

    this.pools.set(pool.address.toLowerCase(), poolState);

    // Index by tokens
    this.indexTokenPool(pool.token0.address, pool.address);
    this.indexTokenPool(pool.token1.address, pool.address);
  }

  onSync(event: SyncEvent): void {
    const poolState = this.pools.get(event.poolAddress.toLowerCase());
    if (!poolState) return;
    poolState.reserve0 = event.reserve0;
    poolState.reserve1 = event.reserve1;
    poolState.lastUpdate = Date.now();
    this.checkArbitrageForPool(poolState);
  }

  onSwap(event: SwapEvent): void {
    const poolState = this.pools.get(event.poolAddress.toLowerCase());
    if (!poolState) return;
    const { token0, token1 } = poolState.pool;
    this.checkArbitrageForTokenPair(token0.address, token1.address);
  }

  getOpportunities(): ArbitrageOpportunity[] {
    const now = Date.now();
    for (const [id, opp] of this.opportunities) {
      if (opp.expiresAt < now) this.opportunities.delete(id);
    }
    return Array.from(this.opportunities.values())
      .filter(o => o.status === 'DETECTED')
      .sort((a, b) => b.expectedProfitBps - a.expectedProfitBps);
  }

  markExecuting(opportunityId: string): void {
    const opp = this.opportunities.get(opportunityId);
    if (opp) opp.status = 'EXECUTING';
  }

  markCompleted(opportunityId: string, success: boolean): void {
    const opp = this.opportunities.get(opportunityId);
    if (opp) opp.status = success ? 'COMPLETED' : 'FAILED';
  }

  private indexTokenPool(token: string, pool: string): void {
    const tokenLower = token.toLowerCase();
    if (!this.tokenPairs.has(tokenLower)) this.tokenPairs.set(tokenLower, new Set());
    this.tokenPairs.get(tokenLower)!.add(pool.toLowerCase());
  }

  private checkArbitrageForPool(poolState: PoolState): void {
    const { token0, token1 } = poolState.pool;
    this.findTriangularArbitrage(token0.address);
    this.findTriangularArbitrage(token1.address);
    this.checkCrossPoolArbitrage(poolState);
  }

  private checkArbitrageForTokenPair(token0: string, token1: string): void {
    const pools0 = this.tokenPairs.get(token0.toLowerCase()) || new Set();
    const pools1 = this.tokenPairs.get(token1.toLowerCase()) || new Set();

    const pairPools: PoolState[] = [];
    for (const poolAddr of pools0) {
      if (pools1.has(poolAddr)) {
        const poolState = this.pools.get(poolAddr);
        if (poolState) pairPools.push(poolState);
      }
    }
    if (pairPools.length > 1) this.checkCrossPoolArbitrageBetween(pairPools);
  }

  private findTriangularArbitrage(startToken: string): void {
    const startTokenLower = startToken.toLowerCase();
    const startPools = this.tokenPairs.get(startTokenLower);
    if (!startPools) return;

    const inputAmount = BigInt(1e18);

    for (const poolAddr1 of startPools) {
      const pool1State = this.pools.get(poolAddr1);
      if (!pool1State || !this.hasMinLiquidity(pool1State)) continue;

      const token1 = this.getOtherToken(pool1State.pool, startTokenLower);
      if (!token1) continue;

      const amount1 = this.getAmountOut(inputAmount, pool1State, startTokenLower === pool1State.pool.token0.address.toLowerCase());
      if (amount1 <= 0n) continue;

      const pools2 = this.tokenPairs.get(token1.toLowerCase());
      if (!pools2) continue;

      for (const poolAddr2 of pools2) {
        if (poolAddr2 === poolAddr1) continue;

        const pool2State = this.pools.get(poolAddr2);
        if (!pool2State || !this.hasMinLiquidity(pool2State)) continue;

        const token2 = this.getOtherToken(pool2State.pool, token1);
        if (!token2 || token2.toLowerCase() === startTokenLower) continue;

        const amount2 = this.getAmountOut(amount1, pool2State, token1.toLowerCase() === pool2State.pool.token0.address.toLowerCase());
        if (amount2 <= 0n) continue;

        const pools3 = this.tokenPairs.get(token2.toLowerCase());
        if (!pools3) continue;

        for (const poolAddr3 of pools3) {
          if (poolAddr3 === poolAddr1 || poolAddr3 === poolAddr2) continue;

          const pool3State = this.pools.get(poolAddr3);
          if (!pool3State || !this.hasMinLiquidity(pool3State)) continue;

          const otherToken = this.getOtherToken(pool3State.pool, token2);
          if (!otherToken || otherToken.toLowerCase() !== startTokenLower) continue;

          // Calculate final output
          const amount3 = this.getAmountOut(
            amount2,
            pool3State,
            token2.toLowerCase() === pool3State.pool.token0.address.toLowerCase()
          );
          if (amount3 <= 0n) continue;

          // Check profitability
          const profit = amount3 - inputAmount;
          const profitBps = Number((profit * 10000n) / inputAmount);

          if (profitBps >= this.config.minProfitBps) {
            this.recordOpportunity({
              pools: [pool1State.pool, pool2State.pool, pool3State.pool],
              tokenPath: [startToken, token1, token2, startToken],
              expectedOutput: amount3,
              profit,
              profitBps,
            });
          }
        }
      }
    }
  }

  private checkCrossPoolArbitrage(poolState: PoolState): void {
    const { token0, token1 } = poolState.pool;

    // Find other pools with the same pair
    const pools0 = this.tokenPairs.get(token0.address.toLowerCase()) || new Set();
    const pools1 = this.tokenPairs.get(token1.address.toLowerCase()) || new Set();

    const samePairPools: PoolState[] = [poolState];

    for (const poolAddr of pools0) {
      if (pools1.has(poolAddr) && poolAddr !== poolState.pool.address.toLowerCase()) {
        const otherPool = this.pools.get(poolAddr);
        if (otherPool && this.hasMinLiquidity(otherPool)) {
          samePairPools.push(otherPool);
        }
      }
    }

    if (samePairPools.length > 1) {
      this.checkCrossPoolArbitrageBetween(samePairPools);
    }
  }

  private checkCrossPoolArbitrageBetween(pools: PoolState[]): void {
    if (pools.length < 2) return;

    // Compare prices between all pool pairs
    for (let i = 0; i < pools.length; i++) {
      for (let j = i + 1; j < pools.length; j++) {
        const pool1 = pools[i];
        const pool2 = pools[j];

        // Calculate price in each pool
        const price1 = this.getPrice(pool1);
        const price2 = this.getPrice(pool2);

        if (price1 === 0n || price2 === 0n) continue;

        // Check if there's a profitable spread
        const priceDiff = price1 > price2 ? price1 - price2 : price2 - price1;
        const avgPrice = (price1 + price2) / 2n;
        const spreadBps = Number((priceDiff * 10000n) / avgPrice);

        // Need spread > 2 * fee (0.6%) to be profitable
        if (spreadBps > FEE_BPS * 2 + this.config.minProfitBps) {
          // Buy from cheaper pool, sell to more expensive
          const [buyPool, sellPool] = price1 < price2 ? [pool1, pool2] : [pool2, pool1];

          const inputAmount = this.calculateOptimalAmount(buyPool, sellPool);
          const buyOutput = this.getAmountOut(inputAmount, buyPool, true);
          const sellOutput = this.getAmountOut(buyOutput, sellPool, false);

          const profit = sellOutput - inputAmount;
          const profitBps = Number((profit * 10000n) / inputAmount);

          if (profitBps >= this.config.minProfitBps) {
            this.recordOpportunity({
              pools: [buyPool.pool, sellPool.pool],
              tokenPath: [
                buyPool.pool.token0.address,
                buyPool.pool.token1.address,
                sellPool.pool.token0.address,
              ],
              expectedOutput: sellOutput,
              profit,
              profitBps,
            });
          }
        }
      }
    }
  }

  private recordOpportunity(path: ArbitragePath): void {
    const id = `arb-${this.chainId}-${Date.now()}-${Math.random().toString(36).slice(2)}`;

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
      inputAmount: BigInt(1e18).toString(),
      expectedOutput: path.expectedOutput.toString(),
      expectedProfit: path.profit.toString(),
      expectedProfitBps: path.profitBps,
      gasEstimate: (200000n * BigInt(path.pools.length)).toString(),
      netProfitWei: path.profit.toString(), // Would subtract gas
      netProfitUsd: '0', // Would need price oracle
      detectedAt: Date.now(),
      expiresAt: Date.now() + OPPORTUNITY_TTL_MS,
      status: 'DETECTED',
    };

    this.opportunities.set(id, opportunity);

    console.log(
      `📊 Arbitrage detected: ${path.profitBps} bps profit via ${path.pools.length} pools`
    );
  }

  // ============ Math Helpers ============

  /**
   * Calculate amount out using constant product formula
   * amountOut = (amountIn * 997 * reserveOut) / (reserveIn * 1000 + amountIn * 997)
   */
  private getAmountOut(
    amountIn: bigint,
    poolState: PoolState,
    zeroForOne: boolean
  ): bigint {
    const [reserveIn, reserveOut] = zeroForOne
      ? [poolState.reserve0, poolState.reserve1]
      : [poolState.reserve1, poolState.reserve0];

    if (reserveIn === 0n || reserveOut === 0n || amountIn === 0n) {
      return 0n;
    }

    const amountInWithFee = amountIn * 997n;
    const numerator = amountInWithFee * reserveOut;
    const denominator = reserveIn * 1000n + amountInWithFee;

    return numerator / denominator;
  }

  /**
   * Get price as token1/token0 ratio (scaled by 1e18)
   */
  private getPrice(poolState: PoolState): bigint {
    if (poolState.reserve0 === 0n) return 0n;
    return (poolState.reserve1 * BigInt(1e18)) / poolState.reserve0;
  }

  /**
   * Check if pool has minimum liquidity
   */
  private hasMinLiquidity(poolState: PoolState): boolean {
    return poolState.reserve0 >= MIN_LIQUIDITY && poolState.reserve1 >= MIN_LIQUIDITY;
  }

  /**
   * Get the other token in the pool
   */
  private getOtherToken(pool: Pool, token: string): string | null {
    const tokenLower = token.toLowerCase();
    if (pool.token0.address.toLowerCase() === tokenLower) {
      return pool.token1.address;
    }
    if (pool.token1.address.toLowerCase() === tokenLower) {
      return pool.token0.address;
    }
    return null;
  }

  /**
   * Calculate optimal trade amount for cross-pool arbitrage
   * This is simplified - real implementation would solve the optimization problem
   */
  private calculateOptimalAmount(buyPool: PoolState, sellPool: PoolState): bigint {
    // Use geometric mean of reserves as rough estimate
    // BigInt doesn't support fractional exponents, so we use sqrt twice
    const product = buyPool.reserve0 * buyPool.reserve1 * sellPool.reserve0 * sellPool.reserve1;
    const avgReserve = this.bigintSqrt(this.bigintSqrt(product));

    // Trade about 1% of pool to minimize price impact
    return avgReserve / 100n;
  }

  /**
   * Integer square root using Newton's method
   */
  private bigintSqrt(n: bigint): bigint {
    if (n < 0n) return 0n;
    if (n < 2n) return n;
    
    let x = n;
    let y = (x + 1n) / 2n;
    while (y < x) {
      x = y;
      y = (x + n / x) / 2n;
    }
    return x;
  }
}
