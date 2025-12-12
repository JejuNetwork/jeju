/**
 * @fileoverview Autocrat MEV Bot System
 *
 * Main entry point for the Jeju MEV/arbitrage bot system.
 * Orchestrates all strategies and manages execution.
 *
 * @module @jeju/autocrat
 */

import { getConfig, getContractAddresses } from './config';
import type { AutocratConfig } from './types';
import { EventCollector, type SwapEvent, type SyncEvent, type PendingTransaction } from './engine/collector';
import { TransactionExecutor } from './engine/executor';
import { TreasuryManager } from './engine/treasury';
import {
  DexArbitrageStrategy,
  SandwichStrategy,
  CrossChainArbStrategy,
  LiquidationStrategy,
  SolverStrategy,
  OracleKeeperStrategy,
} from './strategies';
import type { ChainId, Opportunity, ProfitSource, Metrics } from './types';

// ============ Main Autocrat Class ============

class Autocrat {
  private config: AutocratConfig;
  private collector: EventCollector;
  private executor: TransactionExecutor;
  private treasury: TreasuryManager;

  // Strategies
  private dexArbitrage: Map<ChainId, DexArbitrageStrategy> = new Map();
  private sandwich: Map<ChainId, SandwichStrategy> = new Map();
  private crossChainArb: CrossChainArbStrategy;
  private liquidation: Map<ChainId, LiquidationStrategy> = new Map();
  private solver: SolverStrategy | null = null;
  private oracleKeeper: Map<ChainId, OracleKeeperStrategy> = new Map();

  // Metrics
  private metrics: Metrics = {
    opportunitiesDetected: 0,
    opportunitiesExecuted: 0,
    opportunitiesFailed: 0,
    totalProfitWei: '0',
    totalProfitUsd: '0',
    totalGasSpent: '0',
    avgExecutionTimeMs: 0,
    uptime: 0,
    lastUpdate: Date.now(),
    byStrategy: {
      DEX_ARBITRAGE: { detected: 0, executed: 0, failed: 0, profitWei: '0' },
      CROSS_CHAIN_ARBITRAGE: { detected: 0, executed: 0, failed: 0, profitWei: '0' },
      SANDWICH: { detected: 0, executed: 0, failed: 0, profitWei: '0' },
      LIQUIDATION: { detected: 0, executed: 0, failed: 0, profitWei: '0' },
      SOLVER: { detected: 0, executed: 0, failed: 0, profitWei: '0' },
      ORACLE_KEEPER: { detected: 0, executed: 0, failed: 0, profitWei: '0' },
    },
  };

  private running = false;
  private startTime = 0;
  private processingLoop: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.config = getConfig();

    // Initialize core components
    this.collector = new EventCollector(this.config.chains);

    // Build contract addresses map for executor
    const contractAddresses: Record<number, { xlpRouter?: string; perpetualMarket?: string; priceOracle?: string }> = {};
    for (const chain of this.config.chains) {
      const addresses = getContractAddresses(chain.chainId);
      contractAddresses[chain.chainId] = {
        xlpRouter: addresses.xlpRouter,
        perpetualMarket: addresses.perpetualMarket,
        priceOracle: addresses.priceOracle,
      };
    }

    this.executor = new TransactionExecutor(this.config.chains, {
      privateKey: this.config.privateKey || '',
      maxGasGwei: this.config.maxGasGwei,
      gasPriceMultiplier: this.config.gasPriceMultiplier,
      simulationTimeout: this.config.simulationTimeout,
      maxConcurrentExecutions: this.config.maxConcurrentExecutions,
      contractAddresses,
    });

    // Find primary chain config
    const primaryChain = this.config.chains.find(c => c.chainId === this.config.primaryChainId);
    if (!primaryChain) {
      throw new Error(`Primary chain ${this.config.primaryChainId} not configured`);
    }

    this.treasury = new TreasuryManager({
      treasuryAddress: this.config.treasuryAddress,
      chainId: this.config.primaryChainId,
      rpcUrl: primaryChain.rpcUrl,
      privateKey: this.config.privateKey || '',
    });

    // Initialize cross-chain arbitrage (spans all chains)
    const supportedChains = this.config.chains.map(c => c.chainId);
    const crossChainConfig = this.config.strategies.find(s => s.type === 'CROSS_CHAIN_ARBITRAGE');
    this.crossChainArb = new CrossChainArbStrategy(
      supportedChains,
      crossChainConfig || { type: 'CROSS_CHAIN_ARBITRAGE', enabled: false, minProfitBps: 50, maxGasGwei: 100, maxSlippageBps: 100 }
    );
  }

  /**
   * Initialize all components
   */
  async initialize(): Promise<void> {
    console.log('🤖 Initializing Autocrat MEV System');
    console.log(`   Primary chain: ${this.config.primaryChainId}`);
    console.log(`   Monitoring ${this.config.chains.length} chains`);

    // Initialize collector
    await this.collector.initialize();

    // Initialize executor
    if (this.config.privateKey) {
      await this.executor.initialize();
    } else {
      console.warn('   ⚠️ No private key configured - read-only mode');
    }

    // Initialize treasury
    await this.treasury.initialize();

    // Initialize per-chain strategies
    for (const chainConfig of this.config.chains) {
      const chainId = chainConfig.chainId;
      const addresses = getContractAddresses(chainId);

      // DEX Arbitrage
      const dexConfig = this.config.strategies.find(s => s.type === 'DEX_ARBITRAGE');
      if (dexConfig?.enabled) {
        const strategy = new DexArbitrageStrategy(chainId, dexConfig);
        this.dexArbitrage.set(chainId, strategy);
      }

      // Sandwich
      const sandwichConfig = this.config.strategies.find(s => s.type === 'SANDWICH');
      if (sandwichConfig?.enabled) {
        const strategy = new SandwichStrategy(chainId, sandwichConfig);
        this.sandwich.set(chainId, strategy);
      }

      // Liquidation
      const liqConfig = this.config.strategies.find(s => s.type === 'LIQUIDATION');
      if (liqConfig?.enabled && addresses.perpetualMarket) {
        const strategy = new LiquidationStrategy(chainId, liqConfig);
        await strategy.initialize(chainConfig, addresses.perpetualMarket, []);
        this.liquidation.set(chainId, strategy);
      }

      // Oracle Keeper
      const oracleConfig = this.config.strategies.find(s => s.type === 'ORACLE_KEEPER');
      if (oracleConfig?.enabled && addresses.priceOracle && this.config.privateKey) {
        const strategy = new OracleKeeperStrategy(chainId, oracleConfig, this.config.privateKey);
        await strategy.initialize(chainConfig, addresses.priceOracle, this.config.chains);
        this.oracleKeeper.set(chainId, strategy);
      }
    }

    // Initialize OIF Solver
    const solverConfig = this.config.strategies.find(s => s.type === 'SOLVER');
    if (solverConfig?.enabled && this.config.privateKey) {
      this.solver = new SolverStrategy(this.config.chains, solverConfig, this.config.privateKey);

      const inputSettlers: Record<number, string> = {};
      const outputSettlers: Record<number, string> = {};

      for (const chainConfig of this.config.chains) {
        const addresses = getContractAddresses(chainConfig.chainId);
        if (addresses.inputSettler) inputSettlers[chainConfig.chainId] = addresses.inputSettler;
        if (addresses.outputSettler) outputSettlers[chainConfig.chainId] = addresses.outputSettler;
      }

      await this.solver.initialize(inputSettlers, outputSettlers);
    }

    // Wire up event handlers
    this.setupEventHandlers();

    console.log('   ✓ Initialization complete');
  }

  /**
   * Start the bot
   */
  async start(): Promise<void> {
    if (this.running) return;

    console.log('\n🚀 Starting Autocrat MEV System');
    this.running = true;
    this.startTime = Date.now();

    // Start collector
    await this.collector.start();

    // Start per-chain strategies
    for (const strategy of this.liquidation.values()) {
      strategy.start();
    }

    for (const strategy of this.oracleKeeper.values()) {
      strategy.start();
    }

    if (this.solver) {
      await this.solver.start();
    }

    // Start processing loop
    this.processingLoop = setInterval(() => this.processOpportunities(), 100); // 100ms

    console.log('   ✓ All systems running');
    console.log('\n📊 Monitoring for opportunities...\n');
  }

  /**
   * Stop the bot
   */
  async stop(): Promise<void> {
    if (!this.running) return;

    console.log('\n🛑 Stopping Autocrat MEV System');
    this.running = false;

    if (this.processingLoop) {
      clearInterval(this.processingLoop);
      this.processingLoop = null;
    }

    await this.collector.stop();

    for (const strategy of this.liquidation.values()) {
      strategy.stop();
    }

    for (const strategy of this.oracleKeeper.values()) {
      strategy.stop();
    }

    if (this.solver) {
      this.solver.stop();
    }

    console.log('   ✓ All systems stopped');
  }

  /**
   * Get current metrics
   */
  getMetrics(): Metrics {
    this.metrics.uptime = Date.now() - this.startTime;
    this.metrics.lastUpdate = Date.now();
    return { ...this.metrics };
  }

  // ============ Private Methods ============

  private setupEventHandlers(): void {
    // Handle sync events (reserve updates)
    this.collector.on('sync', (event: SyncEvent) => {
      const strategy = this.dexArbitrage.get(event.chainId);
      if (strategy) {
        strategy.onSync(event);
      }
    });

    // Handle swap events
    this.collector.on('swap', (event: SwapEvent) => {
      const strategy = this.dexArbitrage.get(event.chainId);
      if (strategy) {
        strategy.onSwap(event);
      }
    });

    // Handle pending transactions (for sandwiches)
    this.collector.on('pendingTx', (tx: PendingTransaction) => {
      const strategy = this.sandwich.get(tx.chainId);
      if (strategy) {
        strategy.onPendingTx(tx);
      }
    });

  }

  private async processOpportunities(): Promise<void> {
    if (!this.running) return;

    // Collect opportunities from all strategies
    const opportunities: Array<{ opportunity: Opportunity; source: ProfitSource }> = [];

    // Collect from all per-chain strategies
    const strategyMaps: Array<[Map<ChainId, { getOpportunities(): Opportunity[] }>, ProfitSource]> = [
      [this.dexArbitrage, 'DEX_ARBITRAGE'],
      [this.sandwich, 'SANDWICH'],
      [this.liquidation, 'LIQUIDATION'],
    ];

    for (const [strategyMap, source] of strategyMaps) {
      for (const strategy of strategyMap.values()) {
        for (const opp of strategy.getOpportunities()) {
          opportunities.push({ opportunity: opp, source });
        }
      }
    }

    // Cross-chain (single strategy, not per-chain)
    for (const opp of this.crossChainArb.getOpportunities()) {
      opportunities.push({ opportunity: opp, source: 'CROSS_CHAIN_ARBITRAGE' });
    }

    // Sort by expected profit
    opportunities.sort((a, b) => {
      const profitA = BigInt(a.opportunity.expectedProfit || '0');
      const profitB = BigInt(b.opportunity.expectedProfit || '0');
      return profitB > profitA ? 1 : -1;
    });

    // Execute best opportunities
    for (const { opportunity, source } of opportunities.slice(0, this.config.maxConcurrentExecutions)) {
      this.metrics.opportunitiesDetected++;
      this.metrics.byStrategy[source].detected++;

      // Mark as executing
      this.markExecuting(opportunity, source);

      // Execute
      const result = await this.executor.execute(opportunity);

      // Update metrics
      if (result.success) {
        this.metrics.opportunitiesExecuted++;
        this.metrics.byStrategy[source].executed++;

        // Deposit profit to treasury
        if (result.actualProfit && result.txHash) {
          await this.treasury.depositProfit(
            '0x0000000000000000000000000000000000000000', // ETH
            BigInt(result.actualProfit),
            source,
            result.txHash
          );
        }
      } else {
        this.metrics.opportunitiesFailed++;
        this.metrics.byStrategy[source].failed++;
      }

      // Mark completed
      this.markCompleted(opportunity, source, result.success);
    }

    // Process OIF solver intents
    if (this.solver) {
      const intents = this.solver.getPendingIntents();
      for (const intent of intents.slice(0, 3)) {
        const evaluation = await this.solver.evaluate(intent);
        if (evaluation.profitable) {
          this.metrics.opportunitiesDetected++;
          this.metrics.byStrategy.SOLVER.detected++;

          const result = await this.solver.fill(intent);

          if (result.success) {
            this.metrics.opportunitiesExecuted++;
            this.metrics.byStrategy.SOLVER.executed++;
          } else {
            this.metrics.opportunitiesFailed++;
            this.metrics.byStrategy.SOLVER.failed++;
          }
        }
      }
    }
  }

  private getStrategyForOpportunity(opportunity: Opportunity, source: ProfitSource) {
    if (source === 'CROSS_CHAIN_ARBITRAGE') return this.crossChainArb;
    if (!('chainId' in opportunity)) return null;
    
    const strategyMap: Record<string, Map<ChainId, { markExecuting: (id: string) => void; markCompleted: (id: string, success: boolean) => void }>> = {
      DEX_ARBITRAGE: this.dexArbitrage,
      SANDWICH: this.sandwich,
      LIQUIDATION: this.liquidation,
    };
    return strategyMap[source]?.get(opportunity.chainId) ?? null;
  }

  private markExecuting(opportunity: Opportunity, source: ProfitSource): void {
    this.getStrategyForOpportunity(opportunity, source)?.markExecuting(opportunity.id);
  }

  private markCompleted(opportunity: Opportunity, source: ProfitSource, success: boolean): void {
    this.getStrategyForOpportunity(opportunity, source)?.markCompleted(opportunity.id, success);
  }
}

// ============ Entry Point ============

async function main(): Promise<void> {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║     AUTOCRAT MEV SYSTEM v1.0.0        ║');
  console.log('║     Jeju Network Protocol Treasury     ║');
  console.log('╚════════════════════════════════════════╝\n');

  const autocrat = new Autocrat();

  // Handle shutdown
  process.on('SIGINT', async () => {
    console.log('\nReceived SIGINT, shutting down...');
    await autocrat.stop();
    process.exit(0);
  });

  process.on('SIGTERM', async () => {
    console.log('\nReceived SIGTERM, shutting down...');
    await autocrat.stop();
    process.exit(0);
  });

  try {
    await autocrat.initialize();
    await autocrat.start();

    // Keep running
    await new Promise(() => {});
  } catch (error) {
    console.error('Fatal error:', error);
    await autocrat.stop();
    process.exit(1);
  }
}

// Export for programmatic use
export { Autocrat };
export * from './types';
export * from './config';
export * from './strategies';
export { EventCollector } from './engine/collector';
export { TransactionExecutor } from './engine/executor';
export { TreasuryManager } from './engine/treasury';

// Run if main
main().catch(console.error);
