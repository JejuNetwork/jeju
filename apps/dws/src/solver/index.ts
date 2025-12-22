import { SolverAgent } from './agent'
import { LiquidityManager } from './liquidity'
import { EventMonitor } from './monitor'
import { StrategyEngine } from './strategy'

const IS_TESTNET =
  process.env.NETWORK === 'testnet' || process.env.NETWORK === 'localnet'

const CHAIN_NAMES: Record<number, string> = {
  1: 'Ethereum',
  8453: 'Base',
  42161: 'Arbitrum',
  10: 'Optimism',
  11155111: 'Sepolia',
  84532: 'Base Sepolia',
  421614: 'Arbitrum Sepolia',
  11155420: 'Optimism Sepolia',
  420690: 'Jeju Localnet',
  420691: 'Jeju',
}

function getChainName(chainId: number): string {
  return CHAIN_NAMES[chainId] || `Chain ${chainId}`
}

function getRpcUrl(chainId: number): string {
  const baseUrl = process.env[`RPC_URL_${chainId}`] || process.env.RPC_URL
  if (baseUrl) return baseUrl

  const defaults: Record<number, string> = {
    1: 'https://eth.llamarpc.com',
    8453: 'https://mainnet.base.org',
    42161: 'https://arb1.arbitrum.io/rpc',
    10: 'https://mainnet.optimism.io',
    11155111: 'https://rpc.sepolia.org',
    84532: 'https://sepolia.base.org',
    421614: 'https://sepolia-rollup.arbitrum.io/rpc',
    11155420: 'https://sepolia.optimism.io',
    420690: 'http://localhost:6546',
    420691: 'https://rpc.jejunetwork.org',
  }
  return defaults[chainId] || 'http://localhost:6546'
}

const CHAINS = (
  IS_TESTNET
    ? [11155111, 84532, 421614, 11155420, 420690]
    : [1, 8453, 42161, 10, 420691]
).map((id) => ({ chainId: id, name: getChainName(id), rpcUrl: getRpcUrl(id) }))

const CONFIG = {
  chains: CHAINS,
  minProfitBps: 10,
  maxGasPrice: 100n * 10n ** 9n,
  maxIntentSize: '5000000000000000000', // 5 ETH
  // Enable external protocol integrations for permissionless revenue (no API keys needed)
  enableExternalProtocols: true,
  isTestnet: IS_TESTNET,
}

async function main() {
  console.log('🤖 Starting OIF Solver with External Protocol Integrations...')
  console.log('   📊 Enabled protocols (all permissionless, no API keys):')
  console.log('      - Across Protocol (cross-chain deposits)')
  console.log('      - UniswapX (intent-based swaps)')
  console.log('      - CoW Protocol (batch auctions)')

  const liquidity = new LiquidityManager({ chains: CHAINS, verbose: true })
  const strategy = new StrategyEngine(CONFIG)
  const monitor = new EventMonitor({ chains: CHAINS })
  const agent = new SolverAgent(CONFIG, liquidity, strategy, monitor)

  await agent.start()
  console.log(`\n✅ Running on: ${CHAINS.map((c) => c.name).join(', ')}`)

  process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...')
    await agent.stop()
    process.exit(0)
  })
}

main().catch(console.error)

export { SolverAgent, LiquidityManager, EventMonitor, StrategyEngine }
export * from './contracts'
export * from './external'
export * from './metrics'
