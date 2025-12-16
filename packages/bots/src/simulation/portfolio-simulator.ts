/**
 * Portfolio Simulator
 * 
 * Simulates a TFMM portfolio with:
 * - Weight evolution
 * - Swap execution
 * - Liquidity provision
 * - Fee accrual
 */

import type { Token, OraclePrice } from '../types';
import { CompositeStrategy } from '../strategies/tfmm/composite-strategy';
import type { StrategyContext, WeightCalculation } from '../strategies/tfmm/base-strategy';
import { OracleAggregator } from '../oracles';

const WEIGHT_PRECISION = 10n ** 18n;
const BPS_PRECISION = 10000n;

export interface SimulatedPool {
  address: string;
  tokens: Token[];
  balances: bigint[];
  weights: bigint[];
  targetWeights: bigint[];
  weightDeltas: bigint[];
  lastUpdateBlock: number;
  blocksRemaining: number;
  swapFeeBps: number;
  protocolFeeBps: number;
  totalLpTokens: bigint;
  accumulatedFees: bigint[];
}

export interface SimulatedSwap {
  tokenIn: string;
  tokenOut: string;
  amountIn: bigint;
  amountOut: bigint;
  fee: bigint;
  slippage: number;
  block: number;
}

export class PortfolioSimulator {
  private pool: SimulatedPool;
  private strategy: CompositeStrategy;
  private oracle: OracleAggregator;
  private currentBlock = 0;
  private swapHistory: SimulatedSwap[] = [];
  private weightHistory: { block: number; weights: bigint[] }[] = [];

  constructor(
    tokens: Token[],
    initialBalances: bigint[],
    initialWeights: bigint[],
    swapFeeBps = 30,
    protocolFeeBps = 1000
  ) {
    this.pool = {
      address: '0x' + 'SIMULATED'.padStart(40, '0'),
      tokens,
      balances: [...initialBalances],
      weights: [...initialWeights],
      targetWeights: [...initialWeights],
      weightDeltas: initialWeights.map(() => 0n),
      lastUpdateBlock: 0,
      blocksRemaining: 0,
      swapFeeBps,
      protocolFeeBps,
      totalLpTokens: this.calculateInitialLp(initialBalances, initialWeights),
      accumulatedFees: initialBalances.map(() => 0n),
    };

    this.oracle = new OracleAggregator({});
    this.strategy = new CompositeStrategy(this.oracle);
    this.weightHistory.push({ block: 0, weights: [...initialWeights] });
  }

  /**
   * Advance simulation by one block
   */
  advanceBlock(prices?: OraclePrice[]): void {
    this.currentBlock++;

    // Interpolate weights
    if (this.pool.blocksRemaining > 0) {
      for (let i = 0; i < this.pool.weights.length; i++) {
        this.pool.weights[i] += this.pool.weightDeltas[i];
      }
      this.pool.blocksRemaining--;

      if (this.pool.blocksRemaining === 0) {
        // Snap to target weights
        this.pool.weights = [...this.pool.targetWeights];
      }
    }

    // Update price history
    if (prices) {
      this.strategy.updatePriceHistory(prices);
    }
  }

  /**
   * Advance multiple blocks
   */
  advanceBlocks(count: number, prices?: OraclePrice[]): void {
    for (let i = 0; i < count; i++) {
      this.advanceBlock(prices);
    }
  }

  /**
   * Simulate a swap
   */
  swap(
    tokenInSymbol: string,
    tokenOutSymbol: string,
    amountIn: bigint
  ): SimulatedSwap {
    const inIndex = this.pool.tokens.findIndex(t => t.symbol === tokenInSymbol);
    const outIndex = this.pool.tokens.findIndex(t => t.symbol === tokenOutSymbol);

    if (inIndex === -1 || outIndex === -1) {
      throw new Error('Token not found');
    }

    const balanceIn = this.pool.balances[inIndex];
    const balanceOut = this.pool.balances[outIndex];
    const weightIn = this.pool.weights[inIndex];
    const weightOut = this.pool.weights[outIndex];

    // Calculate fee
    const fee = (amountIn * BigInt(this.pool.swapFeeBps)) / BPS_PRECISION;
    const amountInAfterFee = amountIn - fee;

    // Calculate output using weighted power function
    // amountOut = balanceOut * (1 - (balanceIn / (balanceIn + amountInAfterFee)) ^ (weightIn / weightOut))
    const newBalanceIn = balanceIn + amountInAfterFee;
    const ratio = (balanceIn * WEIGHT_PRECISION) / newBalanceIn;
    const weightRatio = (weightIn * WEIGHT_PRECISION) / weightOut;
    const powerResult = this.power(ratio, weightRatio);
    const amountOut = (balanceOut * (WEIGHT_PRECISION - powerResult)) / WEIGHT_PRECISION;

    // Update balances
    this.pool.balances[inIndex] += amountIn;
    this.pool.balances[outIndex] -= amountOut;

    // Accumulate protocol fee
    const protocolFee = (fee * BigInt(this.pool.protocolFeeBps)) / BPS_PRECISION;
    this.pool.accumulatedFees[inIndex] += protocolFee;

    // Calculate slippage vs spot price
    const spotPrice = (balanceOut * weightIn) / (balanceIn * weightOut);
    const effectivePrice = amountOut / amountInAfterFee;
    const slippage = Number(spotPrice - effectivePrice) / Number(spotPrice);

    const swap: SimulatedSwap = {
      tokenIn: tokenInSymbol,
      tokenOut: tokenOutSymbol,
      amountIn,
      amountOut,
      fee,
      slippage,
      block: this.currentBlock,
    };

    this.swapHistory.push(swap);
    return swap;
  }

  /**
   * Update pool weights using strategy
   */
  async updateWeights(prices: OraclePrice[], blocksToTarget = 100): Promise<WeightCalculation> {
    const ctx: StrategyContext = {
      pool: this.pool.address,
      tokens: this.pool.tokens,
      currentWeights: this.pool.weights,
      prices,
      priceHistory: [],
      riskParams: {
        minWeight: WEIGHT_PRECISION / 20n,
        maxWeight: (WEIGHT_PRECISION * 95n) / 100n,
        maxWeightChangeBps: 500,
        minUpdateIntervalBlocks: 10,
        oracleStalenessSeconds: 60,
        maxPriceDeviationBps: 500,
      },
      blockNumber: BigInt(this.currentBlock),
      timestamp: Date.now(),
    };

    const calculation = await this.strategy.calculateWeights(ctx);

    // Apply weight update
    this.applyWeightUpdate(calculation.newWeights, blocksToTarget);

    return calculation;
  }

  /**
   * Apply new weight targets
   */
  applyWeightUpdate(newWeights: bigint[], blocksToTarget: number): void {
    this.pool.targetWeights = [...newWeights];
    this.pool.blocksRemaining = blocksToTarget;
    this.pool.lastUpdateBlock = this.currentBlock;

    // Calculate deltas
    for (let i = 0; i < newWeights.length; i++) {
      this.pool.weightDeltas[i] = (newWeights[i] - this.pool.weights[i]) / BigInt(blocksToTarget);
    }

    this.weightHistory.push({ block: this.currentBlock, weights: [...newWeights] });
  }

  /**
   * Add liquidity proportionally
   */
  addLiquidity(amounts: bigint[]): bigint {
    const totalValueBefore = this.calculateTotalValue();
    let minRatio = WEIGHT_PRECISION;

    for (let i = 0; i < amounts.length; i++) {
      if (this.pool.balances[i] > 0n && amounts[i] > 0n) {
        const ratio = (amounts[i] * WEIGHT_PRECISION) / this.pool.balances[i];
        if (ratio < minRatio) minRatio = ratio;
      }
    }

    // Add to balances
    for (let i = 0; i < amounts.length; i++) {
      this.pool.balances[i] += amounts[i];
    }

    // Mint LP tokens
    const lpTokens = (this.pool.totalLpTokens * minRatio) / WEIGHT_PRECISION;
    this.pool.totalLpTokens += lpTokens;

    return lpTokens;
  }

  /**
   * Remove liquidity proportionally
   */
  removeLiquidity(lpTokens: bigint): bigint[] {
    const share = (lpTokens * WEIGHT_PRECISION) / this.pool.totalLpTokens;
    const amounts: bigint[] = [];

    for (let i = 0; i < this.pool.balances.length; i++) {
      const amount = (this.pool.balances[i] * share) / WEIGHT_PRECISION;
      this.pool.balances[i] -= amount;
      amounts.push(amount);
    }

    this.pool.totalLpTokens -= lpTokens;
    return amounts;
  }

  /**
   * Get current pool state
   */
  getState(): SimulatedPool {
    return { ...this.pool };
  }

  /**
   * Get current weights (interpolated)
   */
  getCurrentWeights(): bigint[] {
    return [...this.pool.weights];
  }

  /**
   * Get swap history
   */
  getSwapHistory(): SimulatedSwap[] {
    return [...this.swapHistory];
  }

  /**
   * Get weight history
   */
  getWeightHistory(): { block: number; weights: bigint[] }[] {
    return [...this.weightHistory];
  }

  /**
   * Calculate spot price
   */
  getSpotPrice(tokenIn: string, tokenOut: string): bigint {
    const inIndex = this.pool.tokens.findIndex(t => t.symbol === tokenIn);
    const outIndex = this.pool.tokens.findIndex(t => t.symbol === tokenOut);

    if (inIndex === -1 || outIndex === -1) return 0n;

    const balanceIn = this.pool.balances[inIndex];
    const balanceOut = this.pool.balances[outIndex];
    const weightIn = this.pool.weights[inIndex];
    const weightOut = this.pool.weights[outIndex];

    // price = (balanceOut / weightOut) / (balanceIn / weightIn)
    return (balanceOut * weightIn * WEIGHT_PRECISION) / (balanceIn * weightOut);
  }

  /**
   * Calculate total pool value in terms of first token
   */
  calculateTotalValue(): bigint {
    let total = 0n;
    for (let i = 0; i < this.pool.balances.length; i++) {
      // Value each token in terms of token 0
      if (i === 0) {
        total += this.pool.balances[i];
      } else {
        const price = this.getSpotPrice(this.pool.tokens[i].symbol, this.pool.tokens[0].symbol);
        total += (this.pool.balances[i] * price) / WEIGHT_PRECISION;
      }
    }
    return total;
  }

  // ============ Private Methods ============

  private calculateInitialLp(balances: bigint[], weights: bigint[]): bigint {
    // Geometric mean weighted by weights
    let product = WEIGHT_PRECISION;
    for (let i = 0; i < balances.length; i++) {
      product += (balances[i] * weights[i]) / WEIGHT_PRECISION;
    }
    return product;
  }

  private power(base: bigint, exp: bigint): bigint {
    // Approximation for (base/PRECISION)^(exp/PRECISION)
    if (base >= WEIGHT_PRECISION) return WEIGHT_PRECISION;

    const x = WEIGHT_PRECISION - base;
    // Linear approximation: (1-x)^n ≈ 1 - n*x for small x
    return WEIGHT_PRECISION - (x * exp) / WEIGHT_PRECISION;
  }
}

