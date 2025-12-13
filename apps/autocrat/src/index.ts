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
    this.collector = new EventCollector(this.config.chains);

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

    const primaryChain = this.config.chains.find(c => c.chainId === this.config.primaryChainId);
    if (!primaryChain) throw new Error(`Primary chain ${this.config.primaryChainId} not configured`);

    this.treasury = new TreasuryManager({
      treasuryAddress: this.config.treasuryAddress,
      chainId: this.config.primaryChainId,
      rpcUrl: primaryChain.rpcUrl,
      privateKey: this.config.privateKey || '',
    });

    const supportedChains = this.config.chains.map(c => c.chainId);
    const crossChainConfig = this.config.strategies.find(s => s.type === 'CROSS_CHAIN_ARBITRAGE');
    this.crossChainArb = new CrossChainArbStrategy(
      supportedChains,
      crossChainConfig || { type: 'CROSS_CHAIN_ARBITRAGE', enabled: false, minProfitBps: 50, maxGasGwei: 100, maxSlippageBps: 100 }
    );
  }

  async initialize(): Promise<void> {
    console.log('🤖 Initializing Autocrat MEV System');
    console.log(`   Primary chain: ${this.config.primaryChainId}`);
    console.log(`   Monitoring ${this.config.chains.length} chains`);

    await this.collector.initialize();

    if (this.config.privateKey) {
      await this.executor.initialize();
    } else {
      console.warn('   ⚠️ No private key - read-only mode');
    }

    await this.treasury.initialize();

    for (const chainConfig of this.config.chains) {
      const chainId = chainConfig.chainId;
      const addresses = getContractAddresses(chainId);

      const dexConfig = this.config.strategies.find(s => s.type === 'DEX_ARBITRAGE');
      if (dexConfig?.enabled) {
        this.dexArbitrage.set(chainId, new DexArbitrageStrategy(chainId, dexConfig));
      }

      const sandwichConfig = this.config.strategies.find(s => s.type === 'SANDWICH');
      if (sandwichConfig?.enabled) {
        this.sandwich.set(chainId, new SandwichStrategy(chainId, sandwichConfig));
      }

      const liqConfig = this.config.strategies.find(s => s.type === 'LIQUIDATION');
      if (liqConfig?.enabled && addresses.perpetualMarket) {
        const strategy = new LiquidationStrategy(chainId, liqConfig);
        await strategy.initialize(chainConfig, addresses.perpetualMarket, []);
        this.liquidation.set(chainId, strategy);
      }

      const oracleConfig = this.config.strategies.find(s => s.type === 'ORACLE_KEEPER');
      if (oracleConfig?.enabled && addresses.priceOracle && this.config.privateKey) {
        const strategy = new OracleKeeperStrategy(chainId, oracleConfig, this.config.privateKey);
        await strategy.initialize(chainConfig, addresses.priceOracle, this.config.chains);
        this.oracleKeeper.set(chainId, strategy);
      }
    }

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

    this.setupEventHandlers();
    console.log('   ✓ Initialization complete');
  }

  async start(): Promise<void> {
    if (this.running) return;
    console.log('\n🚀 Starting Autocrat MEV System');
    this.running = true;
    this.startTime = Date.now();

    await this.collector.start();
    for (const strategy of this.liquidation.values()) strategy.start();
    for (const strategy of this.oracleKeeper.values()) strategy.start();
    if (this.solver) await this.solver.start();

    this.processingLoop = setInterval(() => this.processOpportunities(), 100);
    console.log('   ✓ All systems running\n📊 Monitoring for opportunities...\n');
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    console.log('\n🛑 Stopping Autocrat MEV System');
    this.running = false;

    if (this.processingLoop) {
      clearInterval(this.processingLoop);
      this.processingLoop = null;
    }

    await this.collector.stop();
    for (const strategy of this.liquidation.values()) strategy.stop();
    for (const strategy of this.oracleKeeper.values()) strategy.stop();
    if (this.solver) this.solver.stop();

    console.log('   ✓ All systems stopped');
  }

  getMetrics(): Metrics {
    this.metrics.uptime = Date.now() - this.startTime;
    this.metrics.lastUpdate = Date.now();
    return { ...this.metrics };
  }

  private setupEventHandlers(): void {
    this.collector.on('sync', (event: SyncEvent) => {
      this.dexArbitrage.get(event.chainId)?.onSync(event);
    });
    this.collector.on('swap', (event: SwapEvent) => {
      this.dexArbitrage.get(event.chainId)?.onSwap(event);
    });
    this.collector.on('pendingTx', (tx: PendingTransaction) => {
      this.sandwich.get(tx.chainId)?.onPendingTx(tx);
    });
  }

  private async processOpportunities(): Promise<void> {
    if (!this.running) return;

    const opportunities: Array<{ opportunity: Opportunity; source: ProfitSource }> = [];

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

    for (const opp of this.crossChainArb.getOpportunities()) {
      opportunities.push({ opportunity: opp, source: 'CROSS_CHAIN_ARBITRAGE' });
    }

    opportunities.sort((a, b) => {
      const profitA = BigInt(a.opportunity.expectedProfit || '0');
      const profitB = BigInt(b.opportunity.expectedProfit || '0');
      return profitB > profitA ? 1 : -1;
    });

    for (const { opportunity, source } of opportunities.slice(0, this.config.maxConcurrentExecutions)) {
      this.metrics.opportunitiesDetected++;
      this.metrics.byStrategy[source].detected++;
      this.markExecuting(opportunity, source);

      const result = await this.executor.execute(opportunity);

      if (result.success) {
        this.metrics.opportunitiesExecuted++;
        this.metrics.byStrategy[source].executed++;
        if (result.actualProfit && result.txHash) {
          await this.treasury.depositProfit(
            '0x0000000000000000000000000000000000000000',
            BigInt(result.actualProfit),
            source,
            result.txHash
          );
        }
      } else {
        this.metrics.opportunitiesFailed++;
        this.metrics.byStrategy[source].failed++;
      }

      this.markCompleted(opportunity, source, result.success);
    }

    if (this.solver) {
      for (const intent of this.solver.getPendingIntents().slice(0, 3)) {
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

async function main(): Promise<void> {
  console.log('\n╔════════════════════════════════════════╗');
  console.log('║     AUTOCRAT MEV SYSTEM v1.0.0        ║');
  console.log('╚════════════════════════════════════════╝\n');

  const autocrat = new Autocrat();

  const shutdown = async () => {
    await autocrat.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  await autocrat.initialize();
  await autocrat.start();
  await new Promise(() => {});
}

export { Autocrat };
export * from './types';
export * from './config';
export * from './strategies';
export { EventCollector } from './engine/collector';
export { TransactionExecutor } from './engine/executor';
export { TreasuryManager } from './engine/treasury';

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
