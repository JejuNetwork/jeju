/**
 * @fileoverview Liquidation Strategy
 *
 * Monitors and executes liquidations on perpetual positions:
 * - Track position health factors
 * - Execute liquidations when profitable
 * - Capture liquidation rewards for treasury
 */

import {
  createPublicClient,
  http,
  type PublicClient,
} from 'viem';
import type {
  ChainId,
  ChainConfig,
  LiquidationOpportunity,
  StrategyConfig,
} from '../types';
import { PERPETUAL_MARKET_ABI } from '../lib/contracts';

// ============ Types ============

interface Position {
  positionId: string;
  trader: string;
  marketId: string;
  side: 'LONG' | 'SHORT';
  size: bigint;
  margin: bigint;
  marginToken: string;
  entryPrice: bigint;
  lastCheck: number;
}

interface MarketConfig {
  marketId: string;
  symbol: string;
  maintenanceMarginBps: number;
  liquidationBonus: number;
}

// ============ Constants ============

const POSITION_CHECK_INTERVAL_MS = 5000; // 5 seconds
const HEALTH_FACTOR_THRESHOLD = BigInt(1e18); // 1.0 - liquidatable when below
const MIN_LIQUIDATION_PROFIT = BigInt(1e16); // 0.01 ETH minimum

// ============ Strategy Class ============

export class LiquidationStrategy {
  private client: PublicClient | null = null;
  private perpetualMarketAddress: string = '';
  private positions: Map<string, Position> = new Map();
  private markets: Map<string, MarketConfig> = new Map();
  private opportunities: Map<string, LiquidationOpportunity> = new Map();
  private monitorInterval: ReturnType<typeof setInterval> | null = null;
  private config: StrategyConfig;
  private chainId: ChainId;

  constructor(chainId: ChainId, config: StrategyConfig) {
    this.chainId = chainId;
    this.config = config;
  }

  /**
   * Initialize with chain config and perpetual market address
   */
  async initialize(
    chainConfig: ChainConfig,
    perpetualMarketAddress: string,
    markets: MarketConfig[]
  ): Promise<void> {
    console.log(`⚡ Initializing liquidation strategy`);
    console.log(`   PerpetualMarket: ${perpetualMarketAddress}`);

    this.perpetualMarketAddress = perpetualMarketAddress;

    const chain = {
      id: chainConfig.chainId,
      name: chainConfig.name,
      nativeCurrency: { name: 'ETH', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [chainConfig.rpcUrl] } },
    };

    this.client = createPublicClient({
      chain,
      transport: http(chainConfig.rpcUrl),
    });

    for (const market of markets) {
      this.markets.set(market.marketId, market);
    }

    console.log(`   Monitoring ${markets.length} markets`);
  }

  /**
   * Start monitoring positions
   */
  start(): void {
    if (this.monitorInterval) return;

    console.log(`   Starting position monitoring...`);

    this.monitorInterval = setInterval(
      () => this.checkPositions(),
      POSITION_CHECK_INTERVAL_MS
    );
  }

  /**
   * Stop monitoring
   */
  stop(): void {
    if (this.monitorInterval) {
      clearInterval(this.monitorInterval);
      this.monitorInterval = null;
    }
  }

  /**
   * Add a position to monitor
   */
  addPosition(position: Position): void {
    this.positions.set(position.positionId, position);
  }

  /**
   * Remove a position from monitoring
   */
  removePosition(positionId: string): void {
    this.positions.delete(positionId);
    this.opportunities.delete(positionId);
  }

  /**
   * Handle position opened event
   */
  onPositionOpened(
    positionId: string,
    trader: string,
    marketId: string,
    side: number,
    size: bigint,
    margin: bigint,
    entryPrice: bigint,
    marginToken: string
  ): void {
    const position: Position = {
      positionId,
      trader,
      marketId,
      side: side === 0 ? 'LONG' : 'SHORT',
      size,
      margin,
      marginToken,
      entryPrice,
      lastCheck: Date.now(),
    };

    this.addPosition(position);
  }

  /**
   * Handle position closed event
   */
  onPositionClosed(positionId: string): void {
    this.removePosition(positionId);
  }

  /**
   * Get current opportunities
   */
  getOpportunities(): LiquidationOpportunity[] {
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

    // Remove position if liquidated
    if (success) {
      this.positions.delete(opportunityId);
    }
  }

  // ============ Private Methods ============

  private async checkPositions(): Promise<void> {
    if (!this.client || !this.perpetualMarketAddress) return;

    const now = Date.now();
    const positionsToCheck = Array.from(this.positions.values())
      .filter(p => now - p.lastCheck > POSITION_CHECK_INTERVAL_MS);

    for (const position of positionsToCheck) {
      await this.checkPosition(position);
    }
  }

  private async checkPosition(position: Position): Promise<void> {
    if (!this.client) return;

    try {
      const result = await this.client.readContract({
        address: this.perpetualMarketAddress as `0x${string}`,
        abi: PERPETUAL_MARKET_ABI,
        functionName: 'isLiquidatable',
        args: [position.positionId as `0x${string}`],
      }) as [boolean, bigint];

      const [canLiquidate, healthFactor] = result;

      position.lastCheck = Date.now();

      if (canLiquidate) {
        await this.createLiquidationOpportunity(position, healthFactor);
      } else {
        // Remove existing opportunity if position is no longer liquidatable
        this.opportunities.delete(position.positionId);
      }
    } catch (error) {
      console.error(`Error checking position ${position.positionId}:`, error);
    }
  }

  private async createLiquidationOpportunity(
    position: Position,
    healthFactor: bigint
  ): Promise<void> {
    // Already have this opportunity
    if (this.opportunities.has(position.positionId)) return;

    const market = this.markets.get(position.marketId);
    if (!market) return;

    // Calculate expected profit
    // Liquidation bonus is typically 5% of margin
    const liquidationBonus = (position.margin * BigInt(market.liquidationBonus)) / 10000n;

    // Estimate gas cost
    const gasEstimate = 500000n; // Liquidation is gas-intensive
    const gasPrice = await this.client!.getGasPrice();
    const gasCost = gasEstimate * gasPrice;

    // Net profit
    const netProfit = liquidationBonus - gasCost;

    if (netProfit < MIN_LIQUIDATION_PROFIT) return;

    // Check against config minimum
    const profitBps = Number((netProfit * 10000n) / position.margin);
    if (profitBps < this.config.minProfitBps) return;

    const opportunity: LiquidationOpportunity = {
      id: position.positionId,
      type: 'LIQUIDATION',
      chainId: this.chainId,
      protocol: 'PERPETUAL_MARKET',
      positionId: position.positionId,
      borrower: position.trader,
      collateralToken: {
        address: position.marginToken,
        symbol: '',
        decimals: 18,
        chainId: this.chainId,
      },
      debtToken: {
        address: position.marginToken,
        symbol: '',
        decimals: 18,
        chainId: this.chainId,
      },
      collateralAmount: position.margin.toString(),
      debtAmount: position.size.toString(),
      healthFactor: healthFactor.toString(),
      liquidationBonus: liquidationBonus.toString(),
      expectedProfit: netProfit.toString(),
      gasEstimate: (gasEstimate * gasPrice).toString(),
      netProfitWei: netProfit.toString(),
      detectedAt: Date.now(),
      status: 'DETECTED',
    };

    this.opportunities.set(position.positionId, opportunity);

    console.log(
      `⚡ Liquidation detected: ${position.positionId.slice(0, 10)}... ` +
      `Health: ${Number(healthFactor) / 1e18}, Profit: ${Number(netProfit) / 1e18} ETH`
    );
  }
}
