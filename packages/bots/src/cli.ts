/**
 * Bots Package CLI
 * 
 * Commands:
 * - start: Start bot engine with configured strategies
 * - backtest: Run strategy backtest
 * - simulate: Run portfolio simulation
 * - prices: Fetch current prices
 */

import { z } from 'zod';
import { BotEngine } from './engine';
import { Backtester, type BacktestConfig } from './simulation/backtester';
import { HistoricalDataFetcher } from './simulation/data-fetcher';
import type { Token, EVMChainId } from './types';
import { EVMChainIdSchema } from './schemas';

// ============ CLI Argument Schemas ============

const BacktestArgsSchema = z.object({
  strategy: z.enum(['momentum', 'mean-reversion', 'volatility', 'composite']),
  startDate: z.string().transform((s) => {
    const d = new Date(s);
    if (isNaN(d.getTime())) throw new Error(`Invalid start date: ${s}`);
    return d;
  }),
  endDate: z.string().transform((s) => {
    const d = new Date(s);
    if (isNaN(d.getTime())) throw new Error(`Invalid end date: ${s}`);
    return d;
  }),
  initialCapital: z.coerce.number().positive(),
});

const SimulateArgsSchema = z.object({
  blocks: z.coerce.number().int().positive(),
});

const StartArgsSchema = z.object({
  chainId: EVMChainIdSchema,
  rpcUrl: z.string().url(),
  privateKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/, 'Invalid private key format'),
});

const COMMANDS = ['start', 'backtest', 'simulate', 'prices', 'help'] as const;
type Command = (typeof COMMANDS)[number];

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const command = args[0];

  if (!command) {
    printHelp();
    return;
  }

  // Type guard for command validation
  const isValidCommand = (cmd: string): cmd is Command => 
    (COMMANDS as readonly string[]).includes(cmd);

  if (!isValidCommand(command)) {
    console.error(`Unknown command: ${command}`);
    printHelp();
    process.exit(1);
  }

  switch (command) {
    case 'start':
      await runBot(args.slice(1));
      break;
    case 'backtest':
      await runBacktest(args.slice(1));
      break;
    case 'simulate':
      await runSimulation(args.slice(1));
      break;
    case 'prices':
      await fetchPrices(args.slice(1));
      break;
    case 'help':
    default:
      printHelp();
  }
}

async function runBot(args: string[]): Promise<void> {
  // Get values from args or environment
  const chainIdRaw = args[0] ? Number(args[0]) : 8453;
  const rpcUrlRaw = args[1] ?? process.env.RPC_URL;
  const privateKeyRaw = args[2] ?? process.env.PRIVATE_KEY;

  if (!rpcUrlRaw) {
    throw new Error('RPC_URL required: provide as argument or set RPC_URL environment variable');
  }
  if (!privateKeyRaw) {
    throw new Error('PRIVATE_KEY required: provide as argument or set PRIVATE_KEY environment variable');
  }

  // Validate with Zod
  const validated = StartArgsSchema.parse({
    chainId: chainIdRaw,
    rpcUrl: rpcUrlRaw,
    privateKey: privateKeyRaw,
  });

  const { chainId, rpcUrl, privateKey } = validated;

  console.log('Starting Bot Engine...');
  console.log(`  Chain: ${chainId}`);

  const engine = new BotEngine({
    chainId,
    rpcUrl,
    privateKey,
    enabledStrategies: ['tfmm-rebalancer', 'cross-chain-arbitrage'],
    healthCheckIntervalMs: 60000,
    logLevel: 'info',
  });

  engine.on('started', () => console.log('Bot engine started'));
  engine.on('trade', (trade) => console.log('Trade:', trade));
  engine.on('health', (stats) => console.log('Health:', stats));

  await engine.start();

  // Keep running
  process.on('SIGINT', async () => {
    console.log('Shutting down...');
    await engine.stop();
    process.exit(0);
  });
}

async function runBacktest(args: string[]): Promise<void> {
  // Validate CLI args with Zod
  const validated = BacktestArgsSchema.parse({
    strategy: args[0] ?? 'composite',
    startDate: args[1] ?? '2024-01-01',
    endDate: args[2] ?? '2024-12-01',
    initialCapital: args[3] ?? '10000',
  });

  const { strategy, startDate, endDate, initialCapital } = validated;

  console.log('Running backtest...');
  console.log(`  Strategy: ${strategy}`);
  console.log(`  Period: ${startDate.toISOString().split('T')[0]} to ${endDate.toISOString().split('T')[0]}`);
  console.log(`  Capital: $${initialCapital}`);

  const tokens: Token[] = [
    { address: '0x', symbol: 'WETH', decimals: 18, chainId: 8453 },
    { address: '0x', symbol: 'USDC', decimals: 6, chainId: 8453 },
    { address: '0x', symbol: 'WBTC', decimals: 8, chainId: 8453 },
  ];

  // Fetch historical data
  const dataFetcher = new HistoricalDataFetcher();
  
  console.log('Fetching price data...');
  // Always use synthetic data for backtesting - CoinGecko has rate limits
  // Real implementation would use a proper data provider
  const priceData = dataFetcher.generateSyntheticData(
    tokens,
    startDate,
    endDate,
    86400000, // Daily
    {
      initialPrices: { WETH: 3000, USDC: 1, WBTC: 60000 },
      volatilities: { WETH: 0.6, USDC: 0.01, WBTC: 0.5 },
      correlations: [
        [1, 0, 0.7],
        [0, 1, 0],
        [0.7, 0, 1],
      ],
    }
  );

  console.log(`Loaded ${priceData.length} price points`);

  const config: BacktestConfig = {
    strategy,
    tokens,
    initialWeights: [0.5, 0.25, 0.25],
    startDate,
    endDate,
    initialCapitalUsd: initialCapital,
    rebalanceIntervalHours: 24,
    tradingFeeBps: 30,
    slippageBps: 10,
    priceData,
  };

  const backtester = new Backtester();
  const result = await backtester.run(config);

  console.log('\n=== Backtest Results ===');
  console.log(`Total Return: ${(result.totalReturn * 100).toFixed(2)}%`);
  console.log(`Annualized Return: ${(result.annualizedReturn * 100).toFixed(2)}%`);
  console.log(`Sharpe Ratio: ${result.sharpeRatio.toFixed(2)}`);
  console.log(`Max Drawdown: ${(result.maxDrawdown * 100).toFixed(2)}%`);
  console.log(`Volatility: ${(result.volatility * 100).toFixed(2)}%`);
  console.log(`Win Rate: ${(result.winRate * 100).toFixed(1)}%`);
  console.log(`Total Trades: ${result.totalTrades}`);
  console.log(`Total Fees: $${result.totalFees.toFixed(2)}`);
  console.log(`Net Profit: $${result.netProfit.toFixed(2)}`);
}

async function runSimulation(args: string[]): Promise<void> {
  // Validate with Zod
  const validated = SimulateArgsSchema.parse({
    blocks: args[0] ?? '1000',
  });

  const { blocks } = validated;
  
  console.log(`Running simulation for ${blocks} blocks...`);

  // Use portfolio simulator
  const { PortfolioSimulator } = await import('./simulation/portfolio-simulator');
  
  const tokens: Token[] = [
    { address: '0x1', symbol: 'WETH', decimals: 18, chainId: 8453 },
    { address: '0x2', symbol: 'USDC', decimals: 6, chainId: 8453 },
  ];

  const initialBalances = [
    BigInt(10e18),    // 10 ETH
    BigInt(30000e6),  // 30,000 USDC
  ];

  const initialWeights = [
    BigInt(5e17),  // 50%
    BigInt(5e17),  // 50%
  ];

  const sim = new PortfolioSimulator(tokens, initialBalances, initialWeights);

  // Simulate
  for (let i = 0; i < blocks; i++) {
    // Random price fluctuations
    const prices = [
      {
        token: 'WETH',
        price: BigInt(Math.floor((3000 + Math.random() * 200 - 100) * 1e8)),
        decimals: 8,
        timestamp: Date.now(),
        source: 'simulation' as const,
      },
      {
        token: 'USDC',
        price: BigInt(1e8),
        decimals: 8,
        timestamp: Date.now(),
        source: 'simulation' as const,
      },
    ];

    sim.advanceBlock(prices);

    // Occasional swaps - only attempt if amount is reasonable
    if (Math.random() < 0.1) {
      const swapAmount = BigInt(Math.floor(Math.random() * 1e18));
      const tokenIn = Math.random() < 0.5 ? 'WETH' : 'USDC';
      const tokenOut = tokenIn === 'WETH' ? 'USDC' : 'WETH';

      // Check if swap is valid before attempting
      const state = sim.getState();
      const tokenIndex = tokenIn === 'WETH' ? 0 : 1;
      if (state.balances[tokenIndex] >= swapAmount && swapAmount > 0n) {
        sim.swap(tokenIn, tokenOut, swapAmount);
      }
    }

    // Periodic weight updates
    if (i > 0 && i % 100 === 0) {
      await sim.updateWeights(prices, 50);
    }
  }

  const state = sim.getState();
  const swaps = sim.getSwapHistory();

  console.log('\n=== Simulation Results ===');
  console.log(`Blocks simulated: ${blocks}`);
  console.log(`Swaps executed: ${swaps.length}`);
  console.log(`Final weights: ${state.weights.map(w => (Number(w) / 1e18 * 100).toFixed(1) + '%').join(', ')}`);
  console.log(`Accumulated fees: ${state.accumulatedFees.map(f => f.toString()).join(', ')}`);
}

async function fetchPrices(args: string[]): Promise<void> {
  const symbols = args.length > 0 ? args : ['ETH', 'BTC', 'USDC'];
  
  console.log(`Fetching prices for: ${symbols.join(', ')}`);

  const dataFetcher = new HistoricalDataFetcher();
  const tokens = symbols.map(s => ({
    address: '0x',
    symbol: s === 'ETH' ? 'WETH' : s === 'BTC' ? 'WBTC' : s,
    decimals: 18,
    chainId: 1 as EVMChainId,
  }));

  const now = new Date();
  const yesterday = new Date(now.getTime() - 86400000);

  const data = await dataFetcher.fetchPrices(tokens, yesterday, now);

  if (data.length === 0) {
    throw new Error('No price data returned');
  }
  
  const latest = data[data.length - 1];
  console.log('\nLatest prices:');
  for (const token of tokens) {
    const price = latest.prices[token.symbol];
    if (price === undefined) {
      console.log(`  ${token.symbol}: No price data`);
    } else {
      console.log(`  ${token.symbol}: $${price.toFixed(2)}`);
    }
  }
}

function printHelp(): void {
  console.log(`
Jeju Bots CLI

Usage:
  bun run src/cli.ts <command> [options]

Commands:
  start [chainId] [rpcUrl] [privateKey]
    Start the bot engine with all strategies enabled

  backtest [strategy] [startDate] [endDate] [capital]
    Run a backtest for the specified strategy
    strategy: momentum, mean-reversion, volatility, composite
    Example: backtest composite 2024-01-01 2024-12-01 10000

  simulate [blocks]
    Run a portfolio simulation for the specified number of blocks
    Example: simulate 1000

  prices [symbols...]
    Fetch current prices for the specified symbols
    Example: prices ETH BTC USDC

  help
    Show this help message

Environment Variables:
  RPC_URL       - Ethereum RPC URL
  PRIVATE_KEY   - Wallet private key (for start command)
`);
}

main().catch((err) => {
  console.error('Error:', err);
  process.exit(1);
});

