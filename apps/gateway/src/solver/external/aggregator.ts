/**
 * External Protocol Aggregator
 * 
 * Aggregates all external protocol integrations into a single
 * unified interface for the solver.
 * 
 * Monitors:
 * - Across Protocol deposits
 * - UniswapX orders
 * - CoW Protocol auctions
 * 
 * All integrations are fully permissionless - no API keys required.
 */

import { type PublicClient, type WalletClient, type Address } from 'viem';
import { EventEmitter } from 'events';
import { AcrossAdapter, type AcrossDeposit } from './across';
import { UniswapXAdapter, type UniswapXOrder } from './uniswapx';
import { CowProtocolSolver, type CowAuction, type CowOrder } from './cow';

export type ExternalOpportunityType = 'across' | 'uniswapx' | 'cow';

export interface ExternalOpportunity {
  id: string;
  type: ExternalOpportunityType;
  chainId: number;
  destinationChainId?: number;
  inputToken: Address;
  outputToken: Address;
  inputAmount: bigint;
  outputAmount: bigint;
  expectedProfitBps: number;
  deadline: number;
  data: AcrossDeposit | UniswapXOrder | CowOrder;
}

export interface AggregatorConfig {
  chains: Array<{ chainId: number; name: string; rpcUrl: string }>;
  enableAcross?: boolean;
  enableUniswapX?: boolean;
  enableCow?: boolean;
  minProfitBps?: number;
  isTestnet?: boolean;
}

export class ExternalProtocolAggregator extends EventEmitter {
  private config: AggregatorConfig;
  private clients: Map<number, { public: PublicClient; wallet?: WalletClient }>;
  
  // Protocol adapters
  private across: AcrossAdapter | null = null;
  private uniswapx: UniswapXAdapter | null = null;
  private cow: CowProtocolSolver | null = null;

  // Opportunity tracking
  private opportunities = new Map<string, ExternalOpportunity>();
  private processedIds = new Set<string>();
  private running = false;

  // Metrics
  private metrics = {
    acrossDeposits: 0,
    uniswapxOrders: 0,
    cowAuctions: 0,
    opportunitiesFound: 0,
    opportunitiesFilled: 0,
    totalProfitWei: BigInt(0),
  };

  constructor(
    config: AggregatorConfig,
    clients: Map<number, { public: PublicClient; wallet?: WalletClient }>
  ) {
    super();
    this.config = config;
    this.clients = clients;
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.running = true;
    console.log('\n🌐 Starting External Protocol Aggregator...');

    const chainIds = this.config.chains.map(c => c.chainId);

    // Initialize enabled adapters
    if (this.config.enableAcross !== false) {
      this.across = new AcrossAdapter(this.clients, chainIds, this.config.isTestnet);
      this.across.on('deposit', (d: AcrossDeposit) => this.handleAcrossDeposit(d));
      await this.across.start();
    }

    if (this.config.enableUniswapX !== false) {
      this.uniswapx = new UniswapXAdapter(this.clients, chainIds, this.config.isTestnet);
      this.uniswapx.on('order', (o: UniswapXOrder) => this.handleUniswapXOrder(o));
      await this.uniswapx.start();
    }

    if (this.config.enableCow !== false) {
      this.cow = new CowProtocolSolver(this.clients, chainIds);
      this.cow.on('auction', (a: CowAuction) => this.handleCowAuction(a));
      await this.cow.start();
    }

    console.log('   ✅ External protocol aggregator running\n');
  }

  async stop(): Promise<void> {
    this.running = false;
    this.across?.stop();
    this.uniswapx?.stop();
    this.cow?.stop();
    console.log('   🛑 External protocol aggregator stopped');
  }

  /**
   * Get all current opportunities sorted by profit
   */
  getOpportunities(minProfitBps?: number): ExternalOpportunity[] {
    const now = Math.floor(Date.now() / 1000);
    const minProfit = minProfitBps ?? this.config.minProfitBps ?? 5;

    // Filter expired and unprofitable
    const valid: ExternalOpportunity[] = [];
    const entries = Array.from(this.opportunities.entries());
    for (const [id, opp] of entries) {
      if (opp.deadline < now) {
        this.opportunities.delete(id);
        continue;
      }
      if (opp.expectedProfitBps >= minProfit) {
        valid.push(opp);
      }
    }

    // Sort by profit descending
    return valid.sort((a, b) => b.expectedProfitBps - a.expectedProfitBps);
  }

  /**
   * Fill an opportunity
   */
  async fill(opportunity: ExternalOpportunity): Promise<{ success: boolean; txHash?: string; error?: string }> {
    this.opportunities.delete(opportunity.id);

    switch (opportunity.type) {
      case 'across':
        if (!this.across) return { success: false, error: 'Across not enabled' };
        return this.across.fill(opportunity.data as AcrossDeposit);

      case 'uniswapx':
        if (!this.uniswapx) return { success: false, error: 'UniswapX not enabled' };
        return this.uniswapx.fill(opportunity.data as UniswapXOrder);

      case 'cow':
        // CoW orders are filled via batch solutions, not individual fills
        return { success: false, error: 'CoW orders filled via auctions' };

      default:
        return { success: false, error: 'Unknown opportunity type' };
    }
  }

  /**
   * Get current metrics
   */
  getMetrics() {
    return {
      ...this.metrics,
      activeOpportunities: this.opportunities.size,
    };
  }

  // === Protocol-specific handlers ===

  private handleAcrossDeposit(deposit: AcrossDeposit): void {
    this.metrics.acrossDeposits++;

    // Get gas price for profitability check
    const client = this.clients.get(deposit.destinationChainId);
    if (!client) return;

    client.public.getGasPrice().then(gasPrice => {
      const evaluation = this.across?.evaluateProfitability(deposit, gasPrice, 3000);
      if (!evaluation?.profitable) return;

      const id = `across-${deposit.depositId}-${deposit.originChainId}`;
      if (this.processedIds.has(id)) return;
      this.processedIds.add(id);

      const opportunity: ExternalOpportunity = {
        id,
        type: 'across',
        chainId: deposit.originChainId,
        destinationChainId: deposit.destinationChainId,
        inputToken: deposit.inputToken,
        outputToken: deposit.outputToken,
        inputAmount: deposit.inputAmount,
        outputAmount: deposit.outputAmount,
        expectedProfitBps: evaluation.expectedProfitBps,
        deadline: deposit.fillDeadline,
        data: deposit,
      };

      this.opportunities.set(id, opportunity);
      this.metrics.opportunitiesFound++;
      this.emit('opportunity', opportunity);
    });
  }

  private handleUniswapXOrder(order: UniswapXOrder): void {
    this.metrics.uniswapxOrders++;

    const client = this.clients.get(order.chainId);
    if (!client) return;

    client.public.getGasPrice().then(gasPrice => {
      const evaluation = this.uniswapx?.evaluateProfitability(order, gasPrice, 3000);
      if (!evaluation?.profitable) return;

      const id = `uniswapx-${order.orderHash}`;
      if (this.processedIds.has(id)) return;
      this.processedIds.add(id);

      const totalOutput = order.outputs.reduce((sum, o) => sum + o.amount, 0n);
      
      const opportunity: ExternalOpportunity = {
        id,
        type: 'uniswapx',
        chainId: order.chainId,
        inputToken: order.input.token,
        outputToken: order.outputs[0]?.token || '0x0000000000000000000000000000000000000000',
        inputAmount: order.input.amount,
        outputAmount: totalOutput,
        expectedProfitBps: evaluation.expectedProfitBps,
        deadline: order.deadline,
        data: order,
      };

      this.opportunities.set(id, opportunity);
      this.metrics.opportunitiesFound++;
      this.emit('opportunity', opportunity);
    });
  }

  private handleCowAuction(auction: CowAuction): void {
    this.metrics.cowAuctions++;

    // For CoW, we emit individual orders as opportunities
    for (const order of auction.orders) {
      const id = `cow-${order.uid}`;
      if (this.processedIds.has(id)) return;
      this.processedIds.add(id);

      // Simple profit estimate
      const surplus = order.sellAmount - order.buyAmount - order.feeAmount;
      const profitBps = surplus > BigInt(0)
        ? Number((surplus * BigInt(10000)) / order.buyAmount)
        : 0;

      if (profitBps < (this.config.minProfitBps ?? 5)) continue;

      const opportunity: ExternalOpportunity = {
        id,
        type: 'cow',
        chainId: auction.chainId,
        inputToken: order.buyToken, // We provide buy token
        outputToken: order.sellToken, // We receive sell token
        inputAmount: order.buyAmount,
        outputAmount: order.sellAmount - order.feeAmount,
        expectedProfitBps: profitBps,
        deadline: order.validTo,
        data: order,
      };

      this.opportunities.set(id, opportunity);
      this.metrics.opportunitiesFound++;
      this.emit('opportunity', opportunity);
    }
  }

  /**
   * Cleanup old processed IDs to prevent memory leak
   */
  cleanup(): void {
    if (this.processedIds.size > 10000) {
      const arr = Array.from(this.processedIds);
      this.processedIds = new Set(arr.slice(-5000));
    }
  }
}

