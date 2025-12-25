/** Services orchestrator for local development */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getFarcasterHubUrl } from '@jejunetwork/config'
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
  cql: boolean
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
  cql: DEFAULT_PORTS.cql,
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
    const response = await fetch(`http://127.0.0.1:${port}/health`, {
      signal: AbortSignal.timeout(1000),
    })
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

  constructor(rootDir: string, rpcUrl = 'http://localhost:6546') {
    this.rootDir = rootDir
    this.rpcUrl = rpcUrl
  }

  async startAll(config: Partial<ServiceConfig> = {}): Promise<void> {
    const enabledServices: ServiceConfig = {
      inference: config.inference ?? true,
      cql: config.cql ?? true,
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

    logger.step('Starting development services...')

    if (enabledServices.inference) await this.startInference()
    if (enabledServices.cql) await this.startCQL()
    if (enabledServices.oracle) await this.startOracle()
    if (enabledServices.indexer) await this.startIndexer()
    if (enabledServices.jns) await this.startJNS()
    if (enabledServices.storage) await this.startStorage()
    if (enabledServices.cron) await this.startCron()
    if (enabledServices.cvm) await this.startCVM()
    if (enabledServices.computeBridge) await this.startComputeBridge()
    if (enabledServices.git) await this.startGit()
    if (enabledServices.pkg) await this.startPkg()

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
        url: `http://localhost:${port}`,
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

  private async startCQL(): Promise<void> {
    const port = SERVICE_PORTS.cql

    if (await isPortInUse(port)) {
      logger.info(`CQL already running on port ${port}`)
      this.services.set('cql', {
        name: 'CQL',
        type: 'server',
        port,
        url: `http://localhost:${port}`,
        healthCheck: '/health',
      })
      return
    }

    const dbPath = join(this.rootDir, 'packages/db')
    const dataDir = join(this.rootDir, '.data/cql')

    if (!existsSync(dataDir)) {
      mkdirSync(dataDir, { recursive: true })
    }

    const proc = spawn(['bun', 'run', 'server'], {
      cwd: dbPath,
      stdout: 'inherit',
      stderr: 'inherit',
      env: {
        ...process.env,
        PORT: String(port),
        CQL_PORT: String(port),
        CQL_DATA_DIR: dataDir,
        RPC_URL: this.rpcUrl,
      },
    })

    this.services.set('cql', {
      name: 'CQL (CovenantSQL)',
      type: 'process',
      port,
      process: proc,
      url: `http://localhost:${port}`,
      healthCheck: '/health',
    })

    logger.success(`CQL database starting on port ${port} (decentralized SQL)`)
  }

  private async startOracle(): Promise<void> {
    const port = SERVICE_PORTS.oracle

    if (await isPortInUse(port)) {
      logger.info(`Oracle already running on port ${port}`)
      this.services.set('oracle', {
        name: 'Oracle',
        type: 'server',
        port,
        url: `http://localhost:${port}`,
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

    try {
      const result = await Bun.spawn(['docker', 'info'], {
        stdout: 'ignore',
        stderr: 'ignore',
      }).exited
      if (result !== 0) {
        logger.info('Docker not available, starting local indexer')
        await this.startLocalIndexer()
        return
      }
    } catch {
      logger.info('Docker not available, starting local indexer')
      await this.startLocalIndexer()
      return
    }

    const dbProc = spawn(['docker', 'compose', 'up', '-d', 'db'], {
      cwd: indexerPath,
      stdout: 'pipe',
      stderr: 'pipe',
    })

    await dbProc.exited

    // Start full indexer stack (processor, graphql, frontend, api)
    const proc = spawn(['bun', 'run', 'dev:full'], {
      cwd: indexerPath,
      stdout: 'inherit',
      stderr: 'inherit',
      env: {
        ...process.env,
        GQL_PORT: String(SERVICE_PORTS.indexer),
        REST_PORT: '4352',
        PORT: '4355',
        RPC_ETH_HTTP: this.rpcUrl,
        START_BLOCK: '0',
        CHAIN_ID: '31337',
      },
    })

    this.services.set('indexer', {
      name: 'Indexer (On-Chain)',
      type: 'process',
      port: SERVICE_PORTS.indexer,
      process: proc,
      url: `http://localhost:${SERVICE_PORTS.indexer}/graphql`,
      healthCheck: '/graphql',
    })

    logger.success(
      `Indexer starting on port ${SERVICE_PORTS.indexer} (indexing blockchain events)`,
    )
  }

  private async startLocalIndexer(): Promise<void> {
    const port = SERVICE_PORTS.indexer

    const indexerPath = join(this.rootDir, 'apps/indexer')

    if (existsSync(indexerPath)) {
      // Start full indexer stack (processor, graphql, frontend, api)
      const proc = spawn(['bun', 'run', 'dev:full'], {
        cwd: indexerPath,
        stdout: 'inherit',
        stderr: 'inherit',
        env: {
          ...process.env,
          GQL_PORT: String(port),
          REST_PORT: '4352',
          PORT: '4355',
          RPC_ETH_HTTP: this.rpcUrl,
          START_BLOCK: '0',
          CHAIN_ID: '31337',
          DATABASE_URL: `sqlite://${join(this.rootDir, '.data/indexer.db')}`,
        },
      })

      this.services.set('indexer', {
        name: 'Indexer (On-Chain)',
        type: 'process',
        port,
        process: proc,
        url: `http://localhost:${port}/graphql`,
        healthCheck: '/health',
      })

      logger.success(
        `Indexer starting on port ${port} (indexing blockchain events)`,
      )
      return
    }

    const server = Bun.serve({
      port,
      async fetch(req) {
        const url = new URL(req.url)

        if (url.pathname === '/health') {
          return Response.json({ status: 'ok', mode: 'rpc-direct' })
        }

        if (url.pathname === '/graphql') {
          if (req.method === 'GET') {
            return Response.json({ status: 'ok', mode: 'rpc-direct' })
          }
          return Response.json({
            data: {
              blocks: [],
              transactions: [],
              accounts: [],
              message:
                'Indexer running in RPC-direct mode. Deploy apps/indexer for full indexing.',
            },
          })
        }

        return Response.json({ error: 'Not found' }, { status: 404 })
      },
    })

    this.services.set('indexer', {
      name: 'Indexer (RPC Direct)',
      type: 'server',
      port,
      server: { stop: async () => server.stop() },
      url: `http://localhost:${port}/graphql`,
      healthCheck: '/health',
    })

    logger.info(
      `Indexer on port ${port} (RPC-direct mode - deploy apps/indexer for full indexing)`,
    )
  }

  private async startJNS(): Promise<void> {
    const port = SERVICE_PORTS.jns

    if (await isPortInUse(port)) {
      logger.info(`JNS already running on port ${port}`)
      this.services.set('jns', {
        name: 'JNS',
        type: 'server',
        port,
        url: `http://localhost:${port}`,
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
        url: `http://localhost:${port}`,
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
        url: `http://localhost:${port}`,
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
        url: `http://localhost:${port}`,
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
        url: `http://localhost:${port}`,
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
        url: `http://localhost:${port}`,
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
        url: `http://localhost:${port}`,
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

    for (const [name, service] of this.services) {
      if (!service.healthCheck || !service.url) continue

      const healthUrl = `${service.url}${service.healthCheck}`
      let ready = false

      while (Date.now() - startTime < maxWait && !ready) {
        try {
          const response = await fetch(healthUrl, {
            signal: AbortSignal.timeout(2000),
          })
          if (response.ok) {
            ready = true
          }
        } catch {
          await new Promise((r) => setTimeout(r, 500))
        }
      }

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
      'cql',
      'oracle',
      'indexer',
      'jns',
      'storage', // DWS is registered as 'storage'
    ]

    for (const key of mainServices) {
      const service = this.services.get(key)
      if (service) {
        logger.table([
          {
            label: service.name,
            value: service.url || 'running',
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

    const cql = this.services.get('cql')
    if (cql?.url) {
      env.CQL_BLOCK_PRODUCER_ENDPOINT = cql.url
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
