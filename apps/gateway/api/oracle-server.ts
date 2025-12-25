#!/usr/bin/env bun
import { getCurrentNetwork } from '@jejunetwork/config'
import type { NetworkType, OracleNodeConfig } from '@jejunetwork/types'
import {
  createConfig,
  MetricsExporter,
  OracleNode,
  validateConfig,
} from './oracle'

const USAGE = `
Jeju Oracle Network Node

Usage: bun run src/oracle-server.ts [options]

Options:
  --network=<network>     Network: localnet, testnet, mainnet (default: localnet)
  --metrics-port=<port>   Metrics port (default: 9090)
  --dry-run               Validate config and exit
  --help, -h              Show this help

Environment:
  OPERATOR_PRIVATE_KEY    Operator wallet key (required)
  WORKER_PRIVATE_KEY      Worker wallet key (required)
  JEJU_NETWORK            Network override
  BASE_SEPOLIA_RPC_URL    Testnet RPC
  BASE_MAINNET_RPC_URL    Mainnet RPC

Example:
  OPERATOR_PRIVATE_KEY=0x... WORKER_PRIVATE_KEY=0x... bun run src/oracle-server.ts --network=testnet
`

function parseArgs(): {
  network: NetworkType
  metricsPort: number
  dryRun: boolean
  help: boolean
} {
  const args = process.argv.slice(2)
  let network: NetworkType = getCurrentNetwork()
  let metricsPort = parseInt(process.env.METRICS_PORT || '9090', 10)
  let dryRun = false
  let help = false

  for (const arg of args) {
    if (arg.startsWith('--network=')) {
      network = arg.split('=')[1] as NetworkType
    } else if (arg.startsWith('--metrics-port=')) {
      metricsPort = parseInt(arg.split('=')[1], 10)
    } else if (arg === '--dry-run') {
      dryRun = true
    } else if (arg === '--help' || arg === '-h') {
      help = true
    }
  }

  return { network, metricsPort, dryRun, help }
}

async function main(): Promise<void> {
  const { network, metricsPort, dryRun, help } = parseArgs()

  if (help) {
    console.log(USAGE)
    process.exit(0)
  }

  console.log('='.repeat(60))
  console.log('  Jeju Oracle Network Node')
  console.log('='.repeat(60))
  console.log()

  // Load and validate configuration
  let config: OracleNodeConfig
  try {
    config = await createConfig(network)
    config.metricsPort = metricsPort
    validateConfig(config)
  } catch (err) {
    console.error(
      '[FATAL] Configuration error:',
      err instanceof Error ? err.message : err,
    )
    process.exit(1)
  }

  if (dryRun) {
    console.log('[OK] Configuration valid')
    const rpcUrlSafe =
      config.rpcUrl.includes('localhost') || config.rpcUrl.includes('127.0.0.1')
        ? config.rpcUrl
        : config.rpcUrl
            .replace(/\/\/([^:]+):([^@]+)@/, '//<redacted>@')
            .split('?')[0]

    console.log(
      JSON.stringify(
        {
          network,
          chainId: config.chainId,
          rpcUrl: rpcUrlSafe,
          feedRegistry: config.feedRegistry,
          reportVerifier: config.reportVerifier,
          committeeManager: config.committeeManager,
          metricsPort: config.metricsPort,
        },
        null,
        2,
      ),
    )
    process.exit(0)
  }

  const node = new OracleNode(config)
  const metrics = new MetricsExporter(config)

  let shuttingDown = false
  const shutdown = async (signal: string) => {
    if (shuttingDown) return
    shuttingDown = true
    console.log(`\n[${signal}] Shutting down gracefully...`)
    await node.stop()
    metrics.stop()
    console.log('[OK] Shutdown complete')
    process.exit(0)
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))

  // Start services
  try {
    await metrics.start()

    // Connect metrics to node
    setInterval(() => {
      metrics.setNodeMetrics(node.getMetrics())
    }, 5000)

    await node.start()

    console.log()
    console.log('[OK] Oracle node running')
    console.log(`    Network: ${network} (chainId: ${config.chainId})`)
    console.log(`    Metrics: http://localhost:${config.metricsPort}/metrics`)
    console.log(`    Health:  http://localhost:${config.metricsPort}/health`)
    console.log()
    console.log('Press Ctrl+C to stop')
  } catch (err) {
    console.error(
      '[FATAL] Failed to start:',
      err instanceof Error ? err.message : err,
    )
    process.exit(1)
  }
}

main()
