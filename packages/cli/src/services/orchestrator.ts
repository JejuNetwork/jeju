/** Services orchestrator for local development */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getFarcasterHubUrl, getLocalhostHost } from '@jejunetwork/config'
import { type Subprocess, spawn } from 'bun'
import {
  type Address,
  createPublicClient,
  encodePacked,
  type Hex,
  http,
  keccak256,
  toHex,
} from 'viem'
import { z } from 'zod'
import { logger } from '../lib/logger'
import {
  CoinGeckoPriceResponseSchema,
  PriceDataResponseSchema,
  validate,
} from '../schemas'
import { DEFAULT_PORTS } from '../types'
import { createInferenceServer, type LocalInferenceServer } from './inference'

const ContractAddressValueSchema: z.ZodType<string | Record<string, string>> =
  z.lazy(() => z.union([z.string(), z.record(z.string(), z.string())]))
const ContractAddressesSchema = z.record(z.string(), ContractAddressValueSchema)

export interface ServiceConfig {
  inference: boolean
  eqlite: boolean
  oracle: boolean
  indexer: boolean
  jns: boolean
  storage: boolean
  cron: boolean
  cvm: boolean
  computeBridge: boolean
  git: boolean
  pkg: boolean
}

export interface RunningService {
  name: string
  type: 'process' | 'server' | 'mock'
  port?: number
  process?: Subprocess
  server?: LocalInferenceServer | MockServer
  url?: string
  healthCheck?: string
}

interface MockServer {
  stop(): Promise<void>
}

const SERVICE_PORTS = {
  inference: DEFAULT_PORTS.inference,
  eqlite: DEFAULT_PORTS.eqlite,
  oracle: DEFAULT_PORTS.oracle,
  indexer: DEFAULT_PORTS.indexerGraphQL,
  jns: DEFAULT_PORTS.jns,
  storage: 4030, // DWS main port
  cron: DEFAULT_PORTS.cron,
  cvm: DEFAULT_PORTS.cvm,
  computeBridge: 4031, // DWS compute node port
  git: 4030, // Git is a DWS endpoint at /git
  pkg: 4030,
} as const

async function fetchRealPrices(): Promise<
  Record<string, { price: number; timestamp: number; source: string }>
> {
  const prices: Record<
    string,
    { price: number; timestamp: number; source: string }
  > = {}

  // Try CoinGecko first (free tier)
  try {
    const response = await fetch(
      'https://api.coingecko.com/api/v3/simple/price?ids=ethereum,bitcoin&vs_currencies=usd',
      { signal: AbortSignal.timeout(5000) },
    )
    if (response.ok) {
      const rawData = await response.json()
      const data = validate(
        rawData,
        CoinGeckoPriceResponseSchema,
        'CoinGecko price response',
      )
      if (data.ethereum?.usd) {
        prices['ETH/USD'] = {
          price: data.ethereum.usd,
          timestamp: Date.now(),
          source: 'coingecko',
        }
        prices['WETH/USD'] = {
          price: data.ethereum.usd,
          timestamp: Date.now(),
          source: 'coingecko',
        }
      }
      if (data.bitcoin?.usd) {
        prices['BTC/USD'] = {
          price: data.bitcoin.usd,
          timestamp: Date.now(),
          source: 'coingecko',
        }
        prices['WBTC/USD'] = {
          price: data.bitcoin.usd,
          timestamp: Date.now(),
          source: 'coingecko',
        }
      }
    }
  } catch {
    // API failed, use fallbacks
  }

  prices['USDC/USD'] = { price: 1.0, timestamp: Date.now(), source: 'static' }
  prices['DAI/USD'] = { price: 1.0, timestamp: Date.now(), source: 'static' }
  prices['JEJU/USD'] = { price: 1.25, timestamp: Date.now(), source: 'static' }

  if (!prices['ETH/USD']) {
    prices['ETH/USD'] = {
      price: 3500,
      timestamp: Date.now(),
      source: 'fallback',
    }
    prices['WETH/USD'] = {
      price: 3500,
      timestamp: Date.now(),
      source: 'fallback',
    }
  }
  if (!prices['BTC/USD']) {
    prices['BTC/USD'] = {
      price: 95000,
      timestamp: Date.now(),
      source: 'fallback',
    }
    prices['WBTC/USD'] = {
      price: 95000,
      timestamp: Date.now(),
      source: 'fallback',
    }
  }

  return prices
}

async function isPortInUse(port: number): Promise<boolean> {
  try {
    const response = await fetch(
      `http://${getLocalhostHost()}:${port}/health`,
      {
        signal: AbortSignal.timeout(1000),
      },
    )
    return response.ok
  } catch {
    try {
      const server = Bun.serve({ port, fetch: () => new Response('') })
      server.stop()
      return false
    } catch {
      return true
    }
  }
}

class ServicesOrchestrator {
  private services: Map<string, RunningService> = new Map()
  private rootDir: string
  private rpcUrl: string

  constructor(rootDir: string, rpcUrl?: string) {
    this.rootDir = rootDir
    this.rpcUrl = rpcUrl ?? `http://${getLocalhostHost()}:6546`
  }

  async startAll(config: Partial<ServiceConfig> = {}): Promise<void> {
    const enabledServices: ServiceConfig = {
      inference: config.inference ?? true,
      eqlite: config.eqlite ?? true,
      oracle: config.oracle ?? true,
      indexer: config.indexer ?? true,
      jns: config.jns ?? true,
      storage: config.storage ?? true, // DWS storage enabled by default
      cron: config.cron ?? true,
      cvm: config.cvm ?? false,
      computeBridge: config.computeBridge ?? true, // DWS compute enabled by default
      git: config.git ?? true,
      pkg: config.pkg ?? true,
    }

    logger.step('Starting development services in parallel...')

    // Phase 1: Start core services in parallel (inference, eqlite, oracle, storage/DWS)
    const phase1Tasks: Promise<void>[] = []
    if (enabledServices.inference) phase1Tasks.push(this.startInference())
    if (enabledServices.eqlite) phase1Tasks.push(this.startEQLite())
    if (enabledServices.oracle) phase1Tasks.push(this.startOracle())
    if (enabledServices.storage) phase1Tasks.push(this.startStorage())

    await Promise.all(phase1Tasks)

    // Wait for DWS to be ready before starting services that depend on it
    if (enabledServices.storage) {
      await this.waitForDWSReady()
    }

    // Phase 2: Start DWS-dependent services in parallel
    const phase2Tasks: Promise<void>[] = []
    if (enabledServices.indexer) phase2Tasks.push(this.startIndexer())
    if (enabledServices.jns) phase2Tasks.push(this.startJNS())
    if (enabledServices.cron) phase2Tasks.push(this.startCron())
    if (enabledServices.computeBridge)
      phase2Tasks.push(this.startComputeBridge())
    if (enabledServices.git) phase2Tasks.push(this.startGit())
    if (enabledServices.pkg) phase2Tasks.push(this.startPkg())
    if (enabledServices.cvm) phase2Tasks.push(this.startCVM())

    await Promise.all(phase2Tasks)

    await this.waitForServices()
    this.printStatus()
  }

  private async startInference(): Promise<void> {
    const port = SERVICE_PORTS.inference

    // Check if already running
    if (await isPortInUse(port)) {
      logger.info(`Inference already running on port ${port}`)
      this.services.set('inference', {
        name: 'Inference',
        type: 'server',
        port,
        url: `http://${getLocalhostHost()}:${port}`,
        healthCheck: '/health',
      })
      return
    }

    const server = createInferenceServer({ port })
    await server.start()

    this.services.set('inference', {
      name: 'Inference',
      type: 'server',
      port,
      server,
      url: `http://localhost:${port}`,
      healthCheck: '/health',
    })
  }

  private async startEQLite(): Promise<void> {
    const port = SERVICE_PORTS.eqlite

    if (await isPortInUse(port)) {
      // Check if EQLite is responding
      try {
        const response = await fetch(`http://localhost:${port}/v1/status`, {
          signal: AbortSignal.timeout(2000),
        })
        if (response.ok) {
          logger.info(`EQLite already running on port ${port}`)
          this.services.set('eqlite', {
            name: 'EQLite (EQLite)',
            type: 'server',
            port,
            url: `http://${getLocalhostHost()}:${port}`,
            healthCheck: '/v1/status',
          })
          return
        }
      } catch {
        // Port in use but not EQLite
      }
      logger.warn(`Port ${port} in use but not by EQLite`)
      return
    }

    // Start EQLite via Docker Compose
    const composeFile = join(
      this.rootDir,
      'packages/deployment/docker/eqlite-internal.compose.yaml',
    )

    if (!existsSync(composeFile)) {
      logger.error('EQLite compose file not found')
      logger.info(
        'Expected at: packages/deployment/docker/eqlite-internal.compose.yaml',
      )
      logger.info('Build with: cd packages/eqlite && make docker')
      return
    }

    logger.step('Starting EQLite cluster via Docker...')

    const proc = spawn(['docker', 'compose', '-f', composeFile, 'up', '-d'], {
      cwd: this.rootDir,
      stdout: 'inherit',
      stderr: 'inherit',
    })

    // Wait for cluster to be ready
    const startTime = Date.now()
    const timeout = 30000

    while (Date.now() - startTime < timeout) {
      await new Promise((resolve) => setTimeout(resolve, 1000))
      try {
        const response = await fetch(`http://localhost:${port}/v1/status`, {
          signal: AbortSignal.timeout(2000),
        })
        if (response.ok) {
          this.services.set('eqlite', {
            name: 'EQLite (EQLite)',
            type: 'process',
            port,
            process: proc,
            url: `http://${getLocalhostHost()}:${port}`,
            healthCheck: '/v1/status',
          })
          logger.success(`EQLite cluster running on port ${port}`)
          return
        }
      } catch {
        // Still starting
      }
    }

    logger.error('EQLite cluster failed to start within 30 seconds')
  }

  private async startOracle(): Promise<void> {
    const port = SERVICE_PORTS.oracle

    if (await isPortInUse(port)) {
      logger.info(`Oracle already running on port ${port}`)
      this.services.set('oracle', {
        name: 'Oracle',
        type: 'server',
        port,
        url: `http://${getLocalhostHost()}:${port}`,
        healthCheck: '/health',
      })
      return
    }

    const contracts = this.loadContractAddresses()
    const rpcUrl = this.rpcUrl
    const priceOracleAddress =
      typeof contracts.priceOracle === 'string' ? contracts.priceOracle : ''

    const server = await this.createOnChainOracle(
      port,
      rpcUrl,
      priceOracleAddress,
    )
    this.services.set('oracle', {
      name: 'Oracle (On-Chain)',
      type: 'server',
      port,
      server,
      url: `http://localhost:${port}`,
      healthCheck: '/health',
    })

    logger.success(
      `Oracle node on port ${port} (reading from on-chain PriceOracle)`,
    )
  }

  private async createOnChainOracle(
    port: number,
    rpcUrl: string,
    priceOracleAddress: string,
  ): Promise<MockServer> {
    const priceOracleAbi = [
      'function getPrice(address token) external view returns (uint256 price, uint256 decimals)',
      'function setPrice(address token, uint256 price, uint256 decimals) external',
    ]

    const tokenPairs: Record<string, string> = {
      'ETH/USD': '0x0000000000000000000000000000000000000000',
      'WETH/USD': '0x4200000000000000000000000000000000000006',
    }

    const server = Bun.serve({
      port,
      async fetch(req) {
        const url = new URL(req.url)

        if (url.pathname === '/health') {
          return Response.json({
            status: 'ok',
            mode: 'on-chain',
            rpcUrl,
            priceOracle: priceOracleAddress || 'not-deployed',
            supportedPairs: Object.keys(tokenPairs),
          })
        }

        if (url.pathname === '/api/v1/prices') {
          const pair = url.searchParams.get('pair')

          if (!priceOracleAddress) {
            const prices = await fetchRealPrices()
            if (pair && prices[pair]) {
              return Response.json(prices[pair])
            }
            return Response.json(prices)
          }

          const client = createPublicClient({ transport: http(rpcUrl) })

          const allPrices: Record<string, object> = {}
          for (const [pairName, tokenAddress] of Object.entries(tokenPairs)) {
            if (pair && pairName !== pair) continue

            const [price, decimals] = (await client
              .readContract({
                address: priceOracleAddress as `0x${string}`,
                abi: priceOracleAbi,
                functionName: 'getPrice',
                args: [tokenAddress as `0x${string}`],
              })
              .catch(() => [0n, 18n] as const)) as readonly [bigint, bigint]

            allPrices[pairName] = {
              price: Number(price) / 10 ** Number(decimals),
              priceRaw: price.toString(),
              decimals: Number(decimals),
              timestamp: Date.now(),
              source: 'on-chain-oracle',
            }
          }

          if (pair) {
            return allPrices[pair]
              ? Response.json(allPrices[pair])
              : Response.json({ error: 'Pair not found' }, { status: 404 })
          }
          return Response.json(allPrices)
        }

        if (url.pathname === '/api/v1/price') {
          const base = url.searchParams.get('base') || 'ETH'
          const quote = url.searchParams.get('quote') || 'USD'
          const pair = `${base}/${quote}`

          const response = await fetch(
            `http://localhost:${port}/api/v1/prices?pair=${encodeURIComponent(pair)}`,
          )
          return response
        }

        if (url.pathname === '/api/v1/latestRoundData') {
          const pair = url.searchParams.get('pair') || 'ETH/USD'
          const response = await fetch(
            `http://localhost:${port}/api/v1/prices?pair=${encodeURIComponent(pair)}`,
          )
          const rawData = await response.json()
          const data = validate(
            rawData,
            PriceDataResponseSchema,
            'price data response',
          )

          if (data.price) {
            return Response.json({
              roundId: BigInt(Date.now()).toString(),
              answer:
                data.priceRaw ||
                BigInt(Math.round(data.price * 1e8)).toString(),
              startedAt: Math.floor(Date.now() / 1000),
              updatedAt: Math.floor(Date.now() / 1000),
              answeredInRound: BigInt(Date.now()).toString(),
            })
          }
          return Response.json({ error: 'Pair not found' }, { status: 404 })
        }

        if (url.pathname === '/metrics') {
          const metrics = [
            '# HELP oracle_price_updates_total Total price updates',
            '# TYPE oracle_price_updates_total counter',
            'oracle_price_updates_total 1000',
            '# HELP oracle_last_update_timestamp Last price update timestamp',
            '# TYPE oracle_last_update_timestamp gauge',
            `oracle_last_update_timestamp ${Date.now()}`,
          ].join('\n')
          return new Response(metrics, {
            headers: { 'Content-Type': 'text/plain' },
          })
        }

        return Response.json({ error: 'Not found' }, { status: 404 })
      },
    })

    return {
      stop: async () => server.stop(),
    }
  }

  private loadContractAddresses(): Record<
    string,
    string | Record<string, string>
  > {
    const paths = [
      join(
        this.rootDir,
        'packages/contracts/deployments/localnet-complete.json',
      ),
      join(
        this.rootDir,
        'packages/contracts/deployments/localnet-addresses.json',
      ),
      join(this.rootDir, '.env.localnet'),
    ]

    for (const path of paths) {
      if (existsSync(path)) {
        if (path.endsWith('.json')) {
          const rawData = JSON.parse(readFileSync(path, 'utf-8'))
          const contracts = rawData.contracts ?? rawData
          if (typeof contracts === 'object' && contracts !== null) {
            const validated = validate(
              contracts,
              ContractAddressesSchema,
              `contract addresses at ${path}`,
            )
            return validated as Record<string, string | Record<string, string>>
          }
          return {} as Record<string, string | Record<string, string>>
        } else {
          const content = readFileSync(path, 'utf-8')
          const contracts: Record<string, string> = {}
          for (const line of content.split('\n')) {
            const match = line.match(/^([A-Z_]+)="?([^"]+)"?$/)
            if (match) {
              // Convert ENV_VAR_NAME to camelCase key
              const key = match[1]
                .toLowerCase()
                .replace(/_([a-z])/g, (_: string, c: string) => c.toUpperCase())
              contracts[key] = match[2]
            }
          }
          return contracts
        }
      }
    }

    return {}
  }

  private async startIndexer(): Promise<void> {
    const indexerPath = join(this.rootDir, 'apps/indexer')
    if (!existsSync(indexerPath)) {
      logger.warn('Indexer not found, skipping')
      return
    }

    // Check if Docker is available
    const dockerAvailable = await this.isDockerAvailable()
    if (!dockerAvailable) {
      logger.info('Docker not available, starting EQLite-only indexer')
      await this.startEQLiteOnlyIndexer()
      return
    }

    // Provision postgres container - with retries and proper wait
    const dbReady = await this.provisionPostgresWithRetry(3)
    if (!dbReady) {
      logger.warn(
        'Failed to provision PostgreSQL after retries, starting EQLite-only indexer',
      )
      await this.startEQLiteOnlyIndexer()
      return
    }

    // Verify we can actually connect to the database before starting indexer
    const connectionVerified = await this.verifyPostgresConnection()
    if (!connectionVerified) {
      logger.warn(
        'PostgreSQL connection verification failed, starting EQLite-only indexer',
      )
      await this.startEQLiteOnlyIndexer()
      return
    }

    // Run migrations to ensure schema exists before starting API servers
    const migrationsApplied = await this.applyIndexerMigrations(indexerPath)
    if (!migrationsApplied) {
      logger.warn('Failed to apply migrations, continuing anyway...')
    }

    // Start full indexer stack (processor, graphql, frontend, api)
    const proc = spawn(['bun', 'run', 'dev:full'], {
      cwd: indexerPath,
      stdout: 'inherit',
      stderr: 'inherit',
      env: {
        ...process.env,
        DB_HOST: 'localhost',
        DB_PORT: '23798',
        DB_NAME: 'indexer',
        DB_USER: 'postgres',
        DB_PASS: 'postgres',
        GQL_PORT: String(SERVICE_PORTS.indexer),
        REST_PORT: '4352',
        PORT: '4355',
        RPC_ETH_HTTP: this.rpcUrl,
        START_BLOCK: '0',
        CHAIN_ID: '31337',
        JEJU_NETWORK: 'localnet',
        NODE_ENV: 'development',
        // Enable EQLite sync for decentralized reads
        EQLITE_SYNC_ENABLED: this.services.has('eqlite') ? 'true' : 'false',
        EQLITE_DATABASE_ID: 'indexer-sync',
        EQLITE_SYNC_INTERVAL: '30000',
      },
    })

    this.services.set('indexer', {
      name: 'Indexer (On-Chain)',
      type: 'process',
      port: SERVICE_PORTS.indexer,
      process: proc,
      url: `http://localhost:${SERVICE_PORTS.indexer}`,
      healthCheck: '/graphql',
    })

    // Wait for the indexer to be ready before reporting success
    const indexerReady = await this.waitForIndexerHealth()
    if (indexerReady) {
      logger.success(
        `Indexer running on port ${SERVICE_PORTS.indexer} (indexing blockchain events)`,
      )
    } else {
      logger.warn(
        `Indexer may not be fully ready on port ${SERVICE_PORTS.indexer}`,
      )
    }
  }

  private async waitForIndexerHealth(): Promise<boolean> {
    const healthUrl = `http://localhost:${SERVICE_PORTS.indexer}/graphql`
    const maxAttempts = 30 // 30 seconds timeout

    for (let i = 0; i < maxAttempts; i++) {
      try {
        const response = await fetch(healthUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ query: '{ __typename }' }),
          signal: AbortSignal.timeout(2000),
        })
        if (response.ok) {
          return true
        }
      } catch {
        // Indexer not ready yet
      }
      await new Promise((r) => setTimeout(r, 1000))
      if (i > 0 && i % 5 === 0) {
        logger.debug(`  Waiting for indexer... (${i}s)`)
      }
    }
    return false
  }

  private async provisionPostgresWithRetry(
    maxRetries: number,
  ): Promise<boolean> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      logger.step(
        `Provisioning PostgreSQL (attempt ${attempt}/${maxRetries})...`,
      )

      const result = await this.provisionPostgresContainer()
      if (result) {
        return true
      }

      if (attempt < maxRetries) {
        const backoffMs = Math.min(1000 * 2 ** (attempt - 1), 10000)
        logger.debug(`Retrying in ${backoffMs}ms...`)
        await new Promise((r) => setTimeout(r, backoffMs))
      }
    }

    return false
  }

  private async verifyPostgresConnection(): Promise<boolean> {
    const containerName = await this.findPostgresContainer()
    if (!containerName) {
      logger.debug('No PostgreSQL container found for connection verification')
      return false
    }

    logger.debug('Verifying PostgreSQL connection...')

    // Try to connect to the indexer database specifically
    for (let i = 0; i < 10; i++) {
      const result = await Bun.spawn(
        [
          'docker',
          'exec',
          containerName,
          'psql',
          '-U',
          'postgres',
          '-d',
          'indexer',
          '-c',
          'SELECT 1',
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      ).exited

      if (result === 0) {
        logger.success('PostgreSQL connection verified')
        return true
      }

      await new Promise((r) => setTimeout(r, 1000))
    }

    logger.error('Failed to verify PostgreSQL connection after 10 attempts')
    return false
  }

  private async applyIndexerMigrations(indexerPath: string): Promise<boolean> {
    logger.step('Applying indexer database migrations...')

    const dbEnv = {
      ...process.env,
      DB_HOST: 'localhost',
      DB_PORT: '23798',
      DB_NAME: 'indexer',
      DB_USER: 'postgres',
      DB_PASS: 'postgres',
    }

    // Check if migrations directory exists and has migrations
    const migrationsDir = join(indexerPath, 'db/migrations')
    const hasMigrations =
      existsSync(migrationsDir) &&
      (await Bun.spawn(['ls', migrationsDir], { stdout: 'pipe' })
        .exited.then(() => true)
        .catch(() => false))

    // Generate migrations if none exist
    if (!hasMigrations) {
      logger.debug('No migrations found, generating from schema...')

      // First build the project to ensure models are compiled
      const buildResult = await Bun.spawn(['bun', 'run', 'build'], {
        cwd: indexerPath,
        stdout: 'pipe',
        stderr: 'pipe',
        env: dbEnv,
      }).exited

      if (buildResult !== 0) {
        logger.warn('Build failed, trying migration anyway...')
      }

      // Generate migrations
      const genResult = await Bun.spawn(['bunx', 'sqd', 'migration:generate'], {
        cwd: indexerPath,
        stdout: 'pipe',
        stderr: 'pipe',
        env: dbEnv,
      }).exited

      if (genResult !== 0) {
        logger.debug(
          'Migration generation failed, will try direct TypeORM sync',
        )
      }
    }

    // Run sqd migration:apply to create tables
    const migrationProc = Bun.spawn(['bunx', 'sqd', 'migration:apply'], {
      cwd: indexerPath,
      stdout: 'pipe',
      stderr: 'pipe',
      env: dbEnv,
    })
    const migrationResult = await migrationProc.exited
    const migrationStderr = await new Response(migrationProc.stderr).text()

    if (migrationResult !== 0) {
      logger.warn(`Migration apply failed: ${migrationStderr.slice(0, 200)}`)
      logger.warn('Run manually: cd apps/indexer && bunx sqd migration:apply')
      return false
    }

    // Verify tables were created
    const containerName = await this.findPostgresContainer()
    if (containerName) {
      const checkResult = await Bun.spawn(
        [
          'docker',
          'exec',
          containerName,
          'psql',
          '-U',
          'postgres',
          '-d',
          'indexer',
          '-c',
          "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public'",
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      )
      const checkOutput = await new Response(checkResult.stdout).text()
      const tableCount = parseInt(checkOutput.match(/\d+/)?.[0] ?? '0', 10)
      if (tableCount > 50) {
        logger.success(`Migrations applied (${tableCount} tables)`)
        return true
      }
    }

    logger.success('Migrations applied')
    return true
  }

  private async findPostgresContainer(): Promise<string | null> {
    const containerNames = ['dws-postgres-indexer', 'squid-db-1']

    for (const name of containerNames) {
      const checkResult = await Bun.spawn(
        ['docker', 'ps', '-q', '-f', `name=${name}`],
        { stdout: 'pipe', stderr: 'pipe' },
      )
      const output = await new Response(checkResult.stdout).text()
      if (output.trim()) {
        return name
      }
    }

    return null
  }

  private async startEQLiteOnlyIndexer(): Promise<void> {
    const port = SERVICE_PORTS.indexer
    const indexerPath = join(this.rootDir, 'apps/indexer')

    // Check if EQLite is available for read-only mode
    const eqliteService = this.services.get('eqlite')
    const eqliteAvailable = eqliteService !== undefined

    if (!eqliteAvailable) {
      logger.warn('EQLite not available - indexer will run in mock mode')
    }

    if (existsSync(indexerPath)) {
      // Start indexer in EQLite-only mode (no PostgreSQL)
      const proc = spawn(['bun', 'run', 'api/api-server.ts'], {
        cwd: indexerPath,
        stdout: 'inherit',
        stderr: 'inherit',
        env: {
          ...process.env,
          GQL_PORT: String(port),
          REST_PORT: '4352',
          PORT: '4355',
          RPC_ETH_HTTP: this.rpcUrl,
          JEJU_NETWORK: 'localnet',
          NODE_ENV: 'development',
          // EQLite-only mode - no PostgreSQL
          INDEXER_MODE: 'eqlite-only',
          EQLITE_SYNC_ENABLED: 'false', // Don't sync, just read
          EQLITE_READ_ENABLED: eqliteAvailable ? 'true' : 'false',
          EQLITE_DATABASE_ID: 'indexer-sync',
        },
      })

      this.services.set('indexer', {
        name: 'Indexer (EQLite-only)',
        type: 'process',
        port,
        process: proc,
        url: `http://${getLocalhostHost()}:${port}`,
        healthCheck: '/health',
      })

      logger.success(
        `Indexer starting on port ${port} (EQLite-only mode${eqliteAvailable ? '' : ' - mock data'})`,
      )
      return
    }

    // Fallback to mock server if indexer app doesn't exist
    const server = Bun.serve({
      port,
      async fetch(req) {
        const url = new URL(req.url)

        if (url.pathname === '/health') {
          return Response.json({ status: 'ok', mode: 'mock' })
        }

        if (url.pathname === '/graphql') {
          if (req.method === 'GET') {
            return Response.json({ status: 'ok', mode: 'mock' })
          }
          return Response.json({
            data: {
              blocks: [],
              transactions: [],
              accounts: [],
              message:
                'Indexer running in mock mode. Install apps/indexer for full functionality.',
            },
          })
        }

        return Response.json({ error: 'Not found' }, { status: 404 })
      },
    })

    this.services.set('indexer', {
      name: 'Indexer (Mock)',
      type: 'server',
      port,
      server: { stop: async () => server.stop() },
      url: `http://localhost:${port}`,
      healthCheck: '/health',
    })

    logger.info(`Indexer mock server started on port ${port}`)
  }

  private async isDWSAvailable(): Promise<boolean> {
    try {
      const host = getLocalhostHost()
      const response = await fetch(`http://${host}:4030/services/health`, {
        signal: AbortSignal.timeout(2000),
      })
      return response.ok
    } catch {
      return false
    }
  }

  private async waitForDWSReady(maxWaitMs: number = 30000): Promise<boolean> {
    const startTime = Date.now()
    let attempts = 0

    while (Date.now() - startTime < maxWaitMs) {
      attempts++
      if (await this.isDWSAvailable()) {
        logger.debug(`DWS ready after ${attempts} attempts`)
        return true
      }
      await new Promise((r) => setTimeout(r, 500))
    }

    logger.warn('DWS did not become ready within timeout')
    return false
  }

  /**
   * Deploy an app through DWS using its jeju-manifest.json
   * This is the Heroku/EKS-like deployment experience
   */
  async deployAppViaDWS(appPath: string): Promise<{
    success: boolean
    services: Array<{
      type: string
      name: string
      status: string
      port?: number
    }>
    database?: { type: string; name: string; connectionString?: string }
    errors: string[]
  }> {
    const manifestPath = join(appPath, 'jeju-manifest.json')

    if (!existsSync(manifestPath)) {
      return {
        success: false,
        services: [],
        errors: [`No jeju-manifest.json found at ${appPath}`],
      }
    }

    const manifest = JSON.parse(readFileSync(manifestPath, 'utf-8'))

    // Wait for DWS to be ready
    const dwsReady = await this.waitForDWSReady(10000)
    if (!dwsReady) {
      return {
        success: false,
        services: [],
        errors: ['DWS server not available'],
      }
    }

    logger.step(`Deploying ${manifest.name} via DWS...`)

    try {
      const host = getLocalhostHost()
      const response = await fetch(`http://${host}:4030/deploy`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ manifest }),
        signal: AbortSignal.timeout(60000),
      })

      if (!response.ok) {
        const error = await response.text()
        return {
          success: false,
          services: [],
          errors: [`DWS deployment failed: ${error}`],
        }
      }

      const result = (await response.json()) as {
        appName: string
        status: 'success' | 'partial' | 'failed'
        services: Array<{
          type: string
          name: string
          status: string
          port?: number
        }>
        database?: { type: string; name: string; connectionString?: string }
        tee?: { enabled: boolean; platform: string }
        errors: string[]
      }

      if (result.status === 'success') {
        logger.success(`${manifest.name} deployed successfully via DWS`)
        if (result.tee?.enabled) {
          logger.info(`TEE enabled: ${result.tee.platform}`)
        }
      } else if (result.status === 'partial') {
        logger.warn(
          `${manifest.name} partially deployed: ${result.errors.join(', ')}`,
        )
      } else {
        logger.error(
          `${manifest.name} deployment failed: ${result.errors.join(', ')}`,
        )
      }

      return {
        success: result.status !== 'failed',
        services: result.services,
        database: result.database,
        errors: result.errors,
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      return {
        success: false,
        services: [],
        errors: [`DWS deployment error: ${message}`],
      }
    }
  }

  /**
   * Get TEE status from DWS
   */
  async getTEEStatus(): Promise<{
    available: boolean
    platform: string
    mode: string
  }> {
    try {
      const host = getLocalhostHost()
      const response = await fetch(`http://${host}:4030/deploy/tee/status`, {
        signal: AbortSignal.timeout(5000),
      })

      if (!response.ok) {
        return { available: false, platform: 'none', mode: 'unavailable' }
      }

      return (await response.json()) as {
        available: boolean
        platform: string
        mode: string
      }
    } catch {
      return { available: false, platform: 'none', mode: 'unavailable' }
    }
  }

  private async isDockerAvailable(): Promise<boolean> {
    try {
      const result = await Bun.spawn(['docker', 'info'], {
        stdout: 'ignore',
        stderr: 'ignore',
      }).exited
      return result === 0
    } catch {
      return false
    }
  }

  private async provisionPostgresContainer(): Promise<boolean> {
    // First check if postgres is already running (reuse existing)
    const existingContainer = await this.findPostgresContainer()
    if (existingContainer) {
      const healthy = await this.isPostgresHealthy(existingContainer)
      if (healthy) {
        logger.debug('Existing PostgreSQL container is healthy')
        await this.ensureIndexerDatabaseDirect()
        return true
      }
    }

    // All provisioning MUST go through DWS interfaces for decentralized experience
    // DWS handles Docker locally, k8s in production
    if (await this.isDWSAvailable()) {
      const result = await this.provisionPostgresViaDWS()
      if (result) return true
      logger.warn('DWS provisioning failed - check DWS server logs')
    } else {
      // If DWS is not running, use direct Docker provisioning
      // This ensures local dev works even without DWS server running
      logger.info('DWS not available, provisioning directly via Docker')
      return this.provisionPostgresDirect()
    }

    // If DWS was available but provisioning failed, try direct fallback
    // This handles edge cases during local development
    logger.debug('Attempting direct Docker provisioning as fallback...')
    return this.provisionPostgresDirect()
  }

  private async isPostgresHealthy(containerName: string): Promise<boolean> {
    const result = await Bun.spawn(
      ['docker', 'exec', containerName, 'pg_isready', '-U', 'postgres'],
      { stdout: 'pipe', stderr: 'pipe' },
    ).exited
    return result === 0
  }

  private async provisionPostgresViaDWS(): Promise<boolean> {
    const host = getLocalhostHost()
    const dwsUrl = `http://${host}:4030`

    logger.step('Provisioning postgres via DWS services...')

    try {
      // Provision postgres service via DWS
      const provisionResponse = await fetch(`${dwsUrl}/services/provision`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          type: 'postgres',
          name: 'indexer',
          version: '15',
          resources: {
            cpuCores: 1,
            memoryMb: 512,
            storageMb: 5120,
          },
          ports: [{ container: 5432, host: 23798 }],
          env: {
            POSTGRES_PASSWORD: 'postgres',
            POSTGRES_DB: 'squid',
          },
        }),
      })

      if (!provisionResponse.ok) {
        const error = await provisionResponse.text()
        logger.error(`DWS postgres provisioning failed: ${error}`)
        return false
      }

      const service = (await provisionResponse.json()) as {
        id: string
        status: string
        healthStatus: string
        ports: { container: number; host: number }[]
      }

      if (service.status !== 'running' || service.healthStatus !== 'healthy') {
        logger.error(
          `Postgres service not healthy: ${service.status}/${service.healthStatus}`,
        )
        return false
      }

      logger.success('Postgres service provisioned via DWS')

      // Create indexer database via DWS
      const dbResponse = await fetch(
        `${dwsUrl}/services/${service.id}/databases`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ databaseName: 'indexer' }),
        },
      )

      if (!dbResponse.ok) {
        logger.warn('Failed to create indexer database via DWS API')
        // Try direct fallback
        await this.ensureIndexerDatabaseDirect()
      } else {
        logger.success('Indexer database created via DWS')
      }

      return true
    } catch (error) {
      logger.error(`DWS provisioning error: ${error}`)
      return false
    }
  }

  private async provisionPostgresDirect(): Promise<boolean> {
    const containerName = 'dws-postgres-indexer'
    const postgresPort = 23798

    // Check if container already exists and is running
    const existingResult = await Bun.spawn(
      ['docker', 'ps', '-q', '-f', `name=${containerName}`],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const existingOutput = await new Response(existingResult.stdout).text()

    if (existingOutput.trim()) {
      logger.debug('Postgres container already running')
      await this.ensureIndexerDatabaseDirect()
      return true
    }

    // Check if container exists but is stopped
    const stoppedResult = await Bun.spawn(
      ['docker', 'ps', '-aq', '-f', `name=${containerName}`],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const stoppedOutput = await new Response(stoppedResult.stdout).text()

    if (stoppedOutput.trim()) {
      logger.step('Starting existing postgres container...')
      const startResult = await Bun.spawn(['docker', 'start', containerName], {
        stdout: 'pipe',
        stderr: 'pipe',
      }).exited
      if (startResult !== 0) {
        logger.error('Failed to start postgres container')
        return false
      }
    } else {
      logger.step('Provisioning postgres container...')
      const createResult = await Bun.spawn(
        [
          'docker',
          'run',
          '-d',
          '--name',
          containerName,
          '-e',
          'POSTGRES_PASSWORD=postgres',
          '-e',
          'POSTGRES_DB=squid',
          '-p',
          `${postgresPort}:5432`,
          '--shm-size=256m',
          '--memory=512m',
          '--cpus=1',
          'postgres:15',
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      ).exited

      if (createResult !== 0) {
        logger.error('Failed to create postgres container')
        return false
      }
    }

    // Wait for postgres to be ready
    logger.debug('Waiting for postgres to be ready...')
    for (let i = 0; i < 30; i++) {
      const healthResult = await Bun.spawn(
        ['docker', 'exec', containerName, 'pg_isready', '-U', 'postgres'],
        { stdout: 'pipe', stderr: 'pipe' },
      ).exited

      if (healthResult === 0) {
        logger.success('Postgres container ready')
        await this.ensureIndexerDatabaseDirect()
        return true
      }
      await new Promise((r) => setTimeout(r, 1000))
    }

    logger.error('Postgres failed to become ready within 30 seconds')
    return false
  }

  private async ensureIndexerDatabaseDirect(): Promise<void> {
    // Try both container names (legacy and new)
    const containerNames = ['dws-postgres-indexer', 'squid-db-1']
    let containerName: string | null = null

    for (const name of containerNames) {
      const checkResult = await Bun.spawn(
        ['docker', 'ps', '-q', '-f', `name=${name}`],
        { stdout: 'pipe', stderr: 'pipe' },
      )
      const output = await new Response(checkResult.stdout).text()
      if (output.trim()) {
        containerName = name
        break
      }
    }

    if (!containerName) {
      logger.warn('No postgres container found for database creation')
      return
    }

    // Check if indexer database exists
    const checkResult = await Bun.spawn(
      ['docker', 'exec', containerName, 'psql', '-U', 'postgres', '-lqt'],
      { stdout: 'pipe', stderr: 'pipe' },
    )
    const databases = await new Response(checkResult.stdout).text()

    if (!databases.includes('indexer')) {
      logger.step('Creating indexer database...')
      const createResult = await Bun.spawn(
        [
          'docker',
          'exec',
          containerName,
          'psql',
          '-U',
          'postgres',
          '-c',
          'CREATE DATABASE indexer;',
        ],
        { stdout: 'pipe', stderr: 'pipe' },
      ).exited

      if (createResult === 0) {
        logger.success('Indexer database created')
      } else {
        logger.warn('Failed to create indexer database (may already exist)')
      }
    } else {
      logger.debug('Indexer database already exists')
    }
  }

  private async startJNS(): Promise<void> {
    const port = SERVICE_PORTS.jns

    if (await isPortInUse(port)) {
      logger.info(`JNS already running on port ${port}`)
      this.services.set('jns', {
        name: 'JNS',
        type: 'server',
        port,
        url: `http://${getLocalhostHost()}:${port}`,
        healthCheck: '/health',
      })
      return
    }

    const server = await this.createOnChainJNS()
    this.services.set('jns', {
      name: 'JNS (On-Chain)',
      type: 'server',
      port,
      server,
      url: `http://localhost:${port}`,
      healthCheck: '/health',
    })
    logger.success(
      `JNS service on port ${port} (connected to on-chain contracts)`,
    )
  }

  private async createOnChainJNS(): Promise<MockServer> {
    const port = SERVICE_PORTS.jns
    const rpcUrl = this.rpcUrl
    const contracts = this.loadContractAddresses()

    const jns = typeof contracts.jns === 'object' ? contracts.jns : null
    const jnsRegistrar =
      (typeof contracts.jnsRegistrar === 'string'
        ? contracts.jnsRegistrar
        : null) ||
      jns?.registrar ||
      ''
    const jnsResolver =
      (typeof contracts.jnsResolver === 'string'
        ? contracts.jnsResolver
        : null) ||
      jns?.resolver ||
      ''
    const jnsRegistry =
      (typeof contracts.jnsRegistry === 'string'
        ? contracts.jnsRegistry
        : null) ||
      jns?.registry ||
      ''

    const registrarAbi = [
      'function register(string name, address owner, uint256 duration) external payable returns (bytes32)',
      'function renew(bytes32 node, uint256 duration) external payable',
      'function available(string name) external view returns (bool)',
      'function rentPrice(string name, uint256 duration) external view returns (uint256)',
    ]

    const resolverAbi = [
      'function addr(bytes32 node) external view returns (address)',
      'function name(bytes32 node) external view returns (string)',
      'function text(bytes32 node, string key) external view returns (string)',
      'function setAddr(bytes32 node, address addr) external',
      'function setText(bytes32 node, string key, string value) external',
    ]

    const namehash = (name: string): string => {
      let node =
        '0x0000000000000000000000000000000000000000000000000000000000000000' as `0x${string}`
      if (name) {
        const labels = name.split('.')
        for (let i = labels.length - 1; i >= 0; i--) {
          const labelHash = keccak256(toHex(labels[i]))
          node = keccak256(
            encodePacked(['bytes32', 'bytes32'], [node, labelHash]),
          )
        }
      }
      return node
    }

    const server = Bun.serve({
      port,
      async fetch(req) {
        const url = new URL(req.url)

        if (url.pathname === '/health') {
          return Response.json({
            status: 'ok',
            mode: 'on-chain',
            rpcUrl,
            contracts: {
              registrar: jnsRegistrar,
              resolver: jnsResolver,
              registry: jnsRegistry,
            },
          })
        }

        // Resolve name to address via on-chain resolver
        if (url.pathname === '/api/v1/resolve') {
          const name = url.searchParams.get('name')
          if (!name)
            return Response.json({ error: 'Name required' }, { status: 400 })

          const node = namehash(name)

          const client = createPublicClient({ transport: http(rpcUrl) })

          if (!jnsResolver) {
            return Response.json(
              { error: 'JNS resolver not deployed', name, isAvailable: true },
              { status: 404 },
            )
          }

          const address = await client
            .readContract({
              address: jnsResolver as Address,
              abi: resolverAbi,
              functionName: 'addr',
              args: [node as Hex],
            })
            .catch(() => null)

          if (
            !address ||
            address === '0x0000000000000000000000000000000000000000'
          ) {
            return Response.json(
              { error: 'Name not found', name, isAvailable: true },
              { status: 404 },
            )
          }

          return Response.json({
            name,
            node,
            address,
            resolver: jnsResolver,
            isAvailable: false,
          })
        }

        // Check availability via on-chain registrar
        if (url.pathname === '/api/v1/available') {
          const name = url.searchParams.get('name')
          if (!name)
            return Response.json({ error: 'Name required' }, { status: 400 })

          if (!jnsRegistrar) {
            return Response.json({
              name,
              available: true,
              message: 'JNS not deployed',
            })
          }

          const client = createPublicClient({ transport: http(rpcUrl) })

          const available = await client
            .readContract({
              address: jnsRegistrar as Address,
              abi: registrarAbi,
              functionName: 'available',
              args: [name.split('.')[0]], // Get label without TLD
            })
            .catch(() => true)

          return Response.json({ name, available })
        }

        // Get pricing from on-chain contract
        if (url.pathname === '/api/v1/price') {
          const name = url.searchParams.get('name') || ''
          const years = parseInt(url.searchParams.get('years') || '1', 10)

          if (!name)
            return Response.json({ error: 'Name required' }, { status: 400 })

          if (!jnsRegistrar) {
            // Fallback pricing if contract not deployed
            const label = name.split('.')[0]
            const len = label.length
            const pricePerYear = len <= 3 ? 100 : len <= 5 ? 50 : 10
            return Response.json({
              name,
              years,
              pricePerYear,
              total: pricePerYear * years,
              currency: 'JEJU',
              available: true,
              message: 'JNS not deployed - showing default pricing',
            })
          }

          const client = createPublicClient({ transport: http(rpcUrl) })
          const duration = BigInt(years * 365 * 24 * 60 * 60) // years in seconds

          const priceResult = await client
            .readContract({
              address: jnsRegistrar as Address,
              abi: registrarAbi,
              functionName: 'rentPrice',
              args: [name.split('.')[0], duration],
            })
            .catch(() => 0n)
          const price = priceResult as bigint

          const availableResult = await client
            .readContract({
              address: jnsRegistrar as Address,
              abi: registrarAbi,
              functionName: 'available',
              args: [name.split('.')[0]],
            })
            .catch(() => true)
          const available = availableResult as boolean

          return Response.json({
            name,
            years,
            price: price.toString(),
            priceWei: price.toString(),
            available,
            currency: 'JEJU',
          })
        }

        if (url.pathname === '/api/v1/names') {
          const owner = url.searchParams.get('owner')
          if (!owner || !jnsRegistry) {
            return Response.json({ names: [], total: 0 })
          }

          return Response.json({
            names: [],
            total: 0,
            message:
              'Full name listing requires indexer - use /api/v1/resolve for specific names',
          })
        }

        return Response.json({ error: 'Not found' }, { status: 404 })
      },
    })

    return {
      stop: async () => server.stop(),
    }
  }

  private async startStorage(): Promise<void> {
    const port = SERVICE_PORTS.storage

    if (await isPortInUse(port)) {
      logger.info(`DWS already running on port ${port}`)
      this.services.set('storage', {
        name: 'DWS',
        type: 'server',
        port,
        url: `http://${getLocalhostHost()}:${port}`,
        healthCheck: '/health',
      })
      return
    }

    const dwsPath = join(this.rootDir, 'apps/dws')

    if (!existsSync(dwsPath)) {
      logger.warn('DWS app not found, skipping storage')
      return
    }

    const contracts = this.loadContractAddresses()

    const getContractAddr = (key: string): string => {
      const val = contracts[key]
      return typeof val === 'string' ? val : ''
    }
    const proc = spawn(['bun', 'run', 'api/server/index.ts'], {
      cwd: dwsPath,
      stdout: 'inherit',
      stderr: 'inherit',
      env: {
        ...process.env,
        PORT: String(port),
        DWS_PORT: String(port),
        RPC_URL: this.rpcUrl,
        CHAIN_ID: '31337',
        JEJU_NETWORK: 'localnet',
        NODE_ENV: 'development',
        REPO_REGISTRY_ADDRESS: getContractAddr('repoRegistry'),
        PACKAGE_REGISTRY_ADDRESS: getContractAddr('packageRegistry'),
        TRIGGER_REGISTRY_ADDRESS: getContractAddr('triggerRegistry'),
        IDENTITY_REGISTRY_ADDRESS: getContractAddr('identityRegistry'),
        COMPUTE_REGISTRY_ADDRESS: getContractAddr('computeRegistry'),
        LEDGER_MANAGER_ADDRESS: getContractAddr('ledgerManager'),
        INFERENCE_SERVING_ADDRESS: getContractAddr('inferenceServing'),
        TEE_PROVIDER: 'local',
        DWS_PRIVATE_KEY:
          '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80',
      },
    })

    this.services.set('storage', {
      name: 'DWS (Decentralized Web Services)',
      type: 'process',
      port,
      process: proc,
      url: `http://localhost:${port}`,
      healthCheck: '/health',
    })

    logger.success(
      `DWS starting on port ${port} (storage, compute, git, pkg, ci - all on-chain)`,
    )
  }

  private async startCron(): Promise<void> {
    const port = SERVICE_PORTS.cron

    if (await isPortInUse(port)) {
      logger.info(`Cron already running on port ${port}`)
      this.services.set('cron', {
        name: 'Cron',
        type: 'server',
        port,
        url: `http://${getLocalhostHost()}:${port}`,
        healthCheck: '/health',
      })
      return
    }

    const dwsPort = SERVICE_PORTS.storage

    let retries = 20
    while (retries > 0) {
      if (await isPortInUse(dwsPort)) {
        this.services.set('cron', {
          name: 'Cron (via DWS CI)',
          type: 'server',
          port: dwsPort,
          url: `http://localhost:${dwsPort}/ci`,
          // No health check - DWS sub-route
        })
        logger.success(
          `Cron service available via DWS on port ${dwsPort} (CI workflow engine)`,
        )
        return
      }
      await new Promise((r) => setTimeout(r, 500))
      retries--
    }

    const contracts = this.loadContractAddresses()
    const rpcUrl = this.rpcUrl

    const server = Bun.serve({
      port,
      async fetch(req) {
        const url = new URL(req.url)

        if (url.pathname === '/health') {
          return Response.json({
            status: 'ok',
            mode: 'standalone',
            message:
              'Standalone cron - use DWS /ci routes for full functionality',
            rpcUrl,
            contracts: {
              triggerRegistry: contracts.triggerRegistry || 'not-deployed',
            },
          })
        }

        if (url.pathname === '/api/v1/jobs' && req.method === 'GET') {
          return Response.json({
            jobs: [],
            message: 'Use DWS /ci/workflows for job management',
          })
        }

        return Response.json(
          { error: 'Use DWS /ci routes for cron functionality' },
          { status: 404 },
        )
      },
    })

    this.services.set('cron', {
      name: 'Cron (Standalone)',
      type: 'server',
      port,
      server: { stop: async () => server.stop() },
      url: `http://localhost:${port}`,
      healthCheck: '/health',
    })

    logger.info(`Cron on port ${port} (standalone - DWS not available)`)
  }

  private async startCVM(): Promise<void> {
    const port = SERVICE_PORTS.cvm

    if (await isPortInUse(port)) {
      logger.info(`CVM already running on port ${port}`)
      this.services.set('cvm', {
        name: 'CVM',
        type: 'server',
        port,
        url: `http://${getLocalhostHost()}:${port}`,
        healthCheck: '/health',
      })
      return
    }

    const dstackPath = join(this.rootDir, 'vendor/dstack')
    const dwsPath = join(this.rootDir, 'apps/dws')

    if (existsSync(dstackPath)) {
      // Start real dstack simulator (TEE development mode)
      const proc = spawn(['bun', 'run', 'dev:simulator'], {
        cwd: dstackPath,
        stdout: 'inherit',
        stderr: 'inherit',
        env: {
          ...process.env,
          PORT: String(port),
          TEE_MODE: 'local', // Local TEE simulation
        },
      })

      this.services.set('cvm', {
        name: 'CVM (dstack TEE)',
        type: 'process',
        port,
        process: proc,
        url: `http://${getLocalhostHost()}:${port}`,
        healthCheck: '/health',
      })

      logger.success(
        `CVM service starting on port ${port} (dstack TEE simulator)`,
      )
    } else if (existsSync(dwsPath)) {
      // Use DWS containers as fallback
      const contracts = this.loadContractAddresses()
      const computeAddr =
        typeof contracts.computeRegistry === 'string'
          ? contracts.computeRegistry
          : ''
      const proc = spawn(['bun', 'run', 'src/containers/index.ts'], {
        cwd: dwsPath,
        stdout: 'inherit',
        stderr: 'inherit',
        env: {
          ...process.env,
          RPC_URL: this.rpcUrl,
          CVM_PORT: String(port),
          TEE_PROVIDER: 'local',
          COMPUTE_REGISTRY_ADDRESS: computeAddr,
        },
      })

      this.services.set('cvm', {
        name: 'CVM (DWS Containers)',
        type: 'process',
        port,
        process: proc,
        url: `http://${getLocalhostHost()}:${port}`,
        healthCheck: '/health',
      })

      logger.success(
        `CVM service starting on port ${port} (DWS containers - LOCAL TEE mode)`,
      )
    } else {
      logger.warn('Neither dstack nor DWS found, CVM service unavailable')
    }
  }

  private async startComputeBridge(): Promise<void> {
    const port = SERVICE_PORTS.computeBridge

    if (await isPortInUse(port)) {
      logger.info(`DWS Compute Node already running on port ${port}`)
      this.services.set('computeBridge', {
        name: 'DWS Compute',
        type: 'server',
        port,
        url: `http://${getLocalhostHost()}:${port}`,
        healthCheck: '/health',
      })
      return
    }

    const dwsPort = SERVICE_PORTS.storage

    let retries = 20
    while (retries > 0) {
      if (await isPortInUse(dwsPort)) {
        this.services.set('computeBridge', {
          name: 'DWS Compute (via DWS)',
          type: 'server',
          port: dwsPort,
          url: `http://localhost:${dwsPort}/compute`,
          // No health check - DWS sub-route
        })
        logger.success(
          `DWS Compute available via DWS on port ${dwsPort} (TEE LOCAL mode)`,
        )
        return
      }
      await new Promise((r) => setTimeout(r, 500))
      retries--
    }

    const contracts = this.loadContractAddresses()
    const rpcUrl = this.rpcUrl

    const server = Bun.serve({
      port,
      async fetch(req) {
        const url = new URL(req.url)

        if (url.pathname === '/health') {
          return Response.json({
            status: 'ok',
            mode: 'standalone',
            teeProvider: 'local',
            message:
              'Standalone compute - use DWS /compute routes for full functionality',
            rpcUrl,
            contracts: {
              computeRegistry: contracts.computeRegistry || 'not-deployed',
              inferenceServing: contracts.inferenceServing || 'not-deployed',
            },
          })
        }

        if (
          url.pathname === '/v1/chat/completions' ||
          url.pathname === '/chat/completions'
        ) {
          const inferencePort = SERVICE_PORTS.inference
          const response = await fetch(
            `http://localhost:${inferencePort}/v1/chat/completions`,
            {
              method: req.method,
              headers: req.headers,
              body: req.body,
            },
          )
          return response
        }

        return Response.json(
          { error: 'Use DWS /compute routes for full compute functionality' },
          { status: 404 },
        )
      },
    })

    this.services.set('computeBridge', {
      name: 'DWS Compute (Standalone)',
      type: 'server',
      port,
      server: { stop: async () => server.stop() },
      url: `http://localhost:${port}`,
      healthCheck: '/health',
    })

    logger.info(`DWS Compute on port ${port} (standalone - DWS not available)`)
  }

  /**
   * Register JejuGit as a DWS route (git.local.jejunetwork.org -> DWS:4030/git)
   * Git is part of DWS, not a separate service
   */
  private async startGit(): Promise<void> {
    const dwsPort = SERVICE_PORTS.storage

    // Git is always served by DWS - just register the route
    this.services.set('git', {
      name: 'JejuGit',
      type: 'server',
      port: dwsPort,
      url: `http://localhost:${dwsPort}/git`,
      // No health check - DWS sub-route
    })
  }

  /**
   * Register JejuPkg as a DWS route (pkg.local.jejunetwork.org -> DWS:4030/pkg)
   * Pkg is part of DWS, not a separate service
   */
  private async startPkg(): Promise<void> {
    const dwsPort = SERVICE_PORTS.storage

    // Pkg is always served by DWS - just register the route
    this.services.set('pkg', {
      name: 'JejuPkg',
      type: 'server',
      port: dwsPort,
      url: `http://localhost:${dwsPort}/pkg`,
      // No health check - DWS sub-route
    })
  }

  private async waitForServices(): Promise<void> {
    const maxWait = 30000
    const startTime = Date.now()

    // Wait for all services in parallel
    const healthChecks = Array.from(this.services.entries())
      .filter(([_, service]) => service.healthCheck && service.url)
      .map(async ([name, service]) => {
        const healthUrl = `${service.url}${service.healthCheck}`

        while (Date.now() - startTime < maxWait) {
          try {
            const response = await fetch(healthUrl, {
              signal: AbortSignal.timeout(2000),
            })
            if (response.ok) {
              return { name, ready: true }
            }
          } catch {
            // Service not ready yet
          }
          await new Promise((r) => setTimeout(r, 500))
        }

        return { name, ready: false }
      })

    const results = await Promise.all(healthChecks)
    for (const { name, ready } of results) {
      if (!ready) {
        logger.warn(`Service ${name} health check failed`)
      }
    }
  }

  printStatus(): void {
    logger.newline()
    logger.subheader('Development Services')

    // Only show main services, not DWS sub-routes (cron, computeBridge, git, pkg)
    const mainServices = [
      'inference',
      'eqlite',
      'oracle',
      'indexer',
      'jns',
      'storage', // DWS is registered as 'storage'
    ]

    for (const key of mainServices) {
      const service = this.services.get(key)
      if (service) {
        // For indexer, show the GraphQL endpoint for user-friendliness
        let displayUrl = service.url || 'running'
        if (key === 'indexer' && service.url) {
          displayUrl = `${service.url}/graphql`
        }
        logger.table([
          {
            label: service.name,
            value: displayUrl,
            status: 'ok',
          },
        ])
      }
    }
  }

  getServiceUrl(name: string): string | undefined {
    return this.services.get(name)?.url
  }

  async stopAll(): Promise<void> {
    logger.step('Stopping services...')

    for (const [name, service] of this.services) {
      try {
        if (service.type === 'process' && service.process) {
          service.process.kill()
        }
        if (
          (service.type === 'server' || service.type === 'mock') &&
          service.server
        ) {
          await service.server.stop()
        }
        logger.info(`Stopped ${name}`)
      } catch (error) {
        logger.warn(`Failed to stop ${name}: ${error}`)
      }
    }

    this.services.clear()
  }

  getRunningServices(): Map<string, RunningService> {
    return this.services
  }

  getEnvVars(): Record<string, string> {
    const env: Record<string, string> = {}

    const inference = this.services.get('inference')
    if (inference?.url) {
      env.JEJU_INFERENCE_URL = inference.url
      env.PUBLIC_JEJU_GATEWAY_URL = inference.url
    }

    const eqlite = this.services.get('eqlite')
    if (eqlite?.url) {
      env.EQLITE_BLOCK_PRODUCER_ENDPOINT = eqlite.url
    }

    const oracle = this.services.get('oracle')
    if (oracle?.url) {
      env.ORACLE_URL = oracle.url
    }

    const indexer = this.services.get('indexer')
    if (indexer?.url) {
      env.INDEXER_GRAPHQL_URL = indexer.url
    }

    const jns = this.services.get('jns')
    if (jns?.url) {
      env.JNS_API_URL = jns.url
    }

    const storage = this.services.get('storage')
    if (storage?.url) {
      env.JEJU_STORAGE_URL = storage.url
      env.DWS_URL = storage.url
      env.STORAGE_API_URL = `${storage.url}/storage`
      env.IPFS_GATEWAY = `${storage.url}/cdn`
    }

    const cron = this.services.get('cron')
    if (cron?.url) {
      env.CRON_SERVICE_URL = cron.url
    }

    const cvm = this.services.get('cvm')
    if (cvm?.url) {
      env.DSTACK_ENDPOINT = cvm.url
    }

    const computeBridge = this.services.get('computeBridge')
    if (computeBridge?.url) {
      env.COMPUTE_BRIDGE_URL = computeBridge.url
      env.JEJU_COMPUTE_BRIDGE_URL = computeBridge.url
      env.COMPUTE_MARKETPLACE_URL = computeBridge.url
    }

    const git = this.services.get('git')
    if (git?.url) {
      // Git is part of DWS, but expose both URLs for compatibility
      env.JEJUGIT_URL = git.url
      env.PUBLIC_JEJUGIT_URL = git.url
    }

    const pkg = this.services.get('pkg')
    if (pkg?.url) {
      // Pkg registry is part of DWS, but expose both URLs for compatibility
      env.JEJUPKG_URL = pkg.url
      env.PUBLIC_JEJUPKG_URL = pkg.url
      // For npm CLI configuration (backwards compatibility)
      env.npm_config_registry = pkg.url
    }

    // DWS provides both Git and Pkg registry - expose unified URL
    if (storage?.url) {
      env.DWS_GIT_URL = `${storage.url}/git`
      env.DWS_PKG_URL = `${storage.url}/pkg`
      // Backwards compatibility alias
      env.DWS_NPM_URL = `${storage.url}/pkg`
    }

    // Farcaster Hub URL from config (self-hosted for local development)
    env.FARCASTER_HUB_URL = getFarcasterHubUrl()

    return env
  }

  // Generate a .env.local file for apps
  generateEnvFile(outputPath: string): void {
    const envVars = this.getEnvVars()
    const content = Object.entries(envVars)
      .map(([key, value]) => `${key}=${value}`)
      .join('\n')

    mkdirSync(join(outputPath, '..'), { recursive: true })
    writeFileSync(outputPath, `${content}\n`)
    logger.info(`Generated env file: ${outputPath}`)
  }
}

export const createOrchestrator = (rootDir: string, rpcUrl?: string) =>
  new ServicesOrchestrator(rootDir, rpcUrl)
export { ServicesOrchestrator }
