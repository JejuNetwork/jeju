/** Manage CovenantSQL decentralized database */

import { execSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { Command } from 'commander'
import { logger } from '../lib/logger'
import { findMonorepoRoot } from '../lib/system'

type CQLMode = 'dev' | 'cluster' | 'testnet'

interface ClusterStatus {
  mode: CQLMode
  blockProducer: { running: boolean; endpoint?: string }
  miners: Array<{ id: string; running: boolean; endpoint?: string }>
  healthy: boolean
}

export const cqlCommand = new Command('cql').description(
  'Manage CovenantSQL decentralized database',
)

cqlCommand
  .command('start')
  .description('Start CQL database')
  .option(
    '--mode <mode>',
    'Mode: dev (SQLite), cluster (multi-node), testnet',
    'dev',
  )
  .option('--miners <count>', 'Number of miner nodes (cluster mode)', '3')
  .option('--detach', 'Run in background')
  .action(async (options) => {
    const mode = options.mode as CQLMode
    logger.header('CQL START')
    logger.keyValue('Mode', mode)

    switch (mode) {
      case 'dev':
        await startDevMode(options.detach)
        break
      case 'cluster':
        await startClusterMode(Number(options.miners), options.detach)
        break
      case 'testnet':
        await connectTestnet()
        break
      default:
        logger.error(`Unknown mode: ${mode}`)
        process.exit(1)
    }
  })

cqlCommand
  .command('stop')
  .description('Stop CQL database')
  .option('--mode <mode>', 'Mode: dev, cluster', 'dev')
  .action(async (options) => {
    const mode = options.mode as CQLMode
    logger.header('CQL STOP')

    switch (mode) {
      case 'dev':
        await stopDevMode()
        break
      case 'cluster':
        await stopClusterMode()
        break
      default:
        logger.info('Nothing to stop for testnet mode')
    }
  })

cqlCommand
  .command('status')
  .description('Show CQL cluster status')
  .action(async () => {
    logger.header('CQL STATUS')

    const status = await getClusterStatus()

    logger.keyValue('Mode', status.mode)
    logger.keyValue('Healthy', status.healthy ? 'Yes' : 'No')
    logger.newline()

    logger.subheader('Block Producer')
    logger.keyValue('  Running', status.blockProducer.running ? 'Yes' : 'No')
    if (status.blockProducer.endpoint) {
      logger.keyValue('  Endpoint', status.blockProducer.endpoint)
    }

    if (status.miners.length > 0) {
      logger.newline()
      logger.subheader('Miners')
      for (const miner of status.miners) {
        logger.keyValue(`  ${miner.id}`, miner.running ? 'Running' : 'Stopped')
      }
    }
  })

cqlCommand
  .command('deploy')
  .description('Deploy CQL infrastructure to Kubernetes')
  .option(
    '--network <network>',
    'Network: localnet, testnet, mainnet',
    'testnet',
  )
  .action(async (options) => {
    logger.header('CQL DEPLOY')
    logger.keyValue('Network', options.network)

    const rootDir = findMonorepoRoot()
    const deployScript = join(
      rootDir,
      'packages/deployment/scripts/deploy/deploy-cql.ts',
    )

    if (!existsSync(deployScript)) {
      logger.error('Deploy script not found')
      process.exit(1)
    }

    logger.info('Note: CQL operators register in the unified ComputeRegistry')
    logger.info('      with serviceType = keccak256("database")')
    logger.newline()

    logger.step('Deploying CQL infrastructure...')
    execSync(`bun run ${deployScript} --network ${options.network}`, {
      cwd: rootDir,
      stdio: 'inherit',
    })

    logger.success('CQL infrastructure deployed')
  })

cqlCommand
  .command('register')
  .description('Register as a CQL database provider in ComputeRegistry')
  .option('--name <name>', 'Provider name')
  .option('--endpoint <endpoint>', 'HTTP endpoint for your node')
  .option('--stake <amount>', 'Stake amount in ETH')
  .option(
    '--network <network>',
    'Network: localnet, testnet, mainnet',
    'localnet',
  )
  .action(async (options) => {
    logger.header('CQL REGISTER')
    logger.keyValue('Network', options.network)

    if (!options.name) {
      logger.error('--name is required')
      process.exit(1)
    }

    if (!options.endpoint) {
      logger.error('--endpoint is required')
      process.exit(1)
    }

    if (!options.stake) {
      logger.error('--stake is required')
      process.exit(1)
    }

    logger.step('Registering as database provider in ComputeRegistry...')
    logger.info('Call: ComputeRegistry.registerDatabaseProvider()')
    logger.info(`  name: ${options.name}`)
    logger.info(`  endpoint: ${options.endpoint}`)
    logger.info(`  stake: ${options.stake} ETH`)
    logger.info('  serviceType: keccak256("database")')
    logger.newline()

    logger.warn('Manual registration required - use cast or a transaction')
    logger.info(`
Example using cast:

cast send $COMPUTE_REGISTRY \\
  "registerDatabaseProvider(string,string,bytes32)" \\
  "${options.name}" "${options.endpoint}" 0x0 \\
  --value ${options.stake}ether \\
  --private-key $PRIVATE_KEY \\
  --rpc-url ${getRpcUrl(options.network)}
`)
  })

async function startDevMode(detach: boolean): Promise<void> {
  const rootDir = findMonorepoRoot()
  const dbPath = join(rootDir, 'packages/db')

  if (!existsSync(dbPath)) {
    logger.error('packages/db not found')
    process.exit(1)
  }

  // Check if already running
  const running = await isDevModeRunning()
  if (running) {
    logger.success('CQL dev server already running')
    return
  }

  logger.step('Starting CQL dev server (SQLite-backed)...')

  const port = process.env.CQL_PORT ?? '4661'
  const dataDir = join(rootDir, '.data/cql')

  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true })
  }

  if (detach) {
    const proc = spawn('bun', ['run', 'server'], {
      cwd: dbPath,
      env: {
        ...process.env,
        PORT: port,
        CQL_PORT: port,
        CQL_DATA_DIR: dataDir,
      },
      stdio: 'ignore',
      detached: true,
    })
    proc.unref()

    // Wait for startup
    for (let i = 0; i < 30; i++) {
      await sleep(500)
      if (await isDevModeRunning()) {
        logger.success(`CQL dev server running on port ${port}`)
        return
      }
    }
    logger.error('CQL dev server failed to start')
    process.exit(1)
  } else {
    // Run in foreground
    const proc = spawn('bun', ['run', 'server'], {
      cwd: dbPath,
      env: {
        ...process.env,
        PORT: port,
        CQL_PORT: port,
        CQL_DATA_DIR: dataDir,
      },
      stdio: 'inherit',
    })

    process.on('SIGINT', () => {
      proc.kill('SIGTERM')
      process.exit(0)
    })

    await new Promise<void>((resolve) => {
      proc.on('exit', () => resolve())
    })
  }
}

async function stopDevMode(): Promise<void> {
  logger.step('Stopping CQL dev server...')
  execSync('pkill -f "packages/db.*server" || true', { stdio: 'ignore' })
  logger.success('CQL dev server stopped')
}

async function startClusterMode(
  minerCount: number,
  detach: boolean,
): Promise<void> {
  const rootDir = findMonorepoRoot()
  const composeFile = join(
    rootDir,
    'packages/deployment/docker/cql-cluster.compose.yaml',
  )

  if (!existsSync(composeFile)) {
    logger.error('CQL cluster compose file not found')
    process.exit(1)
  }

  logger.step(`Starting CQL cluster with ${minerCount} miners...`)

  // Scale miners
  const scaleArg = `--scale cql-miner-1=1 --scale cql-miner-2=1 --scale cql-miner-3=1`

  const cmd = detach
    ? `docker compose -f ${composeFile} up -d ${scaleArg}`
    : `docker compose -f ${composeFile} up ${scaleArg}`

  execSync(cmd, { stdio: 'inherit' })

  if (detach) {
    // Wait for health
    logger.step('Waiting for cluster to be healthy...')
    for (let i = 0; i < 60; i++) {
      await sleep(1000)
      const status = await getClusterStatus()
      if (status.healthy) {
        logger.success('CQL cluster is healthy')
        logger.keyValue('Block Producer', 'http://localhost:8546')
        logger.keyValue('Client Endpoint', 'http://localhost:4661')
        logger.keyValue('Stats UI', 'http://localhost:8547/stats')
        return
      }
    }
    logger.error('CQL cluster failed to become healthy')
  }
}

async function stopClusterMode(): Promise<void> {
  const rootDir = findMonorepoRoot()
  const composeFile = join(
    rootDir,
    'packages/deployment/docker/cql-cluster.compose.yaml',
  )

  logger.step('Stopping CQL cluster...')
  execSync(`docker compose -f ${composeFile} down`, { stdio: 'inherit' })
  logger.success('CQL cluster stopped')
}

async function connectTestnet(): Promise<void> {
  logger.step('Connecting to testnet CQL...')

  const testnetUrl = 'https://cql.testnet.jejunetwork.org'

  // Verify connection
  const response = await fetch(`${testnetUrl}/health`, {
    signal: AbortSignal.timeout(5000),
  }).catch(() => null)

  if (response?.ok) {
    logger.success('Connected to testnet CQL')
    logger.keyValue('Endpoint', testnetUrl)
  } else {
    logger.error('Failed to connect to testnet CQL')
    logger.info('Ensure you have network access to the testnet')
    process.exit(1)
  }
}

async function isDevModeRunning(): Promise<boolean> {
  const port = process.env.CQL_PORT ?? '4661'
  const response = await fetch(`http://127.0.0.1:${port}/health`, {
    signal: AbortSignal.timeout(2000),
  }).catch(() => null)
  return response?.ok ?? false
}

async function getClusterStatus(): Promise<ClusterStatus> {
  // Try dev mode first
  if (await isDevModeRunning()) {
    return {
      mode: 'dev',
      blockProducer: {
        running: true,
        endpoint: `http://localhost:${process.env.CQL_PORT ?? '4661'}`,
      },
      miners: [],
      healthy: true,
    }
  }

  // Check cluster mode
  const bpHealthy = await checkEndpoint('http://localhost:8546/v1/health')
  const lbHealthy = await checkEndpoint('http://localhost:4661/health')

  if (bpHealthy || lbHealthy) {
    // Check individual miners
    const miners = await Promise.all([
      checkMiner('miner-1', 'http://localhost:4661'),
      checkMiner('miner-2', 'http://localhost:4662'),
      checkMiner('miner-3', 'http://localhost:4663'),
    ])

    return {
      mode: 'cluster',
      blockProducer: { running: bpHealthy, endpoint: 'http://localhost:8546' },
      miners,
      healthy: bpHealthy && miners.some((m) => m.running),
    }
  }

  return {
    mode: 'dev',
    blockProducer: { running: false },
    miners: [],
    healthy: false,
  }
}

async function checkEndpoint(url: string): Promise<boolean> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(2000),
  }).catch(() => null)
  return response?.ok ?? false
}

async function checkMiner(
  id: string,
  endpoint: string,
): Promise<{ id: string; running: boolean; endpoint?: string }> {
  const running = await checkEndpoint(`${endpoint}/health`)
  return { id, running, endpoint: running ? endpoint : undefined }
}

function getRpcUrl(network: string): string {
  switch (network) {
    case 'localnet':
      return 'http://localhost:6546'
    case 'testnet':
      return 'https://sepolia.base.org'
    case 'mainnet':
      return 'https://mainnet.base.org'
    default:
      throw new Error(`Unknown network: ${network}`)
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
