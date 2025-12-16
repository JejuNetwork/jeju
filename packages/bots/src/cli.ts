/**
 * Bots Package CLI
 * 
 * Commands:
 * - start: Start bot engine with configured strategies
 * - backtest: Run strategy backtest
 * - simulate: Run portfolio simulation
 * - prices: Fetch current prices
 */

import { BotEngine } from './engine';
import { Backtester, type BacktestConfig } from './simulation/backtester';
import { HistoricalDataFetcher } from './simulation/data-fetcher';
import type { Token, EVMChainId } from './types';

const COMMANDS = ['start', 'backtest', 'simulate', 'prices', 'help'];

async function main() {
  const args = process.argv.slice(2);
  const command = args[0] ?? 'help';

  if (!COMMANDS.includes(command)) {
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

async function runBot(args: string[]) {
  const chainId = Number(args[0] ?? '8453') as EVMChainId;
  const rpcUrl = args[1] ?? process.env.RPC_URL;
  const privateKey = args[2] ?? process.env.PRIVATE_KEY;

  if (!rpcUrl) {
    console.error('RPC_URL required');
    process.exit(1);
  }

  if (!privateKey) {
    console.error('PRIVATE_KEY required');
    process.exit(1);
  }

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

async function runBacktest(args: string[]) {
  const strategy = (args[0] ?? 'composite') as BacktestConfig['strategy'];
  const startDateStr = args[1] ?? '2024-01-01';
  const endDateStr = args[2] ?? '2024-12-01';
  const initialCapital = Number(args[3] ?? '10000');

  console.log('Running backtest...');
  console.log(`  Strategy: ${strategy}`);
  console.log(`  Period: ${startDateStr} to ${endDateStr}`);
  console.log(`  Capital: $${initialCapital}`);

  const tokens: Token[] = [
    { address: '0x', symbol: 'WETH', decimals: 18, chainId: 8453 },
    { address: '0x', symbol: 'USDC', decimals: 6, chainId: 8453 },
    { address: '0x', symbol: 'WBTC', decimals: 8, chainId: 8453 },
  ];

  const startDate = new Date(startDateStr);
  const endDate = new Date(endDateStr);

  // Fetch historical data
  const dataFetcher = new HistoricalDataFetcher();
  
  console.log('Fetching price data...');
  let priceData;
  
  try {
    priceData = await dataFetcher.fetchPrices(tokens, startDate, endDate);
  } catch {
    console.log('CoinGecko fetch failed, using synthetic data');
    priceData = dataFetcher.generateSyntheticData(
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
  }

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

async function runSimulation(args: string[]) {
  const blocks = Number(args[0] ?? '1000');
  
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

    // Occasional swaps
    if (Math.random() < 0.1) {
      const swapAmount = BigInt(Math.floor(Math.random() * 1e18));
      const tokenIn = Math.random() < 0.5 ? 'WETH' : 'USDC';
      const tokenOut = tokenIn === 'WETH' ? 'USDC' : 'WETH';

      try {
        sim.swap(tokenIn, tokenOut, swapAmount);
      } catch {
        // Ignore swap errors
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

async function fetchPrices(args: string[]) {
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

  try {
    const data = await dataFetcher.fetchPrices(tokens, yesterday, now);
    
    if (data.length > 0) {
      const latest = data[data.length - 1];
      console.log('\nLatest prices:');
      for (const token of tokens) {
        const price = latest.prices[token.symbol];
        console.log(`  ${token.symbol}: $${price?.toFixed(2) ?? 'N/A'}`);
      }
    }
  } catch (err) {
    console.error('Failed to fetch prices:', err);
  }
}

function printHelp() {
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

