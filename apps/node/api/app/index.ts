#!/usr/bin/env bun

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { createInterface } from 'node:readline'
import { parseArgs } from 'node:util'
import {
  getChainId,
  getCurrentNetwork,
  getEnvVar,
  getEQLiteMinerUrl,
  getEQLiteUrl,
  getRpcUrl,
} from '@jejunetwork/config'
import { expectAddress } from '@jejunetwork/types'
import chalk from 'chalk'
import { formatEther } from 'viem'
import { z } from 'zod'
import { JsonRpcResultResponseSchema } from '../../lib/validation'
import { configureNode } from '../config'
import { createSecureNodeClient } from '../lib/contracts'
import type { ServiceRequirements } from '../lib/hardware'
import {
  convertHardwareToCamelCase,
  convertHardwareToSnakeCase,
  detectHardware,
  meetsRequirements,
} from '../lib/hardware'
import { createSecureSigner, registerNodeWithKMS } from '../lib/secure-signer'
import { createNodeServices } from '../lib/services'

const CliAppConfigSchema = z.object({
  version: z.string().regex(/^\d+\.\d+\.\d+/, 'Version must be semver format'),
  network: z.enum(['mainnet', 'testnet', 'localnet']),
  rpcUrl: z.string().url(),
  chainId: z.number().int().positive(),
  /** KMS key ID for secure signing (no private key stored locally) */
  keyId: z.string().default(''),
  /** Wallet address derived from KMS-managed key */
  walletAddress: z
    .string()
    .regex(/^0x[a-fA-F0-9]{40}$/)
    .or(z.literal('')),
  services: z.object({
    compute: z.boolean(),
    storage: z.boolean(),
    oracle: z.boolean(),
    proxy: z.boolean(),
    cron: z.boolean(),
    rpc: z.boolean(),
    xlp: z.boolean(),
    solver: z.boolean(),
    sequencer: z.boolean(),
    database: z.boolean(),
  }),
  compute: z.object({
    type: z.enum(['cpu', 'gpu', 'both']),
    cpuCores: z.number().int().positive(),
    gpuIds: z.array(z.number().int().nonnegative()),
    pricePerHour: z
      .string()
      .regex(/^\d+(\.\d+)?$/, 'Price must be a valid number string'),
    acceptNonTee: z.boolean(),
  }),
  bots: z.object({
    enabled: z.boolean(),
    dexArb: z.boolean(),
    crossChainArb: z.boolean(),
    liquidation: z.boolean(),
  }),
  autoClaim: z.boolean(),
  autoStake: z.boolean(),
  logLevel: z.enum(['debug', 'info', 'warn', 'error']),
})

export type CliAppConfig = z.infer<typeof CliAppConfigSchema>

const DEFAULT_CONFIG: CliAppConfig = {
  version: '1.0.0',
  network: 'testnet',
  rpcUrl: getRpcUrl('testnet'),
  chainId: getChainId('testnet'),
  keyId: '', // KMS key ID - no private keys stored locally
  walletAddress: '',
  services: {
    compute: true,
    storage: false,
    oracle: false,
    proxy: true,
    cron: true,
    rpc: false,
    xlp: false,
    solver: false,
    sequencer: false,
    database: false,
  },
  compute: {
    type: 'cpu',
    cpuCores: 4,
    gpuIds: [],
    pricePerHour: '0.01',
    acceptNonTee: true,
  },
  bots: {
    enabled: false,
    dexArb: false,
    crossChainArb: false,
    liquidation: false,
  },
  autoClaim: true,
  autoStake: false,
  logLevel: 'info',
}

const SERVICE_REQUIREMENTS: Record<string, ServiceRequirements> = {
  compute: {
    minCpuCores: 2,
    minMemoryMb: 4096,
    minStorageGb: 50,
    requiresGpu: false,
    requiresTee: false,
  },
  storage: {
    minCpuCores: 4,
    minMemoryMb: 8192,
    minStorageGb: 500,
    requiresGpu: false,
    requiresTee: false,
  },
  oracle: {
    minCpuCores: 2,
    minMemoryMb: 4096,
    minStorageGb: 50,
    requiresGpu: false,
    requiresTee: false,
  },
  proxy: {
    minCpuCores: 2,
    minMemoryMb: 2048,
    minStorageGb: 20,
    requiresGpu: false,
    requiresTee: false,
  },
  cron: {
    minCpuCores: 1,
    minMemoryMb: 1024,
    minStorageGb: 10,
    requiresGpu: false,
    requiresTee: false,
  },
  database: {
    minCpuCores: 4,
    minMemoryMb: 8192,
    minStorageGb: 100,
    requiresGpu: false,
    requiresTee: false,
  },
}

function getConfigDir(): string {
  return join(homedir(), '.jeju-node')
}

function getConfigPath(): string {
  return join(getConfigDir(), 'config.json')
}

type Indexable<T> = T & Record<string, unknown>

function safeMergeConfig(
  base: CliAppConfig,
  parsed: Record<string, unknown>,
): CliAppConfig {
  const result: Indexable<CliAppConfig> = { ...base }
  const dangerousKeys = new Set(['__proto__', 'constructor', 'prototype'])

  function isNonArrayObject(val: unknown): val is Record<string, unknown> {
    return val !== null && typeof val === 'object' && !Array.isArray(val)
  }

  function safeAssign(
    target: Indexable<object>,
    source: Record<string, unknown>,
    allowedKeys: string[],
  ): void {
    for (const key of allowedKeys) {
      if (dangerousKeys.has(key)) continue
      if (!(key in source)) continue

      const sourceVal = source[key]
      const targetVal = target[key]

      if (isNonArrayObject(sourceVal) && isNonArrayObject(targetVal)) {
        // Both are objects - recurse safely
        safeAssign(targetVal, sourceVal, Object.keys(targetVal))
      } else {
        target[key] = sourceVal
      }
    }
  }

  safeAssign(result, parsed, Object.keys(base))
  return result
}

const RawConfigSchema = z.record(z.string(), z.unknown())

function loadConfig(): CliAppConfig {
  const configPath = getConfigPath()
  if (existsSync(configPath)) {
    const fileContent = readFileSync(configPath, 'utf-8')
    const rawResult = RawConfigSchema.safeParse(JSON.parse(fileContent))
    if (!rawResult.success) {
      console.error('Config file is not a valid JSON object, using defaults')
      return DEFAULT_CONFIG
    }
    const merged = safeMergeConfig(DEFAULT_CONFIG, rawResult.data)
    const result = CliAppConfigSchema.safeParse(merged)
    if (!result.success) {
      console.error(
        'Invalid config file, using defaults. Errors:',
        result.error.issues
          .map((i) => `${i.path.join('.')}: ${i.message}`)
          .join('; '),
      )
      return DEFAULT_CONFIG
    }
    return result.data
  }
  return DEFAULT_CONFIG
}

export function saveConfig(config: CliAppConfig): void {
  const configPath = getConfigPath()
  const configDir = dirname(configPath)
  if (!existsSync(configDir)) {
    mkdirSync(configDir, { recursive: true })
  }
  writeFileSync(configPath, JSON.stringify(config, null, 2))
}

function log(level: string, message: string): void {
  const timestamp = new Date().toISOString().slice(11, 19)
  const colors: Record<string, (s: string) => string> = {
    debug: chalk.gray,
    info: chalk.blue,
    warn: chalk.yellow,
    error: chalk.red,
    success: chalk.green,
  }
  const colorFn = colors[level]
  const levelLabel = colorFn
    ? colorFn(`[${level.toUpperCase()}]`)
    : `[${level.toUpperCase()}]`
  console.log(`${chalk.dim(timestamp)} ${levelLabel} ${message}`)
}

async function prompt(
  question: string,
  defaultValue?: string,
): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  return new Promise((resolve) => {
    const text =
      defaultValue !== undefined
        ? `${question} [${chalk.dim(defaultValue)}]: `
        : `${question}: `
    rl.question(text, (answer) => {
      rl.close()
      const trimmed = answer.trim()
      if (trimmed !== '') {
        resolve(trimmed)
      } else if (defaultValue !== undefined) {
        resolve(defaultValue)
      } else {
        resolve('')
      }
    })
  })
}

async function promptYesNo(
  question: string,
  defaultValue = true,
): Promise<boolean> {
  const answer = await prompt(`${question} ${defaultValue ? '[Y/n]' : '[y/N]'}`)
  if (!answer) return defaultValue
  return answer.toLowerCase().startsWith('y')
}

function printBanner() {
  console.log(
    chalk.cyan(`
   ╦╔═╗ ╦╦ ╦  ╔╗╔╔═╗╔╦╗╔═╗
   ║║╣  ║║ ║  ║║║║ ║ ║║║╣
  ╚╝╚═╝╚╝╚═╝  ╝╚╝╚═╝═╩╝╚═╝
`),
  )
  console.log(chalk.dim('  Run infrastructure. Earn rewards.\n'))
}

async function cmdSetup(): Promise<void> {
  console.log(chalk.bold('\n  Quick Setup\n'))

  const config = loadConfig()
  const hardwareRaw = detectHardware()
  const hardware = convertHardwareToSnakeCase(hardwareRaw)

  console.log(`  ${chalk.bold('Your Machine:')}`)
  console.log(`    CPU: ${hardware.cpu.cores_physical} cores`)
  console.log(`    RAM: ${(hardware.memory.total_mb / 1024).toFixed(0)} GB`)
  console.log(
    `    GPU: ${hardware.gpus.length > 0 ? hardware.gpus[0].name : 'None'}`,
  )
  console.log(
    `    Docker: ${hardware.docker.runtime_available ? 'Ready' : 'Not running'}\n`,
  )

  const networkInput = await prompt(
    '  Network (testnet/mainnet)',
    config.network,
  )
  if (
    networkInput !== 'testnet' &&
    networkInput !== 'mainnet' &&
    networkInput !== 'localnet'
  ) {
    throw new Error(
      `Invalid network: ${networkInput}. Must be 'testnet', 'mainnet', or 'localnet'`,
    )
  }
  config.network = networkInput
  config.rpcUrl = getRpcUrl(config.network)
  config.chainId =
    config.network === 'mainnet'
      ? 420690
      : config.network === 'testnet'
        ? 420691
        : 31337

  if (!config.keyId) {
    console.log(chalk.bold('\n  Wallet Setup (Secure KMS)'))
    console.log(
      chalk.dim(
        '    Your keys are managed by the network KMS using threshold signatures.',
      ),
    )
    console.log(chalk.dim('    No private keys are stored on this machine.\n'))

    const registerNew = await promptYesNo('  Register new node with KMS?', true)

    if (registerNew) {
      const hardwareCamel = convertHardwareToCamelCase(hardware)
      console.log(chalk.dim('    Registering with KMS...'))

      try {
        // Register node with KMS - this generates a threshold key
        // with shares distributed across MPC nodes
        const { keyId, address } = await registerNodeWithKMS(
          '0x0000000000000000000000000000000000000000', // Placeholder until on-chain registration
          {
            nodeId: crypto.randomUUID(),
            region: 'global',
            services: Object.entries(config.services)
              .filter(([_, v]) => v)
              .map(([k]) => k),
            teeCapable: hardwareCamel.tee.attestationAvailable,
            teePlatform: hardwareCamel.tee.vendor,
          },
        )

        config.keyId = keyId
        config.walletAddress = address
        console.log(chalk.green(`    ✓ Key ID: ${keyId.slice(0, 16)}...`))
        console.log(chalk.green(`    ✓ Address: ${address}`))
      } catch (e) {
        console.log(
          chalk.yellow(
            `    ⚠ KMS registration failed: ${e instanceof Error ? e.message : String(e)}`,
          ),
        )
        console.log(
          chalk.dim('    You can retry setup later or check KMS connectivity.'),
        )
      }
    } else {
      const existingKeyId = await prompt('  Enter existing KMS key ID')
      if (existingKeyId) {
        config.keyId = existingKeyId
        // Derive address from KMS
        try {
          const signer = createSecureSigner(existingKeyId)
          config.walletAddress = await signer.getAddress()
          console.log(chalk.green(`    ✓ Address: ${config.walletAddress}`))
        } catch (e) {
          console.log(
            chalk.yellow(
              `    ⚠ Could not derive address: ${e instanceof Error ? e.message : String(e)}`,
            ),
          )
        }
      }
    }
  }

  console.log(chalk.bold('\n  Services (what do you want to earn from?)'))
  config.services.compute = await promptYesNo(
    '    Compute (share CPU/GPU)',
    true,
  )
  config.services.proxy = await promptYesNo('    Proxy (share bandwidth)', true)
  config.services.storage = await promptYesNo('    Storage (share disk)', false)
  config.services.database = await promptYesNo(
    '    Database (EQLite miner/storage)',
    false,
  )

  console.log(chalk.bold('\n  Trading Bots (optional, 50/50 profit split)'))
  config.bots.enabled = await promptYesNo('    Enable trading bots?', false)

  saveConfig(config)
  console.log(chalk.green(`\n  ✓ Saved to ${getConfigPath()}`))
  console.log(chalk.bold('\n  Next: Run `jeju-node start` to begin earning\n'))
}

async function cmdStatus(): Promise<void> {
  const config = loadConfig()
  const hardwareRaw = detectHardware()
  const hardware = convertHardwareToSnakeCase(hardwareRaw)

  console.log(chalk.bold('\n  Node Status\n'))

  let connected = false
  let blockNum = 0
  try {
    const controller = new AbortController()
    const timeoutId = setTimeout(() => controller.abort(), 5000)
    const res = await fetch(config.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_blockNumber',
        params: [],
        id: 1,
      }),
      signal: controller.signal,
    })
    clearTimeout(timeoutId)
    const json: unknown = await res.json()
    const parsed = JsonRpcResultResponseSchema.safeParse(json)
    if (parsed.success && parsed.data.result) {
      connected = true
      blockNum = parseInt(parsed.data.result, 16)
    }
  } catch {}

  console.log(`  ${chalk.bold('Network')}`)
  console.log(
    `    ${config.network} ${connected ? chalk.green('● Connected') : chalk.red('● Disconnected')}`,
  )
  if (connected) console.log(`    Block ${blockNum.toLocaleString()}`)

  console.log(`\n  ${chalk.bold('Wallet (KMS Managed)')}`)
  if (config.keyId && config.walletAddress) {
    console.log(`    Key ID: ${config.keyId.slice(0, 16)}...`)
    console.log(
      `    Address: ${config.walletAddress.slice(0, 10)}...${config.walletAddress.slice(-8)}`,
    )
    if (connected) {
      const client = createSecureNodeClient(
        config.rpcUrl,
        config.chainId,
        config.keyId,
      )
      const walletAddr = expectAddress(
        config.walletAddress,
        'config.walletAddress',
      )
      const balance = await client.publicClient.getBalance({
        address: walletAddr,
      })
      console.log(`    Balance: ${formatEther(balance)} ETH`)
    }
  } else {
    console.log(chalk.yellow('    Not configured - run `jeju-node setup`'))
  }

  console.log(`\n  ${chalk.bold('Hardware')}`)
  console.log(`    CPU: ${hardware.cpu.cores_physical} cores`)
  console.log(`    RAM: ${(hardware.memory.total_mb / 1024).toFixed(1)} GB`)
  console.log(
    `    GPU: ${hardware.gpus.length > 0 ? hardware.gpus[0].name : 'None'}`,
  )
  console.log(
    `    TEE: ${hardware.tee.attestation_available ? 'Available' : 'Not available'}`,
  )

  console.log(`\n  ${chalk.bold('Services')}`)
  const enabledServices = Object.entries(config.services)
    .filter(([_, v]) => v)
    .map(([k]) => k)
  console.log(
    `    ${enabledServices.length > 0 ? enabledServices.join(', ') : 'None enabled'}`,
  )

  console.log()
}

async function cmdStart(): Promise<void> {
  const config = loadConfig()

  printBanner()

  // Check for KMS key ID (secure) or fallback to env var for legacy support
  if (!config.keyId && !process.env.JEJU_KEY_ID) {
    console.log(chalk.yellow('  No KMS key configured.'))
    console.log('  Run `jeju-node setup` to register with KMS\n')
    return
  }

  // Support env var override for key ID
  if (process.env.JEJU_KEY_ID) {
    config.keyId = process.env.JEJU_KEY_ID
    // Derive address from KMS
    try {
      const signer = createSecureSigner(config.keyId)
      config.walletAddress = await signer.getAddress()
    } catch (e) {
      log(
        'warn',
        `Could not verify KMS key: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  log('info', `Starting on ${config.network}...`)
  log('info', `KMS Key ID: ${config.keyId.slice(0, 16)}...`)

  const hardwareRaw = detectHardware()
  const hardware = convertHardwareToSnakeCase(hardwareRaw)
  log(
    'info',
    `Hardware: ${hardware.cpu.cores_physical} CPU cores, ${(hardware.memory.total_mb / 1024).toFixed(0)}GB RAM`,
  )
  if (hardware.gpus.length > 0) {
    log('info', `GPU: ${hardware.gpus[0].name}`)
  }

  try {
    const res = await fetch(config.rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_chainId',
        params: [],
        id: 1,
      }),
    })
    const json: unknown = await res.json()
    const parsed = JsonRpcResultResponseSchema.safeParse(json)
    if (!parsed.success || !parsed.data.result) throw new Error('No response')
    log('success', 'Connected to network')
  } catch {
    log('error', `Cannot connect to ${config.rpcUrl}`)
    process.exit(1)
  }

  // Create secure node client with KMS-backed signing
  const client = createSecureNodeClient(
    config.rpcUrl,
    config.chainId,
    config.keyId,
  )
  const services = createNodeServices(client, { keyId: config.keyId })

  const started: string[] = []

  for (const [name, enabled] of Object.entries(config.services)) {
    if (!enabled) continue

    const req = SERVICE_REQUIREMENTS[name]
    if (req) {
      const hardwareCamel = convertHardwareToCamelCase(hardware)
      const check = meetsRequirements(hardwareCamel, req)
      if (!check.meets) {
        log('warn', `Skipping ${name}: ${check.issues[0]}`)
        continue
      }
    }

    started.push(name)
    log('info', `Starting ${name}...`)

    if (name === 'cron') {
      startCronService(services.cron)
    }

    if (name === 'database') {
      startDatabaseService(services.database, config)
    }
  }

  log('success', `Running ${started.length} services: ${started.join(', ')}`)
  log('info', 'Press Ctrl+C to stop')

  let running = true
  process.on('SIGINT', () => {
    running = false
  })
  process.on('SIGTERM', () => {
    running = false
  })

  while (running) {
    await new Promise((r) => setTimeout(r, 60000))
  }

  log('success', 'Stopped')
}

function startCronService(
  cronService: ReturnType<typeof createNodeServices>['cron'],
) {
  let available = true

  const poll = async () => {
    if (!available) return
    try {
      const triggers = await cronService.getActiveTriggers()
      if (triggers.length > 0) {
        log('debug', `${triggers.length} cron triggers active`)
      }
    } catch (e) {
      if (String(e).includes('returned no data')) {
        log('warn', 'Cron contract not deployed - service paused')
        available = false
      }
    }
  }

  poll()
  setInterval(poll, 30000)
}

async function startDatabaseService(
  databaseService: ReturnType<typeof createNodeServices>['database'],
  config: CliAppConfig,
) {
  // Get EQLite endpoints from config (respects env var overrides)
  const blockProducerEndpoint = getEQLiteUrl(config.network)
  const minerEndpoint = getEQLiteMinerUrl(config.network)

  if (!config.keyId) {
    log('warn', 'Database service requires KMS key - skipping')
    return
  }

  try {
    await databaseService.initialize({
      blockProducerEndpoint,
      minerEndpoint,
      keyId: config.keyId, // Use KMS key ID instead of raw private key
      capacityGB: 100,
      pricePerGBMonth: 1000000000000000n, // 0.001 ETH
      stakeAmount: 100000000000000000n, // 0.1 ETH minimum stake
      hostedDatabases: [],
      enableBackups: true,
      backupRetentionDays: 30,
      maxConcurrentQueries: 100,
      queryTimeoutMs: 30000,
    })

    await databaseService.start()
    log(
      'success',
      `Database (EQLite) service started - BP: ${blockProducerEndpoint}`,
    )

    // Periodically log stats
    setInterval(() => {
      const stats = databaseService.getStats()
      if (stats.queriesPerSecond > 0) {
        log(
          'debug',
          `EQLite: ${stats.queriesPerSecond.toFixed(2)} qps, ${stats.avgQueryLatencyMs.toFixed(0)}ms avg latency`,
        )
      }
    }, 60000)
  } catch (e) {
    log('warn', `Database service failed to start: ${String(e)}`)
  }
}

async function cmdEarnings(): Promise<void> {
  const config = loadConfig()

  console.log(chalk.bold('\n  Earnings Summary\n'))

  if (!config.walletAddress) {
    console.log(chalk.yellow('  No wallet configured. Run `jeju-node setup`\n'))
    return
  }

  console.log(`  ${chalk.dim('Coming soon: earnings tracking and history')}\n`)
}

type ConfigValue = string | number | boolean | string[] | number[]

function isConfigObject(
  value: ConfigValue | NestedConfig,
): value is NestedConfig {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

type NestedConfig = { [key: string]: ConfigValue | NestedConfig }

function getConfigValue(
  config: NestedConfig,
  path: string[],
): ConfigValue | NestedConfig | undefined {
  let current: ConfigValue | NestedConfig = config
  for (const key of path) {
    if (!isConfigObject(current)) return undefined
    current = current[key]
    if (current === undefined) return undefined
  }
  return current
}

function setConfigValue(
  config: NestedConfig,
  path: string[],
  value: ConfigValue,
): boolean {
  if (path.length === 0) return false

  let current: NestedConfig = config
  for (let i = 0; i < path.length - 1; i++) {
    const key = path[i]
    const next = current[key]
    if (!isConfigObject(next)) return false
    current = next
  }

  const finalKey = path[path.length - 1]
  current[finalKey] = value
  return true
}

function parseConfigValue(value: string): ConfigValue {
  if (value === 'true') return true
  if (value === 'false') return false
  const num = Number(value)
  if (!Number.isNaN(num)) return num
  return value
}

async function cmdConfig(args: string[]): Promise<void> {
  const config = loadConfig()
  const [action, key, value] = args

  if (!action || action === 'show') {
    console.log(chalk.bold('\n  Current Config\n'))
    console.log(`  Network: ${config.network}`)
    console.log(`  Wallet: ${config.walletAddress || 'Not set'}`)
    console.log(
      `  Services: ${Object.entries(config.services)
        .filter(([_, v]) => v)
        .map(([k]) => k)
        .join(', ')}`,
    )
    console.log(`  Config: ${getConfigPath()}\n`)
    return
  }

  // CliAppConfig structure matches NestedConfig - safe type assertion
  // because we only access known keys through setConfigValue/getConfigValue
  const configObj: NestedConfig = config

  if (action === 'set' && key && value) {
    const keys = key.split('.')
    const parsedValue = parseConfigValue(value)
    const success = setConfigValue(configObj, keys, parsedValue)
    if (success) {
      saveConfig(config)
      console.log(chalk.green(`✓ Set ${key} = ${value}`))
    } else {
      console.log(chalk.red(`✗ Invalid config path: ${key}`))
    }
  } else if (action === 'get' && key) {
    const keys = key.split('.')
    const result = getConfigValue(configObj, keys)
    console.log(result)
  }
}

async function main(): Promise<void> {
  const { values, positionals } = parseArgs({
    options: {
      help: { type: 'boolean', short: 'h' },
      version: { type: 'boolean', short: 'v' },
      all: { type: 'boolean', short: 'a' },
      network: { type: 'string', short: 'n' },
      key: { type: 'string', short: 'k' },
    },
    allowPositionals: true,
  })

  const [command, ...args] = positionals

  // Sync network from environment if set
  const envNetwork = getCurrentNetwork()
  const config = loadConfig()
  if (config.network !== envNetwork) {
    const { getChainId, getRpcUrl } = await import('@jejunetwork/config')
    config.network = envNetwork
    config.rpcUrl = getRpcUrl(envNetwork)
    config.chainId = getChainId(envNetwork)
    saveConfig(config)
  }

  if (values.help || !command) {
    printBanner()
    console.log(`${chalk.bold('Commands:')}
  start       Start earning (runs in foreground)
  stop        Stop the node
  status      Check node status
  setup       Configure wallet and services
  earnings    View earnings summary
  config      View/edit config

${chalk.bold('Options:')}
  -h, --help      Show help
  -v, --version   Show version
  -n, --network   Set network (testnet/mainnet)
  -k, --key       Set KMS key ID

${chalk.bold('Environment:')}
  JEJU_KEY_ID        KMS key ID for secure signing
  JEJU_NETWORK       Network to use

${chalk.bold('Quick Start:')}
  1. jeju-node setup     # Configure your node
  2. jeju-node start     # Start earning
`)
    return
  }

  if (values.version) {
    console.log('jeju-node v0.1.0')
    return
  }

  if (values.network) {
    if (
      values.network !== 'testnet' &&
      values.network !== 'mainnet' &&
      values.network !== 'localnet'
    ) {
      throw new Error(
        `Invalid network: ${values.network}. Must be 'testnet', 'mainnet', or 'localnet'`,
      )
    }
    const config = loadConfig()
    config.network = values.network
    config.rpcUrl = getRpcUrl(config.network)
    config.chainId = getChainId(config.network)
      ? 420690
      : config.network === 'testnet'
        ? 420691
        : 31337
    saveConfig(config)
  }

  if (values.key) {
    // --key now expects a KMS key ID, not a raw private key
    const keyId = values.key
    const config = loadConfig()
    config.keyId = keyId
    // Derive address from KMS
    try {
      const signer = createSecureSigner(keyId)
      config.walletAddress = await signer.getAddress()
      saveConfig(config)
      console.log(chalk.green(`✓ Set KMS key ID: ${keyId.slice(0, 16)}...`))
      console.log(chalk.green(`✓ Address: ${config.walletAddress}`))
    } catch (e) {
      throw new Error(
        `Could not verify KMS key: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  switch (command) {
    case 'start':
      await cmdStart()
      break
    case 'stop':
      console.log(chalk.yellow('\n  Use Ctrl+C to stop a running node\n'))
      break
    case 'status':
      await cmdStatus()
      break
    case 'setup':
    case 'init':
      await cmdSetup()
      break
    case 'earnings':
      await cmdEarnings()
      break
    case 'config':
      await cmdConfig(args)
      break
    default:
      console.log(chalk.red(`Unknown command: ${command}`))
      console.log('Run `jeju-node --help` for usage')
  }
}

if (import.meta.main) {
  // Initialize config from environment variables
  configureNode({
    jejuPrivateKey: getEnvVar('JEJU_PRIVATE_KEY'),
    privateKey: getEnvVar('PRIVATE_KEY'),
    evmPrivateKey: getEnvVar('EVM_PRIVATE_KEY'),
    solanaPrivateKey: getEnvVar('SOLANA_PRIVATE_KEY'),
    rpcUrl: getEnvVar('RPC_URL'),
    network: (getEnvVar('JEJU_NETWORK') ?? 'testnet') as
      | 'mainnet'
      | 'testnet'
      | 'localnet',
    proxyRegion: getEnvVar('PROXY_REGION'),
    dwsExecUrl: getEnvVar('DWS_EXEC_URL'),
    seedingOracleUrl: getEnvVar('SEEDING_ORACLE_URL'),
    externalIp: getEnvVar('EXTERNAL_IP'),
    rpcUrl1: getEnvVar('RPC_URL_1'),
    rpcUrl42161: getEnvVar('RPC_URL_42161'),
    rpcUrl10: getEnvVar('RPC_URL_10'),
    rpcUrl8453: getEnvVar('RPC_URL_8453'),
    solanaRpcUrl: getEnvVar('SOLANA_RPC_URL'),
    zkBridgeEndpoint: getEnvVar('ZK_BRIDGE_ENDPOINT'),
    zkProverEndpoint: getEnvVar('ZK_PROVER_ENDPOINT'),
    oneInchApiKey: getEnvVar('ONEINCH_API_KEY'),
  })

  main().catch((err) => {
    console.error(chalk.red('Error:'), err.message)
    process.exit(1)
  })
}
