import { existsSync } from 'node:fs'
import { join } from 'node:path'
import {
  getDWSUrl,
  getFarcasterHubUrl,
  getIpfsGatewayUrl,
  getL1RpcUrl,
  getL2RpcUrl,
  getLocalhostHost,
  getSQLitBlockProducerUrl,
} from '@jejunetwork/config'
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
  createLocalDeployOrchestrator,
  type LocalDeployOrchestrator,
} from '../services/local-deploy-orchestrator'
import { type AppManifest, DOMAIN_CONFIG, WELL_KNOWN_KEYS } from '../types'

interface RunningService {
  name: string
  port?: number
  url?: string
  process?: ReturnType<typeof execa>
}

const runningServices: RunningService[] = []
let isShuttingDown = false
let infrastructureService: InfrastructureService | null = null
let localDeployOrchestrator: LocalDeployOrchestrator | null = null
let proxyEnabled = false

export const startCommand = new Command('start')
  .description(
    'Start local production mode (apps deployed to IPFS, backends to DWS)',
  )
  .option('--minimal', 'Infrastructure only (no apps)')
  .option('--stop', 'Stop the production environment')
  .action(async (options) => {
    if (options.stop) {
      await stopProduction()
      return
    }

    await startProduction(options)
  })

/**
 * Start local production mode:
 * - Deploy frontends to IPFS (not local file serving)
 * - Deploy backends to DWS compute
 * - Full JNS resolution
 * - No HMR (production build)
 */
async function startProduction(options: { minimal?: boolean }): Promise<void> {
  logger.header('JEJU LOCAL PRODUCTION')
  logger.info('Building and deploying everything as in production...\n')

  const rootDir = findMonorepoRoot()
  setupSignalHandlers()

  // Step 1: Start infrastructure
  infrastructureService = createInfrastructureService(rootDir)
  const infraReady = await infrastructureService.ensureRunning()

  if (!infraReady) {
    logger.error('Failed to start infrastructure')
    process.exit(1)
  }

  const l2RpcUrl = getL2RpcUrl()

  // Step 2: Bootstrap contracts
  logger.step('Bootstrapping contracts...')
  await bootstrapContracts(rootDir, l2RpcUrl)

  // CRITICAL: Verify contracts are actually deployed on-chain
  logger.step('Verifying contracts on-chain...')
  const verification = await infrastructureService.verifyContractsDeployed()
  if (!verification.verified) {
    logger.error(`Contract verification failed: ${verification.error}`)
    logger.error('Contracts must be deployed before start mode can proceed.')
    process.exit(1)
  }
  logger.success('Contracts verified on-chain')

  // Step 3: Start local domain proxy
  await startLocalProxy()

  if (options.minimal) {
    await printReady(l2RpcUrl, runningServices, [])
    await waitForever()
    return
  }

  // Step 4: Build and deploy apps
  const apps = discoverApps(rootDir, true)
  const appsToStart = apps.filter(
    (app) =>
      app.enabled !== false &&
      app.autoStart !== false &&
      app.name !== 'indexer' &&
      app.name !== 'monitoring',
  )

  await deployAppsProduction(rootDir, l2RpcUrl, appsToStart)

  await printReady(l2RpcUrl, runningServices, appsToStart)
  await waitForever()
}

/**
 * Deploy apps in production mode:
 * - Build production bundles
 * - Upload frontends to IPFS
 * - Deploy backends to DWS
 */
async function deployAppsProduction(
  rootDir: string,
  rpcUrl: string,
  apps: AppManifest[],
): Promise<void> {
  logger.step('Building production bundles...')

  // Build all apps in parallel
  await Promise.all(
    apps.map(async (app) => {
      const folderName = app._folderName || app.name
      const isVendor = app.type === 'vendor'
      const dir = isVendor
        ? join(rootDir, 'vendor', folderName)
        : join(rootDir, 'apps', folderName)

      if (!existsSync(dir)) return

      const hasBuild = existsSync(join(dir, 'package.json'))
      if (hasBuild) {
        try {
          await execa('bun', ['run', 'build'], {
            cwd: dir,
            stdio: 'inherit',
          })
          logger.debug(`  Built ${app.name}`)
        } catch {
          logger.warn(`  Build failed for ${app.name}, skipping`)
        }
      }
    }),
  )

  logger.step('Deploying apps to DWS...')

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
    dwsContracts = await localDeployOrchestrator.deployDWSContracts()
  } else {
    logger.debug('DWS contracts already deployed')
  }

  logger.step('Registering DWS node...')
  await localDeployOrchestrator.registerLocalNode()

  // Start DWS server
  logger.step('Starting DWS server...')
  const dwsDir = join(rootDir, 'apps/dws')
  if (existsSync(dwsDir)) {
    const dwsProc = execa('bun', ['run', 'start'], {
      cwd: dwsDir,
      env: {
        ...process.env,
        NODE_ENV: 'production',
        JEJU_NETWORK: 'localnet',
        RPC_URL: rpcUrl,
        WORKER_REGISTRY_ADDRESS: dwsContracts.workerRegistry,
        STORAGE_MANAGER_ADDRESS: dwsContracts.storageManager,
        CDN_REGISTRY_ADDRESS: dwsContracts.cdnRegistry,
        JNS_REGISTRY_ADDRESS: dwsContracts.jnsRegistry,
        JNS_RESOLVER_ADDRESS: dwsContracts.jnsResolver,
        FARCASTER_HUB_URL: getFarcasterHubUrl(),
        // SQLit config for DWS workers (inherits to all workers via SAFE_ENV_KEYS)
        SQLIT_ENDPOINT: getSQLitBlockProducerUrl(),
        SQLIT_NODES: getSQLitBlockProducerUrl(),
        SQLIT_URL: getSQLitBlockProducerUrl(),
        SQLIT_DATABASE_ID: process.env.SQLIT_DATABASE_ID ?? 'dws-localnet',
        // SQLit private key for local development
        SQLIT_PRIVATE_KEY: WELL_KNOWN_KEYS.dev[0].privateKey,
      },
      stdio: 'inherit',
    })

    runningServices.push({
      name: 'DWS',
      port: 4030,
      process: dwsProc,
    })

    await new Promise((r) => setTimeout(r, 5000))
    logger.success('DWS server running in production mode on port 4030')
  }

  // Start OAuth3 in production mode
  const oauth3Dir = join(rootDir, 'apps/oauth3')
  if (existsSync(oauth3Dir)) {
    const oauth3Proc = execa('bun', ['run', 'start'], {
      cwd: oauth3Dir,
      env: {
        ...process.env,
        PORT: '4200',
        NODE_ENV: 'production',
        RPC_URL: rpcUrl,
      },
      stdio: 'inherit',
    })

    runningServices.push({
      name: 'OAuth3',
      port: 4200,
      process: oauth3Proc,
    })

    await new Promise((r) => setTimeout(r, 1000))
    logger.success('OAuth3 gateway running on port 4200')
  }

  // Deploy apps to DWS
  const appsWithDirs = apps.map((app) => {
    const folderName = app._folderName || app.name
    const isVendor = app.type === 'vendor'
    const dir = isVendor
      ? join(rootDir, 'vendor', folderName)
      : join(rootDir, 'apps', folderName)
    return { dir, manifest: app }
  })

  // Deploy all apps (uploads to IPFS and registers in JNS)
  await localDeployOrchestrator.deployAllApps(appsWithDirs)

  // IMPORTANT: Production mode does NOT start app backends as local processes.
  // Backends are invoked through DWS workers via the `dws.worker` JNS record.
  logger.step('Backends will be invoked via DWS workers...')

  // Start JNS Gateway in production mode
  logger.step('Starting JNS Gateway...')
  const { startLocalJNSGateway } = await import('../lib/jns-gateway-local')
  await startLocalJNSGateway(
    rpcUrl,
    dwsContracts.jnsRegistry,
    4303,
    4180,
    rootDir,
    { preferLocalFrontends: false, preferLocalBackends: false },
  )

  logger.success('Production deployment complete')
  logger.info(
    'Apps are now accessible via JNS names at *.local.jejunetwork.org:8080',
  )
}

async function startLocalProxy(): Promise<void> {
  logger.step('Starting local domain proxy...')

  const { startProxy, isCaddyInstalled, ensureSudoAccess } = await import(
    '../lib/local-proxy'
  )

  const caddyInstalled = await isCaddyInstalled()
  if (!caddyInstalled) {
    logger.warn('Caddy not installed - local domains disabled')
    return
  }

  await ensureSudoAccess()
  const started = await startProxy()
  if (started) {
    proxyEnabled = true
    logger.success('Local proxy running')
  }
}

async function stopProduction(): Promise<void> {
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

    for (const service of runningServices) {
      if (service.process) {
        service.process.kill('SIGTERM')
      }
    }

    await execa('docker', ['compose', 'down'], {
      cwd: join(findMonorepoRoot(), 'packages/monitoring'),
      reject: false,
    }).catch(() => undefined)

    logger.success('Stopped')
    process.exit(0)
  }

  process.on('SIGINT', cleanup)
  process.on('SIGTERM', cleanup)
}

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
  deployedApps: AppManifest[],
): Promise<void> {
  console.clear()

  logger.header('LOCAL PRODUCTION READY')
  logger.info('Press Ctrl+C to stop\n')

  const { isPortForwardingActive } = await import('../lib/local-proxy')
  const portForwardingActive = await isPortForwardingActive()
  const displayPort = portForwardingActive ? 80 : 8080

  if (infrastructureService) {
    logger.subheader('Infrastructure')
    logger.table([
      {
        label: 'SQLit',
        value: getSQLitBlockProducerUrl(),
        status: 'ok' as const,
      },
      {
        label: 'IPFS',
        value: getIpfsGatewayUrl(),
        status: 'ok' as const,
      },
      { label: 'DWS', value: getDWSUrl(), status: 'ok' as const },
    ])
  }

  logger.subheader('Chain')
  const chainRows = [
    {
      label: 'L1 RPC',
      value: getL1RpcUrl(),
      status: 'ok' as const,
    },
    { label: 'L2 RPC', value: rpcUrl, status: 'ok' as const },
  ]
  if (proxyEnabled) {
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

  if (deployedApps.length > 0 || services.length > 0) {
    logger.subheader('Apps (Production)')

    for (const app of deployedApps) {
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
          label: `${displayName} (IPFS)`,
          value: localUrl,
          status: 'ok',
        },
      ])
    }

    for (const svc of services) {
      const alreadyShown = deployedApps.some(
        (app) => app.name.toLowerCase() === svc.name.toLowerCase(),
      )
      if (alreadyShown) continue

      const port = svc.port
      if (port) {
        const localhost = getLocalhostHost()
        logger.table([
          {
            label: svc.name,
            value: `http://${localhost}:${port}`,
            status: 'ok',
          },
        ])
      }
    }
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
