/** Manage CovenantSQL decentralized database */

import { execSync, spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  getRpcUrl as getConfigRpcUrl,
  type NetworkType,
} from '@jejunetwork/config'
import { Command } from 'commander'
import {
  createPublicClient,
  createWalletClient,
  http,
  keccak256,
  parseEther,
  stringToBytes,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia, foundry } from 'viem/chains'
import { logger } from '../lib/logger'
import { findMonorepoRoot } from '../lib/system'

type CQLMode = 'dev' | 'cluster' | 'testnet'

interface ClusterStatus {
  mode: CQLMode
  blockProducer: { running: boolean; endpoint?: string }
  miners: Array<{ id: string; running: boolean; endpoint?: string }>
  healthy: boolean
}

// ComputeRegistry ABI for database provider registration
const COMPUTE_REGISTRY_ABI = [
  {
    name: 'registerDatabaseProvider',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'serviceType', type: 'bytes32' },
    ],
    outputs: [{ name: 'providerId', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    name: 'getProvider',
    type: 'function',
    inputs: [{ name: 'providerId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'id', type: 'uint256' },
          { name: 'owner', type: 'address' },
          { name: 'name', type: 'string' },
          { name: 'endpoint', type: 'string' },
          { name: 'serviceType', type: 'bytes32' },
          { name: 'stake', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const

function loadComputeRegistryAddress(
  network: NetworkType,
): `0x${string}` | null {
  const rootDir = findMonorepoRoot()
  const paths = [
    join(rootDir, 'packages/contracts/deployments', `dws-${network}.json`),
    join(rootDir, 'packages/contracts/deployments', `${network}.json`),
  ]

  for (const path of paths) {
    if (existsSync(path)) {
      const content = readFileSync(path, 'utf-8')
      const deployment = JSON.parse(content)
      const address =
        deployment.ComputeRegistry ?? deployment.dws?.ComputeRegistry
      if (address && address !== '0x0000000000000000000000000000000000000000') {
        return address as `0x${string}`
      }
    }
  }
  return null
}

function getChainForNetwork(network: NetworkType) {
  switch (network) {
    case 'localnet':
      return foundry
    case 'testnet':
      return baseSepolia
    case 'mainnet':
      return base
    default:
      throw new Error(`Unknown network: ${network}`)
  }
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
  .requiredOption('--name <name>', 'Provider name')
  .requiredOption('--endpoint <endpoint>', 'HTTP endpoint for your node')
  .requiredOption('--stake <amount>', 'Stake amount in ETH')
  .option(
    '--private-key <key>',
    'Private key (or set DEPLOYER_PRIVATE_KEY env)',
  )
  .option(
    '--network <network>',
    'Network: localnet, testnet, mainnet',
    'localnet',
  )
  .action(async (options) => {
    logger.header('CQL REGISTER')
    logger.keyValue('Network', options.network)

    const network = options.network as NetworkType
    const privateKey = options.privateKey ?? process.env.DEPLOYER_PRIVATE_KEY

    if (!privateKey) {
      logger.error(
        'Private key required. Set --private-key or DEPLOYER_PRIVATE_KEY env',
      )
      process.exit(1)
    }

    // Load ComputeRegistry address from deployments
    const registryAddress = loadComputeRegistryAddress(network)
    if (!registryAddress) {
      logger.error('ComputeRegistry not deployed on this network')
      logger.info(`Deploy with: jeju deploy dws --network ${network}`)
      process.exit(1)
    }

    const rpcUrl = getConfigRpcUrl(network)
    const chain = getChainForNetwork(network)
    const account = privateKeyToAccount(privateKey as `0x${string}`)

    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    })

    const walletClient = createWalletClient({
      account,
      chain,
      transport: http(rpcUrl),
    })

    // Service type for database providers
    const serviceType = keccak256(stringToBytes('database'))
    const stakeAmount = parseEther(options.stake)

    logger.step('Registering as database provider in ComputeRegistry...')
    logger.keyValue('Name', options.name)
    logger.keyValue('Endpoint', options.endpoint)
    logger.keyValue('Stake', `${options.stake} ETH`)
    logger.keyValue('Registry', registryAddress)
    logger.newline()

    const hash = await walletClient.writeContract({
      address: registryAddress,
      abi: COMPUTE_REGISTRY_ABI,
      functionName: 'registerDatabaseProvider',
      args: [options.name, options.endpoint, serviceType],
      value: stakeAmount,
    })

    logger.step('Waiting for confirmation...')
    logger.keyValue('TX Hash', hash)

    const receipt = await publicClient.waitForTransactionReceipt({ hash })

    if (receipt.status === 'success') {
      logger.success('Successfully registered as database provider.')
      logger.newline()
      logger.info('Your CQL node is now registered in the ComputeRegistry.')
      logger.info('Users can discover your node via: jeju cql status')
    } else {
      logger.error('Transaction failed')
      process.exit(1)
    }
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

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
