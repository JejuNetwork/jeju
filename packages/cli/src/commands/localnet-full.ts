/**
 * Full localnet deployment command for beefy machine
 *
 * This command bootstraps the COMPLETE Jeju stack locally:
 * - L1 (Geth dev mode or Anvil)
 * - L2 (op-geth + op-node for OP Stack)
 * - SQLit distributed database cluster
 * - IPFS storage
 * - Solana (test validator)
 * - All DWS services
 * - Full node services (compute, storage, vpn, proxy, etc.)
 *
 * Designed for running on a beefy machine with:
 * - 32+ cores
 * - 64+ GB RAM
 * - 500+ GB SSD
 * - GPU optional (for compute)
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { CORE_PORTS, getLocalhostHost, INFRA_PORTS } from '@jejunetwork/config'
import { Command } from 'commander'
import { execa, type ResultPromise } from 'execa'
import { bootstrapContracts } from '../lib/chain'
import { logger } from '../lib/logger'
import { findMonorepoRoot } from '../lib/system'
import { discoverApps } from '../lib/testing'
import { createInfrastructureService } from '../services/infrastructure'
import {
  createLocalDeployOrchestrator,
  type LocalDeployOrchestrator,
} from '../services/local-deploy-orchestrator'
import { type AppManifest, WELL_KNOWN_KEYS } from '../types'

interface RunningProcess {
  name: string
  process: ResultPromise
  port?: number
}

interface FullStackConfig {
  enableL1: boolean
  enableL2: boolean
  enableSQLit: boolean
  enableSolana: boolean
  enableIPFS: boolean
  enableDWS: boolean
  enableNode: boolean
  enableCompute: boolean
  enableStorage: boolean
  enableVPN: boolean
  enableProxy: boolean
}

class FullLocalnetDeployment {
  private rootDir: string
  private config: FullStackConfig
  private processes: RunningProcess[] = []
  private isShuttingDown = false
  private localDeployOrchestrator: LocalDeployOrchestrator | null = null
  private dataDir: string

  constructor(rootDir: string, config: FullStackConfig) {
    this.rootDir = rootDir
    this.config = config
    this.dataDir = join(rootDir, 'data/localnet-full')
  }

  async start(): Promise<void> {
    logger.header('FULL LOCALNET DEPLOYMENT')
    logger.info('Starting complete Jeju stack for beefy machine\n')

    // Setup data directory
    this.ensureDataDir()

    // Setup signal handlers
    this.setupSignalHandlers()

    // Start infrastructure in order (some have dependencies)
    const l2RpcUrl = `http://${getLocalhostHost()}:${INFRA_PORTS.L2_RPC.DEFAULT}`

    // Phase 1: Core infrastructure (parallel)
    logger.subheader('Phase 1: Core Infrastructure')
    await this.startCoreInfrastructure()

    // Phase 2: Chains (sequential due to dependencies)
    logger.subheader('Phase 2: Blockchain Layer')
    if (this.config.enableL1) {
      await this.startL1()
    }
    if (this.config.enableL2) {
      await this.startL2()
    }
    if (this.config.enableSolana) {
      await this.startSolana()
    }

    // Phase 3: Bootstrap contracts
    logger.subheader('Phase 3: Smart Contracts')
    await this.bootstrapContracts(l2RpcUrl)

    // Phase 4: DWS and Services
    logger.subheader('Phase 4: DWS Services')
    if (this.config.enableDWS) {
      await this.startDWS(l2RpcUrl)
    }

    // Phase 5: Node services
    if (this.config.enableNode) {
      logger.subheader('Phase 5: Node Services')
      await this.startNodeServices()
    }

    // Phase 6: Deploy apps
    logger.subheader('Phase 6: Applications')
    await this.deployApps(l2RpcUrl)

    // Print ready status
    await this.printReady()

    // Keep alive
    await this.keepAlive()
  }

  private ensureDataDir(): void {
    const dirs = [
      this.dataDir,
      join(this.dataDir, 'l1'),
      join(this.dataDir, 'l2'),
      join(this.dataDir, 'sqlit'),
      join(this.dataDir, 'solana'),
      join(this.dataDir, 'ipfs'),
    ]
    for (const dir of dirs) {
      if (!existsSync(dir)) {
        mkdirSync(dir, { recursive: true })
      }
    }
  }

  private async startCoreInfrastructure(): Promise<void> {
    const infra = createInfrastructureService(this.rootDir)

    // Start SQLit and IPFS in parallel
    const tasks: Promise<void>[] = []

    if (this.config.enableSQLit) {
      tasks.push(
        (async () => {
          const success = await infra.startSQLit()
          if (!success) {
            throw new Error('Failed to start SQLit')
          }
        })(),
      )
    }

    if (this.config.enableIPFS) {
      tasks.push(
        (async () => {
          const dockerRunning = await infra.isDockerRunning()
          if (!dockerRunning) {
            const started = await infra.startDocker()
            if (!started) {
              throw new Error('Failed to start Docker')
            }
          }
          const success = await infra.startDockerServices()
          if (!success) {
            throw new Error('Failed to start Docker services')
          }
        })(),
      )
    }

    await Promise.all(tasks)
    logger.success('Core infrastructure ready')
  }

  private async startL1(): Promise<void> {
    logger.step('Starting L1 (Ethereum dev node)...')

    // Check for geth or anvil
    const hasGeth = await this.commandExists('geth')
    const hasAnvil = await this.commandExists('anvil')

    if (!hasGeth && !hasAnvil) {
      logger.error('No L1 client found. Install geth or anvil.')
      throw new Error('L1 client not found')
    }

    const l1Port = INFRA_PORTS.L1_RPC.DEFAULT
    const l1DataDir = join(this.dataDir, 'l1')

    if (hasGeth) {
      // Use geth in dev mode
      const proc = execa(
        'geth',
        [
          '--dev',
          '--dev.period',
          '1',
          '--http',
          '--http.addr',
          '0.0.0.0',
          '--http.port',
          String(l1Port),
          '--http.api',
          'eth,net,web3,debug,txpool',
          '--http.corsdomain',
          '*',
          '--ws',
          '--ws.addr',
          '0.0.0.0',
          '--ws.port',
          String(l1Port + 1),
          '--ws.api',
          'eth,net,web3,debug,txpool',
          '--ws.origins',
          '*',
          '--datadir',
          l1DataDir,
          '--verbosity',
          '2',
        ],
        {
          cwd: this.rootDir,
          stdio: 'pipe',
        },
      )

      this.processes.push({ name: 'L1 (geth)', process: proc, port: l1Port })
    } else {
      // Use anvil
      const proc = execa(
        'anvil',
        [
          '--port',
          String(l1Port),
          '--chain-id',
          '900',
          '--block-time',
          '1',
          '--host',
          '0.0.0.0',
        ],
        {
          cwd: this.rootDir,
          stdio: 'pipe',
        },
      )

      this.processes.push({ name: 'L1 (anvil)', process: proc, port: l1Port })
    }

    // Wait for L1 to be ready
    await this.waitForRpc(`http://${getLocalhostHost()}:${l1Port}`, 'L1')
    logger.success(`L1 running on port ${l1Port}`)
  }

  private async startL2(): Promise<void> {
    logger.step('Starting L2 (OP Stack)...')

    const l2Port = INFRA_PORTS.L2_RPC.DEFAULT
    const l2DataDir = join(this.dataDir, 'l2')

    // Check for op-geth
    const hasOpGeth = await this.commandExists('op-geth')
    const hasAnvil = await this.commandExists('anvil')

    if (hasOpGeth) {
      // Production-like OP Stack
      const proc = execa(
        'op-geth',
        [
          '--dev',
          '--http',
          '--http.addr',
          '0.0.0.0',
          '--http.port',
          String(l2Port),
          '--http.api',
          'eth,net,web3,debug,txpool,engine',
          '--http.corsdomain',
          '*',
          '--ws',
          '--ws.addr',
          '0.0.0.0',
          '--ws.port',
          String(l2Port + 1),
          '--ws.api',
          'eth,net,web3,debug,txpool,engine',
          '--ws.origins',
          '*',
          '--datadir',
          l2DataDir,
          '--verbosity',
          '2',
        ],
        {
          cwd: this.rootDir,
          stdio: 'pipe',
        },
      )

      this.processes.push({ name: 'L2 (op-geth)', process: proc, port: l2Port })
    } else if (hasAnvil) {
      // Fallback to anvil for L2
      const proc = execa(
        'anvil',
        [
          '--port',
          String(l2Port),
          '--chain-id',
          '31337',
          '--block-time',
          '2',
          '--host',
          '0.0.0.0',
        ],
        {
          cwd: this.rootDir,
          stdio: 'pipe',
        },
      )

      this.processes.push({ name: 'L2 (anvil)', process: proc, port: l2Port })
    } else {
      throw new Error('No L2 client found. Install op-geth or anvil.')
    }

    // Wait for L2 to be ready
    await this.waitForRpc(`http://${getLocalhostHost()}:${l2Port}`, 'L2')
    logger.success(`L2 running on port ${l2Port}`)
  }

  private async startSolana(): Promise<void> {
    logger.step('Starting Solana (test validator)...')

    const hasSolana = await this.commandExists('solana-test-validator')
    if (!hasSolana) {
      logger.warn('Solana not installed, skipping')
      logger.info(
        '  Install: sh -c "$(curl -sSfL https://release.solana.com/stable/install)"',
      )
      return
    }

    const solanaPort = 8899
    const solanaDataDir = join(this.dataDir, 'solana')

    const proc = execa(
      'solana-test-validator',
      [
        '--ledger',
        solanaDataDir,
        '--rpc-port',
        String(solanaPort),
        '--bind-address',
        '0.0.0.0',
        '--quiet',
      ],
      {
        cwd: this.rootDir,
        stdio: 'pipe',
      },
    )

    this.processes.push({ name: 'Solana', process: proc, port: solanaPort })

    // Wait for Solana
    await this.waitForSolana(`http://${getLocalhostHost()}:${solanaPort}`)
    logger.success(`Solana running on port ${solanaPort}`)
  }

  private async bootstrapContracts(rpcUrl: string): Promise<void> {
    logger.step('Deploying core contracts...')

    await bootstrapContracts(this.rootDir, rpcUrl)

    // Deploy DWS contracts
    const deployerKey = WELL_KNOWN_KEYS.dev[0].privateKey as `0x${string}`
    this.localDeployOrchestrator = createLocalDeployOrchestrator(
      this.rootDir,
      rpcUrl,
      deployerKey,
    )

    let dwsContracts = this.localDeployOrchestrator.loadDWSContracts()
    if (!dwsContracts) {
      dwsContracts = await this.localDeployOrchestrator.deployDWSContracts()
    }

    // Save deployment info
    const deploymentPath = join(this.dataDir, 'deployment.json')
    writeFileSync(deploymentPath, JSON.stringify(dwsContracts, null, 2))

    logger.success('Contracts deployed')
  }

  private async startDWS(rpcUrl: string): Promise<void> {
    logger.step('Starting DWS services...')

    const dwsDir = join(this.rootDir, 'apps/dws')
    if (!existsSync(dwsDir)) {
      logger.warn('DWS app not found')
      return
    }

    const dwsContracts = this.localDeployOrchestrator?.loadDWSContracts()

    const proc = execa('bun', ['run', 'dev'], {
      cwd: dwsDir,
      env: {
        ...process.env,
        RPC_URL: rpcUrl,
        WORKER_REGISTRY_ADDRESS: dwsContracts?.workerRegistry,
        STORAGE_MANAGER_ADDRESS: dwsContracts?.storageManager,
        CDN_REGISTRY_ADDRESS: dwsContracts?.cdnRegistry,
        JNS_REGISTRY_ADDRESS: dwsContracts?.jnsRegistry,
        JNS_RESOLVER_ADDRESS: dwsContracts?.jnsResolver,
      },
      stdio: 'pipe',
    })

    this.processes.push({
      name: 'DWS',
      process: proc,
      port: CORE_PORTS.DWS_API.DEFAULT,
    })

    // Wait for DWS
    await this.sleep(5000)
    logger.success(`DWS running on port ${CORE_PORTS.DWS_API.DEFAULT}`)

    // Register local DWS node
    if (this.localDeployOrchestrator) {
      await this.localDeployOrchestrator.registerLocalNode()
    }
  }

  private async startNodeServices(): Promise<void> {
    logger.step('Starting node services...')

    const nodeDir = join(this.rootDir, 'apps/node')
    if (!existsSync(nodeDir)) {
      logger.warn('Node app not found')
      return
    }

    const args = ['run', 'src/daemon/index.ts', '--network', 'localnet']

    if (this.config.enableCompute) args.push('--compute')
    if (this.config.enableStorage) args.push('--storage')
    if (this.config.enableVPN) args.push('--vpn')
    if (this.config.enableProxy) args.push('--proxy')

    const proc = execa('bun', args, {
      cwd: nodeDir,
      env: {
        ...process.env,
        JEJU_NETWORK: 'localnet',
        KMS_KEY_ID: process.env.KMS_KEY_ID ?? 'local-dev-key',
      },
      stdio: 'pipe',
    })

    this.processes.push({ name: 'Node Services', process: proc })

    await this.sleep(3000)
    logger.success('Node services started')
  }

  private async deployApps(rpcUrl: string): Promise<void> {
    logger.step('Deploying applications...')

    const apps = discoverApps(this.rootDir, true)
    const appsToStart = apps.filter(
      (app: AppManifest) =>
        app.enabled !== false &&
        app.autoStart !== false &&
        app.name !== 'indexer' &&
        app.name !== 'monitoring',
    )

    if (!this.localDeployOrchestrator) {
      logger.warn('Cannot deploy apps - orchestrator not initialized')
      return
    }

    const appsWithDirs = appsToStart.map((app: AppManifest) => {
      const folderName = app._folderName ?? app.name
      const isVendor = app.type === 'vendor'
      const dir = isVendor
        ? join(this.rootDir, 'vendor', folderName)
        : join(this.rootDir, 'apps', folderName)
      return { dir, manifest: app }
    })

    await this.localDeployOrchestrator.deployAllApps(appsWithDirs)

    // Start JNS Gateway
    const { startLocalJNSGateway } = await import('../lib/jns-gateway-local')
    const dwsContracts = this.localDeployOrchestrator.loadDWSContracts()
    if (dwsContracts) {
      await startLocalJNSGateway(
        rpcUrl,
        dwsContracts.jnsRegistry,
        4303,
        4180,
        this.rootDir,
      )
    }

    logger.success(`Deployed ${appsWithDirs.length} applications`)
  }

  private async printReady(): Promise<void> {
    console.clear()

    logger.header('FULL LOCALNET READY')
    logger.info('Press Ctrl+C to stop\n')

    const localhost = getLocalhostHost()

    logger.subheader('Infrastructure')
    const infraRows: Array<{
      label: string
      value: string
      status: 'ok' | 'error'
    }> = []

    if (this.config.enableSQLit) {
      infraRows.push({
        label: 'SQLit',
        value: `http://${localhost}:${INFRA_PORTS.SQLit.DEFAULT}`,
        status: 'ok',
      })
    }
    if (this.config.enableIPFS) {
      infraRows.push({
        label: 'IPFS',
        value: `http://${localhost}:${CORE_PORTS.IPFS_API.DEFAULT}`,
        status: 'ok',
      })
    }
    if (this.config.enableDWS) {
      infraRows.push({
        label: 'DWS',
        value: `http://${localhost}:${CORE_PORTS.DWS_API.DEFAULT}`,
        status: 'ok',
      })
    }
    logger.table(infraRows)

    logger.subheader('Chains')
    const chainRows: Array<{
      label: string
      value: string
      status: 'ok' | 'error'
    }> = []
    if (this.config.enableL1) {
      chainRows.push({
        label: 'L1 RPC',
        value: `http://${localhost}:${INFRA_PORTS.L1_RPC.DEFAULT}`,
        status: 'ok',
      })
    }
    if (this.config.enableL2) {
      chainRows.push({
        label: 'L2 RPC',
        value: `http://${localhost}:${INFRA_PORTS.L2_RPC.DEFAULT}`,
        status: 'ok',
      })
    }
    if (this.config.enableSolana) {
      chainRows.push({
        label: 'Solana',
        value: `http://${localhost}:8899`,
        status: 'ok',
      })
    }
    logger.table(chainRows)

    logger.subheader('Running Processes')
    for (const proc of this.processes) {
      const port = proc.port ? `:${proc.port}` : ''
      logger.table([
        { label: proc.name, value: `running${port}`, status: 'ok' },
      ])
    }

    logger.subheader('Test Wallet')
    const deployer = WELL_KNOWN_KEYS.dev[0]
    logger.keyValue('Address', deployer.address)
    logger.keyValue('Key', `${deployer.privateKey.slice(0, 20)}...`)
    logger.warn('Well-known test key - DO NOT use on mainnet')
  }

  private setupSignalHandlers(): void {
    const cleanup = async () => {
      if (this.isShuttingDown) return
      this.isShuttingDown = true

      logger.newline()
      logger.step('Shutting down...')

      for (const proc of this.processes) {
        logger.info(`  Stopping ${proc.name}...`)
        proc.process.kill('SIGTERM')
      }

      // Stop infrastructure
      const infra = createInfrastructureService(this.rootDir)
      await infra.stopServices()
      await infra.stopLocalnet()

      logger.success('Shutdown complete')
      process.exit(0)
    }

    process.on('SIGINT', cleanup)
    process.on('SIGTERM', cleanup)
  }

  private async waitForRpc(url: string, name: string): Promise<void> {
    for (let i = 0; i < 60; i++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'eth_chainId',
            params: [],
            id: 1,
          }),
          signal: AbortSignal.timeout(2000),
        })
        if (response.ok) return
      } catch {
        // Keep trying
      }
      await this.sleep(1000)
    }
    throw new Error(`${name} failed to start within 60 seconds`)
  }

  private async waitForSolana(url: string): Promise<void> {
    for (let i = 0; i < 60; i++) {
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            jsonrpc: '2.0',
            method: 'getHealth',
            id: 1,
          }),
          signal: AbortSignal.timeout(2000),
        })
        if (response.ok) {
          const data = await response.json()
          if (data.result === 'ok') return
        }
      } catch {
        // Keep trying
      }
      await this.sleep(1000)
    }
    throw new Error('Solana failed to start within 60 seconds')
  }

  private async commandExists(cmd: string): Promise<boolean> {
    try {
      const { exitCode } = await execa('which', [cmd], { reject: false })
      return exitCode === 0
    } catch {
      return false
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }

  private async keepAlive(): Promise<void> {
    return new Promise(() => {
      // Never resolves - keeps process alive
    })
  }
}

export const localnetFullCommand = new Command('localnet-full')
  .description('Start full localnet deployment for beefy machine')
  .option('--no-l1', 'Skip L1 (use external)')
  .option('--no-l2', 'Skip L2 (use external)')
  .option('--no-sqlit', 'Skip SQLit')
  .option('--no-solana', 'Skip Solana')
  .option('--no-ipfs', 'Skip IPFS')
  .option('--no-dws', 'Skip DWS services')
  .option('--no-node', 'Skip node services')
  .option('--compute', 'Enable compute service')
  .option('--storage', 'Enable storage service')
  .option('--vpn', 'Enable VPN exit service')
  .option('--proxy', 'Enable residential proxy')
  .option('--all', 'Enable all node services')
  .action(async (options) => {
    const rootDir = findMonorepoRoot()

    const config: FullStackConfig = {
      enableL1: options.l1 !== false,
      enableL2: options.l2 !== false,
      enableSQLit: options.sqlit !== false,
      enableSolana: options.solana !== false,
      enableIPFS: options.ipfs !== false,
      enableDWS: options.dws !== false,
      enableNode: options.node !== false,
      enableCompute: options.all ?? options.compute ?? false,
      enableStorage: options.all ?? options.storage ?? false,
      enableVPN: options.all ?? options.vpn ?? false,
      enableProxy: options.all ?? options.proxy ?? false,
    }

    const deployment = new FullLocalnetDeployment(rootDir, config)
    await deployment.start()
  })
