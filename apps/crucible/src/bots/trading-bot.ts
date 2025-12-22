/**
 * Trading Bot - Wraps Autocrat MEV/Arbitrage logic for Crucible
 * 
 * Executes trading strategies via compute marketplace or directly (for our infra)
 */

import type { Address } from 'viem';
import type { 
  ChainId, ChainConfig, StrategyConfig, Opportunity, ProfitSource, Metrics 
} from './autocrat-types';
import type { 
  TradingBotStrategy, TradingBotChain, TradingBotState, TradingBotConfig as TradingBotConfigType 
} from '../types';
import { EventCollector } from './engine/collector';
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
import { createLogger, type Logger } from '../sdk/logger';

export interface TradingBotOptions {
  agentId: bigint;
  name: string;
  strategies: TradingBotStrategy[];
  chains: TradingBotChain[];
  treasuryAddress?: Address;
  privateKey: string;
  maxConcurrentExecutions: number;
  useFlashbots: boolean;
  contractAddresses?: Record<number, { xlpRouter?: string; perpetualMarket?: string; priceOracle?: string }>;
}

export class TradingBot {
  private config: TradingBotOptions;
  private collector: EventCollector;
  private executor: TransactionExecutor;
  private treasury: TreasuryManager | null = null;
  private log: Logger;

  // Strategies
  private dexArbitrage: Map<ChainId, DexArbitrageStrategy> = new Map();
  private sandwich: Map<ChainId, SandwichStrategy> = new Map();
  private crossChainArb: CrossChainArbStrategy | null = null;
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
      YIELD_FARMING: { detected: 0, executed: 0, failed: 0, profitWei: '0' },
      LIQUIDITY: { detected: 0, executed: 0, failed: 0, profitWei: '0' },
      OTHER: { detected: 0, executed: 0, failed: 0, profitWei: '0' },
    },
  };

  private running = false;
  private startTime = 0;
  private processingLoop: ReturnType<typeof setInterval> | null = null;

  private readonly chainConfigs: ChainConfig[];

  constructor(config: TradingBotOptions) {
    this.config = config;
    this.log = createLogger(`TradingBot:${config.name}`);
    
    this.chainConfigs = config.chains.map(c => ({
      chainId: c.chainId as ChainId,
      name: c.name,
      rpcUrl: c.rpcUrl,
      wsUrl: c.wsUrl,
      blockTime: c.blockTime,
      isL2: c.isL2,
      nativeSymbol: c.nativeSymbol,
      explorerUrl: c.explorerUrl,
    }));

    this.collector = new EventCollector(this.chainConfigs);
    this.executor = new TransactionExecutor(this.chainConfigs, {
      privateKey: config.privateKey,
      maxGasGwei: 100,
      gasPriceMultiplier: 1.1,
      simulationTimeout: 5000,
      maxConcurrentExecutions: config.maxConcurrentExecutions,
      contractAddresses: config.contractAddresses,
      useFlashbots: config.useFlashbots,
    });

    if (config.treasuryAddress && this.chainConfigs[0]) {
      const primaryChain = this.chainConfigs[0];
      this.treasury = new TreasuryManager({
        treasuryAddress: config.treasuryAddress,
        chainId: primaryChain.chainId,
        rpcUrl: primaryChain.rpcUrl,
        privateKey: config.privateKey,
      });
    }

    const crossChainConfig = config.strategies.find(s => s.type === 'CROSS_CHAIN_ARBITRAGE');
    if (crossChainConfig) {
      this.crossChainArb = new CrossChainArbStrategy(
        this.chainConfigs.map(c => c.chainId),
        crossChainConfig as StrategyConfig
      );
    }
  }

  async initialize(): Promise<void> {
    this.log.info('Initializing trading bot', { agentId: this.config.agentId.toString(), name: this.config.name });

    await Promise.all([
      this.collector.initialize(),
      this.executor.initialize(),
      this.treasury?.initialize(),
    ]);

    const strategyMap = new Map(this.config.strategies.map(s => [s.type, s]));

    for (const chainConfig of this.chainConfigs) {
      const chainId = chainConfig.chainId;
      const addresses = this.config.contractAddresses?.[chainId];

      const dexConfig = strategyMap.get('DEX_ARBITRAGE');
      if (dexConfig?.enabled) {
        this.dexArbitrage.set(chainId, new DexArbitrageStrategy(chainId, dexConfig as StrategyConfig));
      }

      const sandwichConfig = strategyMap.get('SANDWICH');
      if (sandwichConfig?.enabled) {
        this.sandwich.set(chainId, new SandwichStrategy(chainId, sandwichConfig as StrategyConfig));
      }

      const liqConfig = strategyMap.get('LIQUIDATION');
      if (liqConfig?.enabled && addresses?.perpetualMarket) {
        const strategy = new LiquidationStrategy(chainId, liqConfig as StrategyConfig);
        await strategy.initialize(chainConfig, addresses.perpetualMarket, []);
        this.liquidation.set(chainId, strategy);
      }

      const oracleConfig = strategyMap.get('ORACLE_KEEPER');
      if (oracleConfig?.enabled && addresses?.priceOracle) {
        const strategy = new OracleKeeperStrategy(chainId, oracleConfig as StrategyConfig, this.config.privateKey);
        await strategy.initialize(chainConfig, addresses.priceOracle, this.chainConfigs);
        this.oracleKeeper.set(chainId, strategy);
      }
    }

    const solverConfig = strategyMap.get('SOLVER');
    if (solverConfig?.enabled) {
      this.solver = new SolverStrategy(this.chainConfigs, solverConfig as StrategyConfig, this.config.privateKey);
      const inputSettlers: Record<number, string> = {};
      const outputSettlers: Record<number, string> = {};
      for (const chainConfig of this.chainConfigs) {
        const addresses = this.config.contractAddresses?.[chainConfig.chainId];
        if (addresses?.xlpRouter) {
          inputSettlers[chainConfig.chainId] = addresses.xlpRouter;
          outputSettlers[chainConfig.chainId] = addresses.xlpRouter;
        }
      }
      await this.solver.initialize(inputSettlers, outputSettlers);
    }

    this.setupEventHandlers();
    this.log.info('Trading bot initialized');
  }

  async start(): Promise<void> {
    if (this.running) return;
    this.log.info('Starting trading bot');
    this.running = true;
    this.startTime = Date.now();

    await Promise.all([
      this.collector.start(),
      ...Array.from(this.liquidation.values()).map(s => s.start()),
      ...Array.from(this.oracleKeeper.values()).map(s => s.start()),
      this.solver?.start(),
    ].filter(Boolean));

    let processing = false;
    this.processingLoop = setInterval(async () => {
      if (processing) return;
      processing = true;
      try {
        await this.processOpportunities();
      } catch (error) {
        this.log.error('Error processing opportunities', { error: String(error) });
      } finally {
        processing = false;
      }
    }, 100);
    this.log.info('Trading bot running');
  }

  async stop(): Promise<void> {
    if (!this.running) return;
    this.log.info('Stopping trading bot');
    this.running = false;

    if (this.processingLoop) {
      clearInterval(this.processingLoop);
      this.processingLoop = null;
    }

    await Promise.all([
      this.collector.stop(),
      ...Array.from(this.liquidation.values()).map(s => s.stop()),
      ...Array.from(this.oracleKeeper.values()).map(s => s.stop()),
      this.solver?.stop(),
    ].filter(Boolean));

    this.log.info('Trading bot stopped');
  }

  getMetrics(): Metrics {
    this.metrics.uptime = Date.now() - this.startTime;
    this.metrics.lastUpdate = Date.now();
    return { ...this.metrics };
  }

  isHealthy(): boolean {
    return this.running;
  }

  private setupEventHandlers(): void {
    this.collector.on('sync', (event) => {
      this.dexArbitrage.get(event.chainId)?.onSync(event);
    });
    this.collector.on('swap', (event) => {
      this.dexArbitrage.get(event.chainId)?.onSwap(event);
    });
    this.collector.on('pendingTx', (tx) => {
      this.sandwich.get(tx.chainId)?.onPendingTx(tx);
    });
  }

  private async processOpportunities(): Promise<void> {
    if (!this.running) return;

    const opportunities: Array<{ opportunity: Opportunity; source: ProfitSource }> = [];

    for (const strategy of this.dexArbitrage.values()) {
      for (const opp of strategy.getOpportunities()) {
        opportunities.push({ opportunity: opp, source: 'DEX_ARBITRAGE' });
      }
    }
    for (const strategy of this.sandwich.values()) {
      for (const opp of strategy.getOpportunities()) {
        opportunities.push({ opportunity: opp, source: 'SANDWICH' });
      }
    }
    for (const strategy of this.liquidation.values()) {
      for (const opp of strategy.getOpportunities()) {
        opportunities.push({ opportunity: opp, source: 'LIQUIDATION' });
      }
    }
    if (this.crossChainArb) {
      for (const opp of this.crossChainArb.getOpportunities()) {
        opportunities.push({ opportunity: opp, source: 'CROSS_CHAIN_ARBITRAGE' });
      }
    }

    const topOpportunities = opportunities
      .sort((a, b) => {
        const profitA = BigInt(a.opportunity.expectedProfit);
        const profitB = BigInt(b.opportunity.expectedProfit);
        return profitB > profitA ? 1 : profitB < profitA ? -1 : 0;
      })
      .slice(0, this.config.maxConcurrentExecutions);

    await Promise.allSettled(
      topOpportunities.map(async ({ opportunity, source }) => {
        this.metrics.opportunitiesDetected++;
        this.metrics.byStrategy[source]!.detected++;

        const result = await this.executor.execute(opportunity);

        if (result.success) {
          this.metrics.opportunitiesExecuted++;
          this.metrics.byStrategy[source]!.executed++;
          if (result.actualProfit && result.txHash && this.treasury) {
            await this.treasury.depositProfit(
              '0x0000000000000000000000000000000000000000',
              BigInt(result.actualProfit),
              source,
              result.txHash
            );
          }
        } else {
          this.metrics.opportunitiesFailed++;
          this.metrics.byStrategy[source]!.failed++;
        }
      })
    );

    if (this.solver) {
      const pendingIntents = this.solver.getPendingIntents().slice(0, 3);
      for (const intent of pendingIntents) {
        const evaluation = await this.solver.evaluate(intent);
        if (!evaluation.profitable) continue;

        this.metrics.opportunitiesDetected++;
        this.metrics.byStrategy.SOLVER!.detected++;
        const result = await this.solver.fill(intent);
        if (result.success) {
          this.metrics.opportunitiesExecuted++;
          this.metrics.byStrategy.SOLVER!.executed++;
        } else {
          this.metrics.opportunitiesFailed++;
          this.metrics.byStrategy.SOLVER!.failed++;
        }
      }
    }
  }
}

