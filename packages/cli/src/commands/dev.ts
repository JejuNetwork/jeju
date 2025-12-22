/**
 * jeju dev - Start development environment
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Command } from 'commander'
import { execa } from 'execa'
import { bootstrapContracts, stopLocalnet } from '../lib/chain'
import { logger } from '../lib/logger'
import { findMonorepoRoot } from '../lib/system'
import { discoverApps } from '../lib/testing'
import {
  createInfrastructureService,
  type InfrastructureService,
} from '../services/infrastructure'
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
let proxyEnabled = false

export const devCommand = new Command('dev')
  .description('Start development environment (localnet + apps)')
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
  .option('--bootstrap', 'Force contract bootstrap even if already deployed')
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
}): Promise<void> {
  logger.header('JEJU DEV')

  const rootDir = process.cwd()
  setupSignalHandlers()

  // Step 1: Ensure all infrastructure is running (Docker, services, localnet)
  infrastructureService = createInfrastructureService(rootDir)
  const infraReady = await infrastructureService.ensureRunning()

  if (!infraReady) {
    logger.error('Failed to start infrastructure')
    process.exit(1)
  }

  const l2RpcUrl = `http://127.0.0.1:${DEFAULT_PORTS.l2Rpc}`

  // Bootstrap contracts (if needed or forced)
  if (options.bootstrap) {
    logger.step('Bootstrapping contracts...')
    await bootstrapContracts(rootDir, l2RpcUrl)
  } else {
    // Check if already bootstrapped
    const bootstrapFile = join(
      rootDir,
      'packages/contracts/deployments/localnet-complete.json',
    )
    if (!existsSync(bootstrapFile)) {
      logger.step('Bootstrapping contracts...')
      await bootstrapContracts(rootDir, l2RpcUrl)
    } else {
      logger.debug('Contracts already bootstrapped')
    }
  }

  // Start local domain proxy (unless disabled)
  if (options.proxy !== false) {
    await startLocalProxy(rootDir)
  }

  // Start development services (inference, storage, etc.)
  if (options.services !== false) {
    servicesOrchestrator = createOrchestrator(rootDir)
    await servicesOrchestrator.startAll({
      inference: options.inference !== false,
    })
  }

  if (options.minimal) {
    printReady(l2RpcUrl, runningServices, servicesOrchestrator)
    await waitForever()
    return
  }

  // Start indexer
  await startIndexer(rootDir, l2RpcUrl)

  // Discover and start apps
  const apps = discoverApps(rootDir)
  const appsToStart = filterApps(apps, options)

  // Get service environment variables (combine infrastructure + orchestrator)
  // Infrastructure is always initialized at this point - no need for fallback
  const infraEnv = infrastructureService.getEnvVars()
  const orchestratorEnv = servicesOrchestrator?.getEnvVars() ?? {}
  const serviceEnv = { ...infraEnv, ...orchestratorEnv }

  logger.step(`Starting ${appsToStart.length} apps...`)
  for (const app of appsToStart) {
    await startApp(rootDir, app, l2RpcUrl, serviceEnv)
  }

  printReady(l2RpcUrl, runningServices, servicesOrchestrator)
  await waitForever()
}

async function startLocalProxy(rootDir: string): Promise<void> {
  const proxyScript = join(
    rootDir,
    'packages/deployment/scripts/shared/local-proxy.ts',
  )
  if (!existsSync(proxyScript)) {
    logger.debug('Local proxy script not found, skipping')
    return
  }

  logger.step('Starting local domain proxy...')

  // Dynamic import required: file is optional (may not exist) and TypeScript
  // static imports require files to exist at compile time. The path itself
  // is static ('packages/deployment/scripts/shared/local-proxy.ts' relative
  // to monorepo root), but we need runtime import to handle missing file.
  const { startProxy, isCaddyInstalled } = await import(proxyScript)

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

    // Stop local proxy
    if (proxyEnabled) {
      const proxyScript = join(
        process.cwd(),
        'packages/deployment/scripts/shared/local-proxy.ts',
      )
      if (existsSync(proxyScript)) {
        // Dynamic import required: file is optional (may not exist) and TypeScript
        // static imports require files to exist at compile time. The path itself
        // is static ('packages/deployment/scripts/shared/local-proxy.ts' relative
        // to monorepo root), but we need runtime import to handle missing file.
        const { stopProxy } = await import(proxyScript)
        await stopProxy()
      }
    }

    // Stop orchestrated services
    if (servicesOrchestrator) {
      await servicesOrchestrator.stopAll()
    }

    for (const service of runningServices) {
      if (service.process) {
        service.process.kill('SIGTERM')
      }
    }

    // Stop monitoring (ignore errors during cleanup)
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

async function startIndexer(rootDir: string, rpcUrl: string): Promise<void> {
  const indexerDir = join(rootDir, 'apps/indexer')
  if (!existsSync(indexerDir)) {
    return
  }

  logger.step('Starting indexer...')

  const proc = execa('bun', ['run', 'dev'], {
    cwd: indexerDir,
    env: {
      ...process.env,
      RPC_ETH_HTTP: rpcUrl,
      START_BLOCK: '0',
      CHAIN_ID: '1337',
      GQL_PORT: String(DEFAULT_PORTS.indexerGraphQL),
    },
    stdio: 'pipe',
  })

  runningServices.push({
    name: 'Indexer',
    port: DEFAULT_PORTS.indexerGraphQL,
    process: proc,
  })

  await new Promise((r) => setTimeout(r, 3000))
}

async function startApp(
  rootDir: string,
  app: AppManifest,
  rpcUrl: string,
  serviceEnv: Record<string, string> = {},
): Promise<void> {
  const appDir = join(rootDir, 'apps', app.name)
  const vendorDir = join(rootDir, 'vendor', app.name)
  const dir = existsSync(appDir) ? appDir : vendorDir

  if (!existsSync(dir)) return

  const devCommand = app.commands?.dev
  if (!devCommand) return

  const mainPort = app.ports?.main
  const appEnv: Record<string, string> = {
    ...(process.env as Record<string, string>),
    ...serviceEnv, // Inject service URLs
    JEJU_RPC_URL: rpcUrl,
    RPC_URL: rpcUrl,
    CHAIN_ID: '1337',
  }

  if (mainPort) {
    appEnv.PORT = String(mainPort)
  }

  const [cmd, ...args] = devCommand.split(' ')
  const proc = execa(cmd, args, {
    cwd: dir,
    env: appEnv,
    stdio: 'pipe',
  })

  runningServices.push({
    name: app.displayName || app.name,
    port: mainPort,
    process: proc,
  })

  // Prevent unhandled rejection on process termination
  proc.catch(() => undefined)
}

async function startVendorOnly(): Promise<void> {
  const rootDir = findMonorepoRoot()
  const scriptPath = join(
    rootDir,
    'packages/deployment/scripts/dev-with-vendor.ts',
  )

  if (!existsSync(scriptPath)) {
    logger.error('Vendor-only script not found')
    return
  }

  logger.header('STARTING VENDOR APPS ONLY')
  logger.info('Make sure the chain is running separately')
  logger.newline()

  await execa('bun', ['run', scriptPath], {
    cwd: rootDir,
    stdio: 'inherit',
  })
}

function printReady(
  rpcUrl: string,
  services: RunningService[],
  orchestrator: ServicesOrchestrator | null,
): void {
  console.clear()

  logger.header('READY')
  logger.info('Press Ctrl+C to stop\n')

  // Show infrastructure services
  if (infrastructureService) {
    logger.subheader('Infrastructure')
    logger.table([
      {
        label: 'CovenantSQL',
        value: 'http://127.0.0.1:4661',
        status: 'ok' as const,
      },
      {
        label: 'IPFS',
        value: `http://127.0.0.1:${DEFAULT_PORTS.ipfs}`,
        status: 'ok' as const,
      },
      { label: 'Cache', value: 'http://127.0.0.1:4115', status: 'ok' as const },
      {
        label: 'DA Server',
        value: 'http://127.0.0.1:4010',
        status: 'ok' as const,
      },
    ])
  }

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
    chainRows.push({
      label: 'L2 RPC (domain)',
      value: DOMAIN_CONFIG.local.rpc,
      status: 'ok' as const,
    })
  }
  logger.table(chainRows)

  // Print orchestrated services
  if (orchestrator) {
    orchestrator.printStatus()
  }

  if (services.length > 0) {
    logger.subheader('Apps')
    for (const svc of services) {
      const port = svc.port
      const portUrl = port ? `http://127.0.0.1:${port}` : 'running'

      // Show local domain URL if proxy is enabled
      if (proxyEnabled && port) {
        const domainName = svc.name.toLowerCase().replace(/\s+/g, '-')
        const localUrl = `http://${domainName}.${DOMAIN_CONFIG.localDomain}`
        logger.table([
          {
            label: svc.name,
            value: `${localUrl} (port ${port})`,
            status: 'ok',
          },
        ])
      } else {
        logger.table([{ label: svc.name, value: portUrl, status: 'ok' }])
      }
    }
  }

  // Show local domain info
  if (proxyEnabled) {
    logger.newline()
    logger.subheader('Local Domains')
    logger.info(`All apps accessible at *.${DOMAIN_CONFIG.localDomain}`)
    logger.table([
      { label: 'Gateway', value: DOMAIN_CONFIG.local.gateway, status: 'ok' },
      { label: 'Bazaar', value: DOMAIN_CONFIG.local.bazaar, status: 'ok' },
      { label: 'Docs', value: DOMAIN_CONFIG.local.docs, status: 'ok' },
    ])
  }

  logger.subheader('Test Wallet')
  const deployer = WELL_KNOWN_KEYS.dev[0]
  logger.keyValue('Address', deployer.address)
  logger.keyValue('Key', `${deployer.privateKey.slice(0, 20)}...`)
  logger.warn('Well-known test key - DO NOT use on mainnet')
}

async function waitForever(): Promise<void> {
  await new Promise(() => {
    /* never resolves */
  })
}
