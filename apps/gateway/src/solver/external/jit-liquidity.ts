/**
 * Just-in-Time (JIT) Liquidity Provider
 * 
 * Optimizes liquidity provision by:
 * 1. Monitoring pending orders/intents
 * 2. Calculating optimal liquidity positions
 * 3. Providing concentrated liquidity just before settlement
 */

import { type PublicClient, type WalletClient, type Address } from 'viem';
import { EventEmitter } from 'events';

// Uniswap V3 NonfungiblePositionManager
export const POSITION_MANAGER: Record<number, Address> = {
  1: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  42161: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  10: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
  8453: '0x03a520b32C04BF3bEEf7BEb72E919cf822Ed34f1',
  137: '0xC36442b4a4522E871399CD717aBDD847Ab11FE88',
};

// Pool ABI for slot0
const POOL_ABI = [
  {
    type: 'function',
    name: 'slot0',
    inputs: [],
    outputs: [
      { name: 'sqrtPriceX96', type: 'uint160' },
      { name: 'tick', type: 'int24' },
      { name: 'observationIndex', type: 'uint16' },
      { name: 'observationCardinality', type: 'uint16' },
      { name: 'observationCardinalityNext', type: 'uint16' },
      { name: 'feeProtocol', type: 'uint8' },
      { name: 'unlocked', type: 'bool' },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'tickSpacing',
    inputs: [],
    outputs: [{ type: 'int24' }],
    stateMutability: 'view',
  },
] as const;

export interface JITPosition {
  tokenId: bigint;
  chainId: number;
  pool: Address;
  token0: Address;
  token1: Address;
  fee: number;
  tickLower: number;
  tickUpper: number;
  liquidity: bigint;
  createdAt: number;
  intentId: string;
}

export interface JITOpportunity {
  intentId: string;
  chainId: number;
  pool: Address;
  token0: Address;
  token1: Address;
  fee: number;
  direction: 'token0_to_token1' | 'token1_to_token0';
  swapAmount: bigint;
  expectedFees: bigint;
  optimalTickLower: number;
  optimalTickUpper: number;
  deadline: number;
}

export interface JITConfig {
  minProfitWei: bigint;
  maxPositionAge: number;
  tickRange: number;
  slippageBps: number;
}

export class JITLiquidityProvider extends EventEmitter {
  private clients: Map<number, { public: PublicClient; wallet?: WalletClient }>;
  private positions = new Map<string, JITPosition>();
  private config: JITConfig;
  private running = false;
  private cleanupInterval: ReturnType<typeof setInterval> | null = null;

  constructor(
    clients: Map<number, { public: PublicClient; wallet?: WalletClient }>,
    config?: Partial<JITConfig>
  ) {
    super();
    this.clients = clients;
    this.config = {
      minProfitWei: BigInt(1e15),
      maxPositionAge: 120,
      tickRange: 60,
      slippageBps: 50,
      ...config,
    };
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    console.log('JIT Liquidity Provider started');

    this.cleanupInterval = setInterval(() => this.cleanupStalePositions(), 30000);
  }

  stop(): void {
    this.running = false;
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Analyze an intent to find JIT opportunity
   */
  async analyzeIntent(
    chainId: number,
    pool: Address,
    token0: Address,
    token1: Address,
    fee: number,
    swapAmount: bigint,
    direction: 'token0_to_token1' | 'token1_to_token0',
    intentId: string,
    deadline: number
  ): Promise<JITOpportunity | null> {
    const client = this.clients.get(chainId);
    if (!client) return null;

    const [slot0, tickSpacing] = await Promise.all([
      client.public.readContract({
        address: pool,
        abi: POOL_ABI,
        functionName: 'slot0',
      }),
      client.public.readContract({
        address: pool,
        abi: POOL_ABI,
        functionName: 'tickSpacing',
      }),
    ]);

    const currentTick = slot0[1];
    const spacing = Number(tickSpacing);

    const tickLower = Math.floor((currentTick - this.config.tickRange) / spacing) * spacing;
    const tickUpper = Math.ceil((currentTick + this.config.tickRange) / spacing) * spacing;

    const feeRate = BigInt(fee);
    const expectedFees = (swapAmount * feeRate) / BigInt(1e6);

    if (expectedFees < this.config.minProfitWei) {
      return null;
    }

    return {
      intentId,
      chainId,
      pool,
      token0,
      token1,
      fee,
      direction,
      swapAmount,
      expectedFees,
      optimalTickLower: tickLower,
      optimalTickUpper: tickUpper,
      deadline,
    };
  }

  /**
   * Calculate optimal amounts for JIT based on direction
   */
  calculateOptimalAmounts(
    opportunity: JITOpportunity,
    availableToken0: bigint,
    availableToken1: bigint
  ): { amount0: bigint; amount1: bigint } {
    if (opportunity.direction === 'token0_to_token1') {
      return {
        amount0: BigInt(0),
        amount1: availableToken1,
      };
    } else {
      return {
        amount0: availableToken0,
        amount1: BigInt(0),
      };
    }
  }

  private async cleanupStalePositions(): Promise<void> {
    const now = Date.now();
    const maxAge = this.config.maxPositionAge * 1000;

    for (const [intentId, position] of this.positions) {
      if (now - position.createdAt > maxAge) {
        console.log(`   Closing stale JIT position: ${intentId}`);
        this.positions.delete(intentId);
      }
    }
  }

  getOpenPositions(): JITPosition[] {
    return Array.from(this.positions.values());
  }

  getPositionCount(): number {
    return this.positions.size;
  }
}

/**
 * Helper to calculate tick from price
 */
export function priceToTick(price: number): number {
  return Math.floor(Math.log(price) / Math.log(1.0001));
}

/**
 * Helper to calculate price from tick
 */
export function tickToPrice(tick: number): number {
  return Math.pow(1.0001, tick);
}



