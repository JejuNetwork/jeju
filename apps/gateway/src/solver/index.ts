import { SolverAgent } from './agent';
import { LiquidityManager } from './liquidity';
import { EventMonitor } from './monitor';
import { StrategyEngine } from './strategy';
import { IS_TESTNET, getRpcUrl, getChainName } from '../config/networks.js';

interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
}

const TESTNET_CHAINS: ChainConfig[] = [
  { chainId: 11155111, name: getChainName(11155111), rpcUrl: getRpcUrl(11155111) },
  { chainId: 84532, name: getChainName(84532), rpcUrl: getRpcUrl(84532) },
  { chainId: 421614, name: getChainName(421614), rpcUrl: getRpcUrl(421614) },
  { chainId: 11155420, name: getChainName(11155420), rpcUrl: getRpcUrl(11155420) },
  { chainId: 420690, name: getChainName(420690), rpcUrl: getRpcUrl(420690) },
];

const MAINNET_CHAINS: ChainConfig[] = [
  { chainId: 1, name: getChainName(1), rpcUrl: getRpcUrl(1) },
  { chainId: 8453, name: getChainName(8453), rpcUrl: getRpcUrl(8453) },
  { chainId: 42161, name: getChainName(42161), rpcUrl: getRpcUrl(42161) },
  { chainId: 10, name: getChainName(10), rpcUrl: getRpcUrl(10) },
  { chainId: 420691, name: getChainName(420691), rpcUrl: getRpcUrl(420691) },
];

const SOLVER_CONFIG = {
  chains: IS_TESTNET ? TESTNET_CHAINS : MAINNET_CHAINS,
  minProfitBps: 10,
  maxGasPrice: 100n * 10n ** 9n,
  maxExposurePerChain: '10000000000000000000',
  maxIntentSize: '5000000000000000000',
  minReputation: 80,
  intentCheckIntervalMs: 1000,
  liquidityRebalanceIntervalMs: 60000,
};

async function main() {
  console.log('🤖 Starting OIF Solver Agent...');

  const liquidityManager = new LiquidityManager(SOLVER_CONFIG);
  const strategyEngine = new StrategyEngine(SOLVER_CONFIG);
  const eventMonitor = new EventMonitor(SOLVER_CONFIG);
  const agent = new SolverAgent({ config: SOLVER_CONFIG, liquidityManager, strategyEngine, eventMonitor });

  await agent.start();

  console.log(`✅ Solver Agent running`);
  console.log(`   Chains: ${SOLVER_CONFIG.chains.map(c => c.name).join(', ')}`);
  console.log(`   Min Profit: ${SOLVER_CONFIG.minProfitBps} bps`);

  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down solver...');
    await agent.stop();
    process.exit(0);
  });
}

main().catch(console.error);

export { SolverAgent, LiquidityManager, EventMonitor, StrategyEngine, SOLVER_CONFIG };
