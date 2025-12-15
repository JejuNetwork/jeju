import { SolverAgent } from './agent';
import { LiquidityManager } from './liquidity';
import { EventMonitor } from './monitor';
import { StrategyEngine } from './strategy';
import { IS_TESTNET, getRpcUrl, getChainName } from '../config/networks.js';

const CHAINS = (IS_TESTNET
  ? [11155111, 84532, 421614, 11155420, 420690]
  : [1, 8453, 42161, 10, 420691]
).map(id => ({ chainId: id, name: getChainName(id), rpcUrl: getRpcUrl(id) }));

const CONFIG = {
  chains: CHAINS,
  minProfitBps: 10,
  maxGasPrice: 100n * 10n ** 9n,
  maxIntentSize: '5000000000000000000', // 5 ETH
  // Enable external protocol integrations for permissionless revenue (no API keys needed)
  enableExternalProtocols: true,
  isTestnet: IS_TESTNET,
};

async function main() {
  console.log('🤖 Starting OIF Solver with External Protocol Integrations...');
  console.log('   📊 Enabled protocols (all permissionless, no API keys):');
  console.log('      - Across Protocol (cross-chain deposits)');
  console.log('      - UniswapX (intent-based swaps)');
  console.log('      - CoW Protocol (batch auctions)');

  const liquidity = new LiquidityManager({ chains: CHAINS, verbose: true });
  const strategy = new StrategyEngine(CONFIG);
  const monitor = new EventMonitor({ chains: CHAINS });
  const agent = new SolverAgent(CONFIG, liquidity, strategy, monitor);

  await agent.start();
  console.log(`\n✅ Running on: ${CHAINS.map(c => c.name).join(', ')}`);

  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    await agent.stop();
    process.exit(0);
  });
}

main().catch(console.error);

export { SolverAgent, LiquidityManager, EventMonitor, StrategyEngine };
export * from './metrics';
export * from './contracts';
export * from './external';
