import {
  getExternalRpc,
  getCurrentNetwork,
  getRpcUrl as getConfigRpcUrl,
} from '@jejunetwork/config'
import { SolverAgent } from './agent'
import { LiquidityManager } from './liquidity'
import { EventMonitor } from './monitor'
import { StrategyEngine } from './strategy'

const IS_TESTNET = getCurrentNetwork() !== 'mainnet'

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

  // Use centralized config for RPC URLs
  const chainToConfig: Record<number, string> = {
    1: getExternalRpc('ethereum'),
    8453: getExternalRpc('base'),
    42161: getExternalRpc('arbitrum'),
    10: getExternalRpc('optimism'),
    11155111: getExternalRpc('sepolia'),
    84532: getExternalRpc('base-sepolia'),
    421614: getExternalRpc('arbitrum-sepolia'),
    11155420: getExternalRpc('optimism-sepolia'),
    420690: getConfigRpcUrl('localnet'),
    420691: getConfigRpcUrl('mainnet'),
  }
  return chainToConfig[chainId] || getConfigRpcUrl('localnet')
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
  console.log('[OIF Solver] Starting with external protocol integrations')
  console.log(
    '[OIF Solver] Protocols: Across, UniswapX, CoW Protocol (permissionless)',
  )

  const liquidity = new LiquidityManager({ chains: CHAINS, verbose: true })
  const strategy = new StrategyEngine(CONFIG)
  const monitor = new EventMonitor({ chains: CHAINS })
  const agent = new SolverAgent(CONFIG, liquidity, strategy, monitor)

  await agent.start()
  console.log(
    `[OIF Solver] Running on: ${CHAINS.map((c) => c.name).join(', ')}`,
  )

  process.on('SIGINT', async () => {
    console.log('[OIF Solver] Shutting down')
    await agent.stop()
    process.exit(0)
  })
}

main().catch(console.error)

export { SolverAgent, LiquidityManager, EventMonitor, StrategyEngine }
export * from './contracts'
export * from './external'
export * from './metrics'
