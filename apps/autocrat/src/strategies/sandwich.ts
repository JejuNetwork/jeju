import { decodeAbiParameters, parseAbiParameters, type Hex } from 'viem';
import type { ChainId, Pool, SandwichOpportunity, StrategyConfig } from '../types';
import type { PendingTransaction } from '../engine/collector';

interface DecodedSwap {
  amountIn: bigint;
  amountOutMin: bigint;
  path: string[];
  to: string;
  deadline: bigint;
}

interface SandwichParams {
  frontrunAmountIn: bigint;
  frontrunAmountOutMin: bigint;
  backrunAmountIn: bigint;
  backrunAmountOutMin: bigint;
  expectedProfit: bigint;
  victimImpact: bigint;
}

const SWAP_SELECTORS = {
  swapExactTokensForTokens: '0x38ed1739',
  swapTokensForExactTokens: '0x8803dbee',
  swapExactETHForTokens: '0x7ff36ab5',
  swapTokensForExactETH: '0x4a25d94a',
  swapExactTokensForETH: '0x18cbafe5',
  swapETHForExactTokens: '0xfb3bdb41',
};

const MIN_VICTIM_AMOUNT = BigInt(1e17);
const MAX_VICTIM_IMPACT_BPS = 100;
const OPPORTUNITY_TTL_MS = 1000;

export class SandwichStrategy {
  private pools: Map<string, Pool> = new Map();
  private poolByPair: Map<string, Pool> = new Map(); // "token0-token1" -> Pool
  private opportunities: Map<string, SandwichOpportunity> = new Map();
  private processedTxs: Set<string> = new Set();
  private config: StrategyConfig;
  private chainId: ChainId;
  private routerAddresses: Set<string> = new Set();

  constructor(chainId: ChainId, config: StrategyConfig, routerAddresses: string[] = []) {
    this.chainId = chainId;
    this.config = config;

    for (const addr of routerAddresses) {
      this.routerAddresses.add(addr.toLowerCase());
    }
  }

  /**
   * Initialize with pools
   */
  initialize(pools: Pool[]): void {
    console.log(`🥪 Initializing sandwich strategy with ${pools.length} pools`);

    for (const pool of pools) {
      if (pool.chainId !== this.chainId) continue;

      this.pools.set(pool.address.toLowerCase(), pool);

      // Index by token pair
      const pairKey = this.getPairKey(pool.token0.address, pool.token1.address);
      this.poolByPair.set(pairKey, pool);
    }

    console.log(`   Indexed ${this.pools.size} pools for sandwich detection`);
  }

  /**
   * Add a router address to monitor
   */
  addRouter(address: string): void {
    this.routerAddresses.add(address.toLowerCase());
  }

  /**
   * Process a pending transaction
   */
  onPendingTx(tx: PendingTransaction): void {
    // Skip if already processed
    if (this.processedTxs.has(tx.hash)) return;
    this.processedTxs.add(tx.hash);

    // Clean old processed TXs (keep last 10000)
    if (this.processedTxs.size > 10000) {
      const toDelete = Array.from(this.processedTxs).slice(0, 5000);
      for (const hash of toDelete) {
        this.processedTxs.delete(hash);
      }
    }

    // Check if it's a router transaction
    if (!this.routerAddresses.has(tx.to.toLowerCase())) return;

    // Try to decode the swap
    const decoded = this.decodeSwap(tx.input);
    if (!decoded) return;

    // Check if it's a significant swap
    if (decoded.amountIn < MIN_VICTIM_AMOUNT) return;

    // Get the pool
    const pairKey = this.getPairKey(decoded.path[0], decoded.path[decoded.path.length - 1]);
    const pool = this.poolByPair.get(pairKey);
    if (!pool) return;

    // Calculate sandwich parameters
    const params = this.calculateSandwichParams(decoded, pool, tx.gasPrice);
    if (!params) return;

    // Check profitability
    const profitBps = Number((params.expectedProfit * 10000n) / decoded.amountIn);
    if (profitBps < this.config.minProfitBps) return;

    // Check victim impact is within ethical bounds
    const victimImpactBps = Number((params.victimImpact * 10000n) / decoded.amountIn);
    if (victimImpactBps > MAX_VICTIM_IMPACT_BPS) return;

    // Record opportunity
    this.recordOpportunity(tx, decoded, pool, params, victimImpactBps);
  }

  /**
   * Get current opportunities
   */
  getOpportunities(): SandwichOpportunity[] {
    // Clean expired opportunities
    const now = Date.now();
    for (const [id, opp] of this.opportunities) {
      if (opp.detectedAt + OPPORTUNITY_TTL_MS < now) {
        this.opportunities.delete(id);
      }
    }

    return Array.from(this.opportunities.values())
      .filter(o => o.status === 'DETECTED')
      .sort((a, b) => Number(BigInt(b.expectedProfit) - BigInt(a.expectedProfit)));
  }

  /**
   * Mark opportunity as executing
   */
  markExecuting(opportunityId: string): void {
    const opp = this.opportunities.get(opportunityId);
    if (opp) {
      opp.status = 'EXECUTING';
    }
  }

  /**
   * Mark opportunity as completed/failed
   */
  markCompleted(opportunityId: string, success: boolean): void {
    const opp = this.opportunities.get(opportunityId);
    if (opp) {
      opp.status = success ? 'COMPLETED' : 'FAILED';
    }
  }

  // ============ Private Methods ============

  private getPairKey(token0: string, token1: string): string {
    const [a, b] = [token0.toLowerCase(), token1.toLowerCase()].sort();
    return `${a}-${b}`;
  }

  private decodeSwap(input: string): DecodedSwap | null {
    if (!input || input.length < 10) return null;

    const selector = input.slice(0, 10);

    try {
      // swapExactTokensForTokens(uint amountIn, uint amountOutMin, address[] path, address to, uint deadline)
      if (selector === SWAP_SELECTORS.swapExactTokensForTokens) {
        const decoded = decodeAbiParameters(
          parseAbiParameters('uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline'),
          `0x${input.slice(10)}` as Hex
        );
        return {
          amountIn: decoded[0],
          amountOutMin: decoded[1],
          path: decoded[2] as string[],
          to: decoded[3] as string,
          deadline: decoded[4],
        };
      }

      // swapExactETHForTokens(uint amountOutMin, address[] path, address to, uint deadline)
      if (selector === SWAP_SELECTORS.swapExactETHForTokens) {
        const decoded = decodeAbiParameters(
          parseAbiParameters('uint256 amountOutMin, address[] path, address to, uint256 deadline'),
          `0x${input.slice(10)}` as Hex
        );
        // amountIn would be msg.value - not available here
        return null;
      }

      // Add more decoders as needed...
    } catch {
      // Failed to decode - not a swap we can handle
    }

    return null;
  }

  private calculateSandwichParams(
    decoded: DecodedSwap,
    pool: Pool,
    victimGasPrice: bigint
  ): SandwichParams | null {
    const reserve0 = BigInt(pool.reserve0 ?? '0');
    const reserve1 = BigInt(pool.reserve1 ?? '0');

    if (reserve0 === 0n || reserve1 === 0n) return null;

    // Determine swap direction
    const isZeroForOne = decoded.path[0].toLowerCase() === pool.token0.address.toLowerCase();
    const [reserveIn, reserveOut] = isZeroForOne
      ? [reserve0, reserve1]
      : [reserve1, reserve0];

    // Calculate victim's expected output without our interference
    const victimOutputClean = this.getAmountOut(decoded.amountIn, reserveIn, reserveOut);

    // Calculate optimal frontrun amount
    // We want to move the price just enough to profit but not too much
    // Simple heuristic: frontrun with 10% of victim's trade
    const frontrunAmountIn = decoded.amountIn / 10n;

    // Calculate new reserves after our frontrun
    const frontrunOutput = this.getAmountOut(frontrunAmountIn, reserveIn, reserveOut);
    const reserveInAfterFrontrun = reserveIn + frontrunAmountIn;
    const reserveOutAfterFrontrun = reserveOut - frontrunOutput;

    // Calculate victim's output after our frontrun (worse price)
    const victimOutputAfterFrontrun = this.getAmountOut(
      decoded.amountIn,
      reserveInAfterFrontrun,
      reserveOutAfterFrontrun
    );

    // Check if victim would still get enough output
    if (victimOutputAfterFrontrun < decoded.amountOutMin) {
      // Victim would revert - reduce frontrun amount
      return null;
    }

    // Calculate victim impact
    const victimImpact = victimOutputClean - victimOutputAfterFrontrun;

    // Calculate reserves after victim trades
    const reserveInAfterVictim = reserveInAfterFrontrun + decoded.amountIn;
    const reserveOutAfterVictim = reserveOutAfterFrontrun - victimOutputAfterFrontrun;

    // Calculate our backrun (sell what we bought)
    // We sell in the opposite direction
    const backrunAmountIn = frontrunOutput;
    const backrunOutput = this.getAmountOut(
      backrunAmountIn,
      reserveOutAfterVictim, // Our backrun input is what we bought (the output token)
      reserveInAfterVictim // Our backrun output is the original input token
    );

    // Calculate profit
    const profit = backrunOutput - frontrunAmountIn;

    if (profit <= 0n) return null;

    // Calculate minimum outputs with slippage
    const slippageBps = BigInt(this.config.maxSlippageBps);
    const frontrunAmountOutMin = (frontrunOutput * (10000n - slippageBps)) / 10000n;
    const backrunAmountOutMin = (backrunOutput * (10000n - slippageBps)) / 10000n;

    return {
      frontrunAmountIn,
      frontrunAmountOutMin,
      backrunAmountIn,
      backrunAmountOutMin,
      expectedProfit: profit,
      victimImpact,
    };
  }

  private getAmountOut(amountIn: bigint, reserveIn: bigint, reserveOut: bigint): bigint {
    if (amountIn === 0n || reserveIn === 0n || reserveOut === 0n) return 0n;

    const amountInWithFee = amountIn * 997n;
    const numerator = amountInWithFee * reserveOut;
    const denominator = reserveIn * 1000n + amountInWithFee;

    return numerator / denominator;
  }

  private recordOpportunity(
    tx: PendingTransaction,
    decoded: DecodedSwap,
    pool: Pool,
    params: SandwichParams,
    victimImpactBps: number
  ): void {
    const id = `sandwich-${this.chainId}-${tx.hash}`;

    const opportunity: SandwichOpportunity = {
      id,
      type: 'SANDWICH',
      chainId: this.chainId,
      victimTx: {
        hash: tx.hash,
        from: tx.from,
        to: tx.to,
        value: tx.value.toString(),
        gasPrice: tx.gasPrice.toString(),
        input: tx.input,
      },
      pool,
      frontrunTx: {
        amountIn: params.frontrunAmountIn.toString(),
        amountOutMin: params.frontrunAmountOutMin.toString(),
        path: decoded.path,
      },
      backrunTx: {
        amountIn: params.backrunAmountIn.toString(),
        amountOutMin: params.backrunAmountOutMin.toString(),
        path: [...decoded.path].reverse(),
      },
      expectedProfit: params.expectedProfit.toString(),
      victimImpactBps,
      detectedAt: Date.now(),
      status: 'DETECTED',
    };

    this.opportunities.set(id, opportunity);

    console.log(
      `🥪 Sandwich detected: ${params.expectedProfit} profit, ${victimImpactBps} bps victim impact`
    );
  }
}
