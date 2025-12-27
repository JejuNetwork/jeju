import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  getCQLBlockProducerUrl,
  getFarcasterHubUrl,
  getRpcUrl,
} from '@jejunetwork/config'
import { isValidAddress } from '@jejunetwork/types'
import { Command } from 'commander'
import { execa } from 'execa'
import { bootstrapContracts, stopLocalnet } from '../lib/chain'
import { isPortForwardingActive } from '../lib/local-proxy'
import { logger } from '../lib/logger'
import { findMonorepoRoot } from '../lib/system'
import { discoverApps } from '../lib/testing'
import {
  createInfrastructureService,
  type InfrastructureService,
} from '../services/infrastructure'
import {
  createLocalDeployOrchestrator,
  type LocalDeployOrchestrator,
} from '../services/local-deploy-orchestrator'
import {
  createOrchestrator,
  type ServicesOrchestrator,
} from '../services/orchestrator'
import {
  type AppManifest,
  DEFAULT_PORTS,
  DOMAIN_CONFIG,
  WELL_KNOWN_KEYS,
} from '../types'

interface RunningService {
  name: string
  port?: number
  url?: string
  process?: ReturnType<typeof execa>
}

const runningServices: RunningService[] = []
let isShuttingDown = false
let servicesOrchestrator: ServicesOrchestrator | null = null
let infrastructureService: InfrastructureService | null = null
let localDeployOrchestrator: LocalDeployOrchestrator | null = null
let proxyEnabled = false

export const devCommand = new Command('dev')
  .description(
    'Start development environment with HMR (bootstraps contracts + deploys apps)',
  )
  .option('--minimal', 'Localnet only (no apps)')
  .option(
    '--vendor-only',
    'Start only vendor apps (requires chain running separately)',
  )
  .option('--only <apps>', 'Start specific apps (comma-separated)')
  .option('--skip <apps>', 'Skip specific apps (comma-separated)')
  .option('--stop', 'Stop the development environment')
  .option('--no-inference', 'Skip starting inference service')
  .option('--no-services', 'Skip all simulated services')
  .option('--no-apps', 'Skip starting apps (same as --minimal)')
  .option('--no-proxy', 'Skip starting local domain proxy')
  .option('--no-bootstrap', 'Skip contract bootstrap (use existing deployment)')
  .option('--seed', 'Run app seed scripts after bootstrap (deploys test data)')
  .action(async (options) => {
    if (options.stop) {
      await stopDev()
      return
    }

    // Map --no-apps to --minimal
    if (options.noApps) {
      options.minimal = true
    }

    // Handle vendor-only mode
    if (options.vendorOnly) {
      await startVendorOnly()
      return
    }

    await startDev(options)
  })

async function startDev(options: {
  minimal?: boolean
  only?: string
  skip?: string
  inference?: boolean
  services?: boolean
  bootstrap?: boolean
  noApps?: boolean
  proxy?: boolean
  seed?: boolean
}): Promise<void> {
  logger.header('JEJU DEV')
  logger.info('Development mode with HMR\n')

  const rootDir = process.cwd()
  setupSignalHandlers()

  // Start infrastructure (CQL, Docker services, localnet) - parallelized for speed
  infrastructureService = createInfrastructureService(rootDir)
  const infraReady = await infrastructureService.ensureRunning()

  if (!infraReady) {
    logger.error('Failed to start infrastructure')
    process.exit(1)
  }

  const l2RpcUrl = `http://127.0.0.1:${DEFAULT_PORTS.l2Rpc}`

  // Bootstrap contracts (default: always, unless --no-bootstrap)
  let didBootstrap = false
  if (options.bootstrap !== false) {
    logger.step('Bootstrapping contracts...')
    await bootstrapContracts(rootDir, l2RpcUrl)
    didBootstrap = true
  } else {
    logger.debug('Skipping bootstrap (--no-bootstrap)')
  }

  // Start proxy and services in parallel - they're independent
  const parallelStartTasks: Promise<void>[] = []

  // Run app seed scripts if --seed or first bootstrap (can run in parallel)
  if (options.seed || didBootstrap) {
    parallelStartTasks.push(runAppSeeds(rootDir, l2RpcUrl))
  }

  // Start local domain proxy (unless disabled)
  if (options.proxy !== false) {
    parallelStartTasks.push(startLocalProxy(rootDir))
  }

  // Start development services (inference, storage, etc.)
  if (options.services !== false) {
    servicesOrchestrator = createOrchestrator(rootDir)
    parallelStartTasks.push(
      servicesOrchestrator.startAll({
        inference: options.inference !== false,
      }),
    )
  }

  // Wait for all parallel startup tasks
  await Promise.all(parallelStartTasks)

  if (options.minimal) {
    await printReady(l2RpcUrl, runningServices, servicesOrchestrator, [])
    await waitForever()
    return
  }

  const apps = discoverApps(rootDir, true)
  const appsToStart = filterApps(apps, options)

  await deployAppsOnchain(rootDir, l2RpcUrl, appsToStart)

  await printReady(l2RpcUrl, runningServices, servicesOrchestrator, appsToStart)
  await waitForever()
}

async function deployAppsOnchain(
  rootDir: string,
  rpcUrl: string,
  apps: AppManifest[],
): Promise<void> {
  logger.step('Deploying apps on-chain through DWS...')

  // Use the deployer private key
  const deployerKey = WELL_KNOWN_KEYS.dev[0].privateKey as `0x${string}`

  // Create the local deploy orchestrator
  localDeployOrchestrator = createLocalDeployOrchestrator(
    rootDir,
    rpcUrl,
    deployerKey,
  )

  let dwsContracts = localDeployOrchestrator.loadDWSContracts()

  if (!dwsContracts) {
    // Deploy DWS contracts
    dwsContracts = await localDeployOrchestrator.deployDWSContracts()
  } else {
    logger.debug('DWS contracts already deployed')
  }

  logger.step('Registering local DWS node...')
  await localDeployOrchestrator.registerLocalNode()

  logger.step('Starting DWS server...')
  const dwsDir = join(rootDir, 'apps/dws')
  if (existsSync(dwsDir)) {
    const dwsProc = execa('bun', ['run', 'dev'], {
      cwd: dwsDir,
      env: {
        ...process.env,
        RPC_URL: rpcUrl,
        WORKER_REGISTRY_ADDRESS: dwsContracts.workerRegistry,
        STORAGE_MANAGER_ADDRESS: dwsContracts.storageManager,
        CDN_REGISTRY_ADDRESS: dwsContracts.cdnRegistry,
        JNS_REGISTRY_ADDRESS: dwsContracts.jnsRegistry,
        JNS_RESOLVER_ADDRESS: dwsContracts.jnsResolver,
        FARCASTER_HUB_URL: getFarcasterHubUrl(),
      },
      stdio: 'pipe',
    })

    runningServices.push({
      name: 'DWS',
      port: 4030,
      process: dwsProc,
    })

    // Wait for DWS to start
    await new Promise((r) => setTimeout(r, 5000))
    logger.success('DWS server running on port 4030')
  }

  // Start OAuth3 authentication gateway (required for auth flows)
  logger.step('Starting OAuth3 authentication gateway...')
  const oauth3Dir = join(rootDir, 'apps/oauth3')
  if (existsSync(oauth3Dir)) {
    const oauth3Proc = execa('bun', ['run', 'dev'], {
      cwd: oauth3Dir,
      env: {
        ...process.env,
        PORT: '4200',
        RPC_URL: rpcUrl,
        NODE_ENV: 'development',
      },
      stdio: 'pipe',
    })

    runningServices.push({
      name: 'OAuth3',
      port: 4200,
      process: oauth3Proc,
    })

    // Give OAuth3 a moment to start
    await new Promise((r) => setTimeout(r, 1000))
    logger.success('OAuth3 gateway running on port 4200')
  }

  const appsWithDirs = apps.map((app) => {
    // Determine app directory - vendor apps are in vendor/, core apps in apps/
    const folderName = app._folderName || app.name
    const isVendor = app.type === 'vendor'
    const dir = isVendor
      ? join(rootDir, 'vendor', folderName)
      : join(rootDir, 'apps', folderName)
    return { dir, manifest: app }
  })

  await localDeployOrchestrator.deployAllApps(appsWithDirs)

  // Start vendor app backend workers in parallel
  logger.step('Starting vendor app backends in parallel...')
  const vendorAppsWithBackend = appsWithDirs.filter(
    ({ manifest }) =>
      manifest.type === 'vendor' && manifest.architecture?.backend,
  )

  const backendStartTasks = vendorAppsWithBackend.map(({ dir, manifest }) => {
    const backend = manifest.architecture?.backend
    const commands = manifest.commands as Record<string, string> | undefined
    const startCmd =
      typeof backend === 'object' && 'startCmd' in backend
        ? (backend.startCmd as string)
        : commands?.['start:worker']

    if (!startCmd) {
      logger.debug(`  ${manifest.name}: No backend start command found`)
      return null
    }

    // Get the API port from manifest
    const apiPort = manifest.ports?.api ?? manifest.ports?.main ?? 5009

    logger.debug(`  Starting ${manifest.name} backend on port ${apiPort}...`)

    const workerProc = execa('bun', ['run', startCmd.replace('bun run ', '')], {
      cwd: dir,
      env: {
        ...process.env,
        PORT: String(apiPort),
        JEJU_RPC_URL: rpcUrl,
        JEJU_DWS_ENDPOINT: 'http://localhost:4030',
        JEJU_NETWORK: 'localnet',
        TEE_PROVIDER: 'local',
        CQL_BLOCK_PRODUCER_ENDPOINT: getCQLBlockProducerUrl(),
        WORKER_REGISTRY_ADDRESS: dwsContracts.workerRegistry,
        STORAGE_MANAGER_ADDRESS: dwsContracts.storageManager,
        CDN_REGISTRY_ADDRESS: dwsContracts.cdnRegistry,
        JNS_REGISTRY_ADDRESS: dwsContracts.jnsRegistry,
        JNS_RESOLVER_ADDRESS: dwsContracts.jnsResolver,
        // Public RPC fallbacks for external chain queries
        ETHEREUM_RPC_URL:
          process.env.ETHEREUM_RPC_URL || 'https://eth.llamarpc.com',
        SEPOLIA_RPC_URL:
          process.env.SEPOLIA_RPC_URL ||
          'https://ethereum-sepolia-rpc.publicnode.com',
        BASE_RPC_URL: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
        BASE_SEPOLIA_RPC_URL:
          process.env.BASE_SEPOLIA_RPC_URL || 'https://sepolia.base.org',
      },
      stdio: 'pipe',
    })

    runningServices.push({
      name: `${manifest.displayName || manifest.name} API`,
      port: apiPort,
      process: workerProc,
    })

    return { name: manifest.displayName || manifest.name, port: apiPort }
  })

  // Filter out nulls and log started backends
  const startedBackends = backendStartTasks.filter(Boolean)
  for (const backend of startedBackends) {
    if (backend) {
      logger.success(
        `  ${backend.name} backend started on port ${backend.port}`,
      )
    }
  }

  logger.step('Starting JNS Gateway...')
  const { startLocalJNSGateway } = await import('../lib/jns-gateway-local')
  // Use port 4303 for JNS Gateway (Caddy on 8080 will proxy to it)
  // Port 4302 is used by the JNS resolution service
  // Pass rootDir for local dev fallback (serving from build directories)
  await startLocalJNSGateway(
    rpcUrl,
    dwsContracts.jnsRegistry,
    4303,
    4180,
    rootDir,
  )

  logger.success('Decentralized deployment complete')
  logger.info(
    'Apps are now accessible via JNS names at *.local.jejunetwork.org:8080',
  )
}

async function startLocalProxy(_rootDir: string): Promise<void> {
  logger.step('Starting local domain proxy...')

  const { startProxy, isCaddyInstalled, ensureSudoAccess } = await import(
    '../lib/local-proxy'
  )

  // Check if Caddy is available
  const caddyInstalled = await isCaddyInstalled()
  if (!caddyInstalled) {
    logger.warn('Caddy not installed - local domains disabled')
    logger.info(
      '  Install with: brew install caddy (macOS) or apt install caddy (Linux)',
    )
    logger.info('  Apps available at localhost ports instead')
    return
  }

  // Ensure sudo credentials are cached for port 80 before starting background processes
  await ensureSudoAccess()

  const started = await startProxy()
  if (started) {
    proxyEnabled = true
    logger.success('Local proxy running')
    logger.info(`  Access apps at *.${DOMAIN_CONFIG.localDomain}`)
  }
}

async function stopDev(): Promise<void> {
  logger.header('STOPPING')

  logger.step('Stopping localnet...')
  await stopLocalnet()
  logger.success('Stopped')
}

function setupSignalHandlers(): void {
  const cleanup = async () => {
    if (isShuttingDown) return
    isShuttingDown = true

    logger.newline()
    logger.step('Shutting down...')

    if (proxyEnabled) {
      const { stopProxy } = await import('../lib/local-proxy')
      await stopProxy()
    }

    if (servicesOrchestrator) {
      await servicesOrchestrator.stopAll()
    }

    for (const service of runningServices) {
      if (service.process) {
        service.process.kill('SIGTERM')
      }
    }

    await execa('docker', ['compose', 'down'], {
      cwd: join(process.cwd(), 'apps/monitoring'),
      reject: false,
    }).catch(() => undefined)

    logger.success('Stopped')
    process.exit(0)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
}

function filterApps(
  apps: AppManifest[],
  options: { only?: string; skip?: string },
): AppManifest[] {
  let filtered = apps.filter(
    (app) =>
      app.enabled !== false &&
      app.autoStart !== false &&
      app.name !== 'indexer' &&
      app.name !== 'monitoring',
  )

  if (options.only) {
    const only = options.only.split(',').map((s) => s.trim())
    filtered = filtered.filter((app) => only.includes(app.name))
  }

  if (options.skip) {
    const skip = options.skip.split(',').map((s) => s.trim())
    filtered = filtered.filter((app) => !skip.includes(app.name))
  }

  return filtered
}

async function startVendorOnly(): Promise<void> {
  const rootDir = findMonorepoRoot()

  logger.header('DEPLOYING VENDOR APPS')
  logger.info(
    'Make sure the chain is running separately with DWS contracts deployed',
  )
  logger.newline()

  const { discoverVendorApps } = await import('../lib/discover-apps')
  const vendorApps = discoverVendorApps(rootDir)

  if (vendorApps.length === 0) {
    logger.warn('No vendor apps found in vendor/ directory')
    logger.info('Add vendor apps with: jeju vendor add <repo-url>')
    return
  }

  logger.info(`Found ${vendorApps.length} vendor apps:`)
  for (const app of vendorApps) {
    logger.info(`  - ${app.name}`)
  }
  logger.newline()

  // Deploy vendor apps on-chain through DWS
  const rpcUrl = getRpcUrl()
  const deployerKey = WELL_KNOWN_KEYS.dev[0].privateKey as `0x${string}`

  localDeployOrchestrator = createLocalDeployOrchestrator(
    rootDir,
    rpcUrl,
    deployerKey,
  )

  // Load existing DWS contracts (must be deployed already)
  const dwsContracts = localDeployOrchestrator.loadDWSContracts()
  if (!dwsContracts) {
    logger.error(
      'DWS contracts not found. Run `bun run dev` first to deploy contracts.',
    )
    process.exit(1)
  }

  // Deploy vendor apps on-chain
  const appsWithDirs = vendorApps.map((app) => ({
    dir: app.path,
    manifest: app.manifest as AppManifest,
  }))

  await localDeployOrchestrator.deployAllApps(appsWithDirs)

  logger.success('Vendor apps deployed on-chain')
  logger.info('Access via JNS names at *.local.jejunetwork.org:8080')

  // Setup signal handlers and wait
  setupSignalHandlers()
  await waitForever()
}

/**
 * Format URL with or without port - port 80 is omitted (standard HTTP)
 */
function formatLocalUrl(
  subdomain: string,
  domain: string,
  port: number,
): string {
  if (port === 80) {
    return `http://${subdomain}.${domain}`
  }
  return `http://${subdomain}.${domain}:${port}`
}

async function printReady(
  rpcUrl: string,
  services: RunningService[],
  orchestrator: ServicesOrchestrator | null,
  deployedApps: AppManifest[],
): Promise<void> {
  console.clear()

  logger.header('READY')
  logger.info('Press Ctrl+C to stop\n')

  // Show infrastructure services
  if (infrastructureService) {
    logger.subheader('Infrastructure')
    logger.table([
      {
        label: 'CovenantSQL',
        value: getCQLBlockProducerUrl(),
        status: 'ok' as const,
      },
      {
        label: 'IPFS',
        value: `http://127.0.0.1:${DEFAULT_PORTS.ipfs}`,
        status: 'ok' as const,
      },
      { label: 'DWS', value: 'http://127.0.0.1:4030', status: 'ok' as const },
    ])
  }

  // Check port forwarding once for all URL displays
  const portForwardingActive = await isPortForwardingActive()
  const displayPort = portForwardingActive ? 80 : 8080

  logger.subheader('Chain')
  const chainRows = [
    {
      label: 'L1 RPC',
      value: `http://127.0.0.1:${DEFAULT_PORTS.l1Rpc}`,
      status: 'ok' as const,
    },
    { label: 'L2 RPC', value: rpcUrl, status: 'ok' as const },
  ]
  if (proxyEnabled) {
    // Build RPC URL dynamically with actual port (omit :80)
    const rpcDomainUrl = formatLocalUrl(
      'rpc',
      DOMAIN_CONFIG.localDomain,
      displayPort,
    )
    chainRows.push({
      label: 'L2 RPC (domain)',
      value: rpcDomainUrl,
      status: 'ok' as const,
    })
  }
  logger.table(chainRows)

  // Print orchestrated services
  if (orchestrator) {
    orchestrator.printStatus()
  }

  // Show all deployed apps with their local domain URLs
  if (deployedApps.length > 0 || services.length > 0) {
    logger.subheader('Apps')

    // Show all deployed apps (JNS gateway serves from local builds)
    for (const app of deployedApps) {
      // Only show apps that have frontend architecture
      const hasFrontend = app.architecture?.frontend
      if (!hasFrontend) continue

      const displayName = app.displayName || app.name
      const slug = app.name.toLowerCase().replace(/\s+/g, '-')
      const localUrl = formatLocalUrl(
        slug,
        DOMAIN_CONFIG.localDomain,
        displayPort,
      )
      logger.table([
        {
          label: displayName,
          value: localUrl,
          status: 'ok',
        },
      ])
    }

    // Then show any additional running services not in deployed apps
    for (const svc of services) {
      const alreadyShown = deployedApps.some(
        (app) => app.name.toLowerCase() === svc.name.toLowerCase(),
      )
      if (alreadyShown) continue

      const port = svc.port
      const domainName = svc.name.toLowerCase().replace(/\s+/g, '-')

      if (proxyEnabled && port) {
        const localUrl = formatLocalUrl(
          domainName,
          DOMAIN_CONFIG.localDomain,
          displayPort,
        )
        logger.table([
          {
            label: svc.name,
            value: localUrl,
            status: 'ok',
          },
        ])
      } else if (port) {
        logger.table([
          { label: svc.name, value: `http://127.0.0.1:${port}`, status: 'ok' },
        ])
      } else {
        logger.table([{ label: svc.name, value: 'running', status: 'ok' }])
      }
    }
  }

  logger.subheader('Test Wallet')
  const deployer = WELL_KNOWN_KEYS.dev[0]
  logger.keyValue('Address', deployer.address)
  logger.keyValue('Key', `${deployer.privateKey.slice(0, 20)}...`)
  logger.warn('Well-known test key - DO NOT use on mainnet')
}

async function runAppSeeds(rootDir: string, rpcUrl: string): Promise<void> {
  logger.step('Running app seed scripts...')

  // List of apps with seed scripts
  const seedApps = ['bazaar']

  for (const appName of seedApps) {
    const seedScript = join(rootDir, 'apps', appName, 'scripts/seed.ts')
    if (!existsSync(seedScript)) {
      logger.debug(`No seed script for ${appName}`)
      continue
    }

    logger.debug(`Seeding ${appName}...`)
    try {
      await execa('bun', ['run', seedScript], {
        cwd: join(rootDir, 'apps', appName),
        env: {
          ...process.env,
          JEJU_RPC_URL: rpcUrl,
        },
        stdio: 'pipe',
      })
      logger.success(`Seeded ${appName}`)
    } catch (_error) {
      // Don't fail if seed has issues - it might have already been run
      logger.debug(`Seed ${appName} completed (may have existing data)`)
    }
  }
}

async function waitForever(): Promise<void> {
  await new Promise(() => {
    /* never resolves */
  })
}

devCommand
  .command('sync')
  .description('Sync localnet contract addresses to config')
  .action(async () => {
    const rootDir = findMonorepoRoot()

    const deploymentFile = join(
      rootDir,
      'packages/contracts/deployments/localnet-complete.json',
    )
    const configFile = join(rootDir, 'packages/config/contracts.json')

    if (!existsSync(deploymentFile)) {
      logger.error('No deployment file found. Run bootstrap first: jeju dev')
      process.exit(1)
    }

    if (!existsSync(configFile)) {
      logger.error('Config file not found: packages/config/contracts.json')
      process.exit(1)
    }

    const { readFileSync, writeFileSync } = await import('node:fs')

    interface BootstrapContracts {
      jeju?: string
      usdc?: string
      weth?: string
      creditManager?: string
      universalPaymaster?: string
      serviceRegistry?: string
      priceOracle?: string
      tokenRegistry?: string
      paymasterFactory?: string
      entryPoint?: string
      identityRegistry?: string
      reputationRegistry?: string
      validationRegistry?: string
      nodeStakingManager?: string
      nodePerformanceOracle?: string
      poolManager?: string
      swapRouter?: string
      positionManager?: string
      quoterV4?: string
      stateView?: string
      futarchyGovernor?: string
      fileStorageManager?: string
      banManager?: string
      reputationLabelManager?: string
      computeRegistry?: string
      ledgerManager?: string
      inferenceServing?: string
      computeStaking?: string
      riskSleeve?: string
      liquidityRouter?: string
      multiServiceStakeManager?: string
      liquidityVault?: string
    }

    interface BootstrapResult {
      contracts: BootstrapContracts
    }

    const deployment: BootstrapResult = JSON.parse(
      readFileSync(deploymentFile, 'utf-8'),
    )
    const config = JSON.parse(readFileSync(configFile, 'utf-8'))

    logger.header('SYNC LOCALNET CONFIG')
    logger.step('Syncing localnet addresses to contracts.json...')

    const contracts = deployment.contracts

    // Update tokens
    if (isValidAddress(contracts.jeju)) {
      config.localnet.tokens.jeju = contracts.jeju
      logger.info(`  tokens.jeju: ${contracts.jeju}`)
    }
    if (isValidAddress(contracts.usdc)) {
      config.localnet.tokens.usdc = contracts.usdc
      logger.info(`  tokens.usdc: ${contracts.usdc}`)
    }

    // Update registry
    if (isValidAddress(contracts.identityRegistry)) {
      config.localnet.registry.identity = contracts.identityRegistry
      logger.info(`  registry.identity: ${contracts.identityRegistry}`)
    }
    if (isValidAddress(contracts.reputationRegistry)) {
      config.localnet.registry.reputation = contracts.reputationRegistry
      logger.info(`  registry.reputation: ${contracts.reputationRegistry}`)
    }
    if (isValidAddress(contracts.validationRegistry)) {
      config.localnet.registry.validation = contracts.validationRegistry
      logger.info(`  registry.validation: ${contracts.validationRegistry}`)
    }

    // Update moderation
    if (isValidAddress(contracts.banManager)) {
      config.localnet.moderation.banManager = contracts.banManager
      logger.info(`  moderation.banManager: ${contracts.banManager}`)
    }
    if (isValidAddress(contracts.reputationLabelManager)) {
      config.localnet.moderation.reputationLabelManager =
        contracts.reputationLabelManager
      logger.info(
        `  moderation.reputationLabelManager: ${contracts.reputationLabelManager}`,
      )
    }

    // Update nodeStaking
    if (isValidAddress(contracts.nodeStakingManager)) {
      config.localnet.nodeStaking.manager = contracts.nodeStakingManager
      logger.info(`  nodeStaking.manager: ${contracts.nodeStakingManager}`)
    }
    if (isValidAddress(contracts.nodePerformanceOracle)) {
      config.localnet.nodeStaking.performanceOracle =
        contracts.nodePerformanceOracle
      logger.info(
        `  nodeStaking.performanceOracle: ${contracts.nodePerformanceOracle}`,
      )
    }

    // Update payments
    if (isValidAddress(contracts.tokenRegistry)) {
      config.localnet.payments.tokenRegistry = contracts.tokenRegistry
      logger.info(`  payments.tokenRegistry: ${contracts.tokenRegistry}`)
    }
    if (isValidAddress(contracts.paymasterFactory)) {
      config.localnet.payments.paymasterFactory = contracts.paymasterFactory
      logger.info(`  payments.paymasterFactory: ${contracts.paymasterFactory}`)
    }
    if (isValidAddress(contracts.priceOracle)) {
      config.localnet.payments.priceOracle = contracts.priceOracle
      logger.info(`  payments.priceOracle: ${contracts.priceOracle}`)
    }
    if (isValidAddress(contracts.universalPaymaster)) {
      config.localnet.payments.multiTokenPaymaster =
        contracts.universalPaymaster
      logger.info(
        `  payments.multiTokenPaymaster: ${contracts.universalPaymaster}`,
      )
    }

    // Update defi
    if (isValidAddress(contracts.poolManager)) {
      config.localnet.defi.poolManager = contracts.poolManager
      logger.info(`  defi.poolManager: ${contracts.poolManager}`)
    }
    if (isValidAddress(contracts.swapRouter)) {
      config.localnet.defi.swapRouter = contracts.swapRouter
      logger.info(`  defi.swapRouter: ${contracts.swapRouter}`)
    }
    if (isValidAddress(contracts.positionManager)) {
      config.localnet.defi.positionManager = contracts.positionManager
      logger.info(`  defi.positionManager: ${contracts.positionManager}`)
    }
    if (isValidAddress(contracts.quoterV4)) {
      config.localnet.defi.quoterV4 = contracts.quoterV4
      logger.info(`  defi.quoterV4: ${contracts.quoterV4}`)
    }
    if (isValidAddress(contracts.stateView)) {
      config.localnet.defi.stateView = contracts.stateView
      logger.info(`  defi.stateView: ${contracts.stateView}`)
    }

    // Update compute
    if (isValidAddress(contracts.computeRegistry)) {
      config.localnet.compute.registry = contracts.computeRegistry
      logger.info(`  compute.registry: ${contracts.computeRegistry}`)
    }
    if (isValidAddress(contracts.ledgerManager)) {
      config.localnet.compute.ledgerManager = contracts.ledgerManager
      logger.info(`  compute.ledgerManager: ${contracts.ledgerManager}`)
    }
    if (isValidAddress(contracts.inferenceServing)) {
      config.localnet.compute.inferenceServing = contracts.inferenceServing
      logger.info(`  compute.inferenceServing: ${contracts.inferenceServing}`)
    }
    if (isValidAddress(contracts.computeStaking)) {
      config.localnet.compute.staking = contracts.computeStaking
      logger.info(`  compute.staking: ${contracts.computeStaking}`)
    }

    // Update liquidity
    if (isValidAddress(contracts.riskSleeve)) {
      config.localnet.liquidity.riskSleeve = contracts.riskSleeve
      logger.info(`  liquidity.riskSleeve: ${contracts.riskSleeve}`)
    }
    if (isValidAddress(contracts.liquidityRouter)) {
      config.localnet.liquidity.liquidityRouter = contracts.liquidityRouter
      logger.info(`  liquidity.liquidityRouter: ${contracts.liquidityRouter}`)
    }
    if (isValidAddress(contracts.multiServiceStakeManager)) {
      config.localnet.liquidity.multiServiceStakeManager =
        contracts.multiServiceStakeManager
      logger.info(
        `  liquidity.multiServiceStakeManager: ${contracts.multiServiceStakeManager}`,
      )
    }
    if (isValidAddress(contracts.liquidityVault)) {
      config.localnet.liquidity.liquidityVault = contracts.liquidityVault
      logger.info(`  liquidity.liquidityVault: ${contracts.liquidityVault}`)
    }

    // Save updated config
    writeFileSync(configFile, `${JSON.stringify(config, null, 2)}\n`)
    logger.success('Config updated: packages/config/contracts.json')
  })
