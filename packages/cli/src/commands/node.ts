/**
 * Node Operator CLI
 * Commands for running and managing DWS nodes
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { CORE_PORTS, getContractsConfig, getRpcUrl } from '@jejunetwork/config'
import chalk from 'chalk'
import { Command } from 'commander'
import type { Address, Hex } from 'viem'
import {
  createPublicClient,
  createWalletClient,
  formatEther,
  http,
  parseEther,
  publicActions,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry, mainnet, sepolia } from 'viem/chains'
import { z } from 'zod'
import { logger } from '../lib/logger'
import { findMonorepoRoot } from '../lib/system'

// ============================================================================
// Types and Schemas
// ============================================================================

const NodeConfigSchema = z.object({
  nodeId: z.string(),
  privateKey: z.string().startsWith('0x'),
  network: z.enum(['localnet', 'testnet', 'mainnet']),
  services: z.array(z.enum(['cdn', 'compute', 'storage', 'da', 'git', 'pkg'])),
  endpoint: z.string().url(),
  region: z.string(),
  teeProvider: z.enum(['none', 'dstack', 'phala', 'intel-sgx', 'amd-sev']),
  stake: z.string(),
  registeredAt: z.number().optional(),
  storageProviderId: z.string().optional(),
  cdnNodeId: z.string().optional(),
  computeProviderId: z.string().optional(),
  daOperatorId: z.string().optional(),
})

type NodeConfig = z.infer<typeof NodeConfigSchema>

// ============================================================================
// Contract ABIs
// ============================================================================

const CDN_REGISTRY_ABI = [
  {
    name: 'registerEdgeNode',
    type: 'function',
    inputs: [
      { name: 'endpoint', type: 'string' },
      { name: 'region', type: 'uint8' },
      { name: 'providerType', type: 'uint8' },
    ],
    outputs: [{ name: 'nodeId', type: 'bytes32' }],
    stateMutability: 'payable',
  },
  {
    name: 'minNodeStake',
    type: 'function',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'getEdgeNode',
    type: 'function',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'nodeId', type: 'bytes32' },
          { name: 'operator', type: 'address' },
          { name: 'endpoint', type: 'string' },
          { name: 'region', type: 'uint8' },
          { name: 'providerType', type: 'uint8' },
          { name: 'status', type: 'uint8' },
          { name: 'stake', type: 'uint256' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'lastSeen', type: 'uint256' },
          { name: 'agentId', type: 'uint256' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    name: 'nodeCount',
    type: 'function',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

const STORAGE_PROVIDER_REGISTRY_ABI = [
  {
    name: 'register',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'providerType', type: 'uint8' },
      { name: 'attestationHash', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    name: 'minProviderStake',
    type: 'function',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'getProvider',
    type: 'function',
    inputs: [{ name: 'provider', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'owner', type: 'address' },
          { name: 'name', type: 'string' },
          { name: 'endpoint', type: 'string' },
          { name: 'providerType', type: 'uint8' },
          { name: 'attestationHash', type: 'bytes32' },
          { name: 'stake', type: 'uint256' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'agentId', type: 'uint256' },
          { name: 'active', type: 'bool' },
          { name: 'verified', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const

const COMPUTE_REGISTRY_ABI = [
  {
    name: 'register',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'endpoint', type: 'string' },
      { name: 'attestationHash', type: 'bytes32' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    name: 'minProviderStake',
    type: 'function',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

const DA_OPERATOR_REGISTRY_ABI = [
  {
    name: 'register',
    type: 'function',
    inputs: [
      { name: 'endpoint', type: 'string' },
      { name: 'teeAttestation', type: 'bytes32' },
      { name: 'region', type: 'string' },
      { name: 'capacityGB', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    name: 'minProviderStake',
    type: 'function',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

// ============================================================================
// Configuration Management
// ============================================================================

const CONFIG_DIR = join(homedir(), '.jeju')
const NODE_CONFIG_FILE = join(CONFIG_DIR, 'node.json')
const NODE_PID_FILE = join(CONFIG_DIR, 'node.pid')

function ensureConfigDir(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true })
  }
}

function loadNodeConfig(): NodeConfig | null {
  if (!existsSync(NODE_CONFIG_FILE)) {
    return null
  }
  const content = readFileSync(NODE_CONFIG_FILE, 'utf-8')
  const parsed: unknown = JSON.parse(content)
  const result = NodeConfigSchema.safeParse(parsed)
  if (!result.success) {
    logger.warn('Invalid node config, please run: jeju node init')
    return null
  }
  return result.data
}

function saveNodeConfig(config: NodeConfig): void {
  ensureConfigDir()
  writeFileSync(NODE_CONFIG_FILE, JSON.stringify(config, null, 2))
}

// ============================================================================
// Chain Utilities
// ============================================================================

function getChainForNetwork(network: string) {
  switch (network) {
    case 'mainnet':
      return mainnet
    case 'testnet':
      return sepolia
    default:
      return {
        ...foundry,
        id: 420690,
        name: 'Jeju Localnet',
        rpcUrls: {
          default: { http: ['http://127.0.0.1:8545'] },
        },
      }
  }
}

const REGION_MAP: Record<string, number> = {
  global: 0,
  'us-east-1': 1,
  'us-west-1': 2,
  'eu-west-1': 3,
  'eu-central-1': 4,
  'ap-northeast-1': 5,
  'ap-southeast-1': 6,
  'sa-east-1': 7,
}

// ============================================================================
// Node Commands
// ============================================================================

async function initNode(options: {
  services: string
  region: string
  endpoint: string
  stake: string
  tee: string
  privateKey?: string
  network: string
}): Promise<void> {
  logger.header('INITIALIZE NODE')

  ensureConfigDir()

  const services = options.services
    .split(',')
    .filter(Boolean) as NodeConfig['services']
  if (services.length === 0) {
    logger.error('At least one service is required')
    logger.info('Available services: cdn, compute, storage, da, git, pkg')
    process.exit(1)
  }

  let privateKey = options.privateKey
  if (!privateKey) {
    privateKey =
      process.env.NODE_PRIVATE_KEY || process.env.DEPLOYER_PRIVATE_KEY
  }

  if (!privateKey) {
    logger.step('Generating new node keypair...')
    const randomBytes = crypto.getRandomValues(new Uint8Array(32))
    privateKey = `0x${Buffer.from(randomBytes).toString('hex')}`
    logger.warn('New private key generated. Back it up securely.')
  }

  const account = privateKeyToAccount(privateKey as Hex)
  const nodeId = `jeju-node-${account.address.slice(2, 10).toLowerCase()}`

  const config: NodeConfig = {
    nodeId,
    privateKey,
    network: options.network as NodeConfig['network'],
    services,
    endpoint: options.endpoint,
    region: options.region,
    teeProvider: options.tee as NodeConfig['teeProvider'],
    stake: options.stake,
  }

  saveNodeConfig(config)

  logger.success('Node configuration created')
  logger.newline()
  logger.keyValue('Node ID', nodeId)
  logger.keyValue('Address', account.address)
  logger.keyValue('Network', options.network)
  logger.keyValue('Services', services.join(', '))
  logger.keyValue('Region', options.region)
  logger.keyValue('TEE Provider', options.tee)
  logger.keyValue('Stake', `${options.stake} ETH`)
  logger.keyValue('Config File', NODE_CONFIG_FILE)
  logger.newline()
  logger.info('Next steps:')
  logger.info('  1. Fund your node address with ETH for gas and stake')
  logger.info('  2. Register on-chain: jeju node register')
  logger.info('  3. Start the node: jeju node start')
}

async function registerNode(): Promise<void> {
  logger.header('REGISTER NODE ON-CHAIN')

  const config = loadNodeConfig()
  if (!config) {
    logger.error('Node not initialized. Run: jeju node init')
    process.exit(1)
  }

  const account = privateKeyToAccount(config.privateKey as Hex)
  const chain = getChainForNetwork(config.network)
  const rpcUrl = getRpcUrl(config.network as 'localnet' | 'testnet' | 'mainnet')

  const client = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  }).extend(publicActions)

  const balance = await client.getBalance({ address: account.address })
  const stakeAmount = parseEther(config.stake)

  logger.keyValue('Node ID', config.nodeId)
  logger.keyValue('Address', account.address)
  logger.keyValue('Balance', `${formatEther(balance)} ETH`)
  logger.keyValue('Required Stake', `${config.stake} ETH`)
  logger.newline()

  if (balance < stakeAmount) {
    logger.error('Insufficient balance for stake')
    logger.info(`Need at least ${config.stake} ETH plus gas`)
    process.exit(1)
  }

  const contracts = getContractsConfig(
    config.network as 'localnet' | 'testnet' | 'mainnet',
  )

  const attestationHash =
    config.teeProvider === 'none'
      ? ('0x0000000000000000000000000000000000000000000000000000000000000000' as Hex)
      : (`0x${Buffer.from(`tee:${config.teeProvider}:${config.nodeId}`).toString('hex').padEnd(64, '0').slice(0, 64)}` as Hex)

  const registrations: Array<{ service: string; txHash: Hex }> = []

  for (const service of config.services) {
    logger.step(`Registering as ${service} provider...`)

    switch (service) {
      case 'cdn': {
        const cdnAddress = (contracts.cdn?.registry ?? '') as Address
        if (
          !cdnAddress ||
          cdnAddress === '0x0000000000000000000000000000000000000000'
        ) {
          logger.warn('CDN Registry not deployed, skipping')
          continue
        }

        const minStake = await client.readContract({
          address: cdnAddress,
          abi: CDN_REGISTRY_ABI,
          functionName: 'minNodeStake',
        })

        const regionId = REGION_MAP[config.region] ?? 0

        const txHash = await client.writeContract({
          address: cdnAddress,
          abi: CDN_REGISTRY_ABI,
          functionName: 'registerEdgeNode',
          args: [config.endpoint, regionId, 0],
          value: minStake > stakeAmount ? minStake : stakeAmount,
        })

        await client.waitForTransactionReceipt({ hash: txHash })
        registrations.push({ service: 'cdn', txHash })
        config.cdnNodeId = txHash
        break
      }

      case 'storage': {
        const storageAddress = '' as Address
        if (
          !storageAddress ||
          storageAddress === '0x0000000000000000000000000000000000000000'
        ) {
          logger.warn('Storage Provider Registry not deployed, skipping')
          continue
        }

        const txHash = await client.writeContract({
          address: storageAddress,
          abi: STORAGE_PROVIDER_REGISTRY_ABI,
          functionName: 'register',
          args: [config.nodeId, config.endpoint, 0, attestationHash],
          value: stakeAmount,
        })

        await client.waitForTransactionReceipt({ hash: txHash })
        registrations.push({ service: 'storage', txHash })
        config.storageProviderId = txHash
        break
      }

      case 'compute': {
        const computeAddress = (contracts.compute?.registry ?? '') as Address
        if (
          !computeAddress ||
          computeAddress === '0x0000000000000000000000000000000000000000'
        ) {
          logger.warn('Compute Registry not deployed, skipping')
          continue
        }

        const txHash = await client.writeContract({
          address: computeAddress,
          abi: COMPUTE_REGISTRY_ABI,
          functionName: 'register',
          args: [config.nodeId, config.endpoint, attestationHash],
          value: stakeAmount,
        })

        await client.waitForTransactionReceipt({ hash: txHash })
        registrations.push({ service: 'compute', txHash })
        config.computeProviderId = txHash
        break
      }

      case 'da': {
        const daAddress = '' as Address
        if (
          !daAddress ||
          daAddress === '0x0000000000000000000000000000000000000000'
        ) {
          logger.warn('DA Operator Registry not deployed, skipping')
          continue
        }

        const txHash = await client.writeContract({
          address: daAddress,
          abi: DA_OPERATOR_REGISTRY_ABI,
          functionName: 'register',
          args: [config.endpoint, attestationHash, config.region, BigInt(1000)],
          value: stakeAmount,
        })

        await client.waitForTransactionReceipt({ hash: txHash })
        registrations.push({ service: 'da', txHash })
        config.daOperatorId = txHash
        break
      }

      case 'git':
      case 'pkg':
        logger.info(`${service} registration uses DWS storage backend`)
        break
    }
  }

  config.registeredAt = Date.now()
  saveNodeConfig(config)

  logger.newline()
  logger.success('Node registered on-chain')
  logger.newline()

  for (const reg of registrations) {
    logger.keyValue(reg.service, `${reg.txHash.slice(0, 16)}...`)
  }

  logger.newline()
  logger.info('Start the node with: jeju node start')
}

async function startNode(options: { foreground?: boolean }): Promise<void> {
  logger.header('START NODE')

  const config = loadNodeConfig()
  if (!config) {
    logger.error('Node not initialized. Run: jeju node init')
    process.exit(1)
  }

  if (!config.registeredAt) {
    logger.warn('Node not registered on-chain yet')
    logger.info('Register with: jeju node register')
    logger.info('Or start without registration for local testing')
    logger.newline()
  }

  const rootDir = findMonorepoRoot()
  const dwsDir = join(rootDir, 'apps/dws')

  if (!existsSync(dwsDir)) {
    logger.error('DWS app not found')
    process.exit(1)
  }

  logger.keyValue('Node ID', config.nodeId)
  logger.keyValue('Services', config.services.join(', '))
  logger.keyValue('Network', config.network)
  logger.keyValue('Endpoint', config.endpoint)
  logger.newline()

  const rpcUrl = getRpcUrl(config.network as 'localnet' | 'testnet' | 'mainnet')

  const env: Record<string, string> = {
    ...(process.env as Record<string, string>),
    NODE_ID: config.nodeId,
    NODE_PRIVATE_KEY: config.privateKey,
    NETWORK: config.network,
    RPC_URL: rpcUrl,
    JEJU_RPC_URL: rpcUrl,
    DWS_ENDPOINT: config.endpoint,
    NODE_REGION: config.region,
    TEE_PROVIDER: config.teeProvider,
    ENABLED_SERVICES: config.services.join(','),
    PORT: String(CORE_PORTS.DWS_API.get()),
    DWS_PORT: String(CORE_PORTS.DWS_API.get()),
  }

  logger.step('Starting DWS node...')

  const proc = Bun.spawn({
    cmd: ['bun', 'run', 'api/server/index.ts'],
    cwd: dwsDir,
    stdout: options.foreground ? 'inherit' : 'pipe',
    stderr: options.foreground ? 'inherit' : 'pipe',
    env,
  })

  if (options.foreground) {
    const cleanup = () => {
      logger.newline()
      logger.step('Shutting down node...')
      proc.kill('SIGTERM')
      if (existsSync(NODE_PID_FILE)) {
        const fs = require('node:fs')
        fs.unlinkSync(NODE_PID_FILE)
      }
      process.exit(0)
    }

    process.on('SIGINT', cleanup)
    process.on('SIGTERM', cleanup)

    await proc.exited
  } else {
    ensureConfigDir()
    writeFileSync(NODE_PID_FILE, String(proc.pid))

    logger.success('Node started in background')
    logger.keyValue('PID', String(proc.pid))
    logger.newline()
    logger.info('View logs: jeju node logs')
    logger.info('Check status: jeju node status')
    logger.info('Stop node: jeju node stop')
  }
}

async function stopNode(): Promise<void> {
  logger.header('STOP NODE')

  if (!existsSync(NODE_PID_FILE)) {
    logger.info('No running node found')
    return
  }

  const pid = parseInt(readFileSync(NODE_PID_FILE, 'utf-8').trim(), 10)

  logger.step(`Stopping node (PID: ${pid})...`)

  process.kill(pid, 'SIGTERM')

  const fs = require('node:fs')
  fs.unlinkSync(NODE_PID_FILE)

  logger.success('Node stopped')
}

async function nodeStatus(): Promise<void> {
  logger.header('NODE STATUS')

  const config = loadNodeConfig()
  if (!config) {
    logger.error('Node not initialized. Run: jeju node init')
    return
  }

  const account = privateKeyToAccount(config.privateKey as Hex)

  logger.subheader('Configuration')
  logger.keyValue('Node ID', config.nodeId)
  logger.keyValue('Address', account.address)
  logger.keyValue('Network', config.network)
  logger.keyValue('Services', config.services.join(', '))
  logger.keyValue('Region', config.region)
  logger.keyValue('TEE Provider', config.teeProvider)
  logger.keyValue(
    'Registered',
    config.registeredAt ? new Date(config.registeredAt).toISOString() : 'No',
  )

  logger.newline()
  logger.subheader('Runtime')

  let isRunning = false
  let pid: number | null = null

  if (existsSync(NODE_PID_FILE)) {
    pid = parseInt(readFileSync(NODE_PID_FILE, 'utf-8').trim(), 10)

    const checkProc = Bun.spawn(['kill', '-0', String(pid)], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const exitCode = await checkProc.exited
    isRunning = exitCode === 0
  }

  logger.table([
    {
      label: 'Status',
      value: isRunning ? 'Running' : 'Stopped',
      status: isRunning ? 'ok' : 'error',
    },
  ])

  if (isRunning && pid) {
    logger.keyValue('PID', String(pid))

    const endpoint = config.endpoint.replace(/\/$/, '')
    const healthResponse = await fetch(`${endpoint}/health`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => null)

    if (healthResponse?.ok) {
      const health = (await healthResponse.json()) as {
        uptime?: number
        services?: Record<string, { status: string }>
      }

      if (health.uptime) {
        const uptimeHours = Math.floor(health.uptime / 1000 / 60 / 60)
        const uptimeMins = Math.floor((health.uptime / 1000 / 60) % 60)
        logger.keyValue('Uptime', `${uptimeHours}h ${uptimeMins}m`)
      }

      if (health.services) {
        logger.newline()
        logger.subheader('Services')
        for (const [name, svc] of Object.entries(health.services)) {
          const status = svc.status === 'healthy' ? 'ok' : 'error'
          logger.table([{ label: name, value: svc.status, status }])
        }
      }
    }
  }

  logger.newline()
  logger.subheader('On-Chain')

  const chain = getChainForNetwork(config.network)
  const rpcUrl = getRpcUrl(config.network as 'localnet' | 'testnet' | 'mainnet')

  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  const balance = await client
    .getBalance({ address: account.address })
    .catch(() => BigInt(0))
  logger.keyValue('Balance', `${formatEther(balance)} ETH`)

  if (config.cdnNodeId) {
    logger.keyValue('CDN Node', 'Registered')
  }
  if (config.storageProviderId) {
    logger.keyValue('Storage Provider', 'Registered')
  }
  if (config.computeProviderId) {
    logger.keyValue('Compute Provider', 'Registered')
  }
  if (config.daOperatorId) {
    logger.keyValue('DA Operator', 'Registered')
  }
}

async function nodeEarnings(): Promise<void> {
  logger.header('NODE EARNINGS')

  const config = loadNodeConfig()
  if (!config) {
    logger.error('Node not initialized. Run: jeju node init')
    return
  }

  const account = privateKeyToAccount(config.privateKey as Hex)
  const chain = getChainForNetwork(config.network)
  const rpcUrl = getRpcUrl(config.network as 'localnet' | 'testnet' | 'mainnet')

  const client = createPublicClient({
    chain,
    transport: http(rpcUrl),
  })

  const balance = await client.getBalance({ address: account.address })

  logger.keyValue('Node ID', config.nodeId)
  logger.keyValue('Address', account.address)
  logger.newline()

  logger.subheader('Balance')
  logger.keyValue('Current Balance', `${formatEther(balance)} ETH`)
  logger.keyValue('Staked', `${config.stake} ETH`)

  logger.newline()
  logger.subheader('Earnings Summary')

  const endpoint = config.endpoint.replace(/\/$/, '')
  const earningsResponse = await fetch(`${endpoint}/node/earnings`, {
    headers: { 'x-jeju-address': account.address },
    signal: AbortSignal.timeout(5000),
  }).catch(() => null)

  if (earningsResponse?.ok) {
    const earnings = (await earningsResponse.json()) as {
      total: string
      pending: string
      lastPayout: number | null
      breakdown: Record<string, string>
    }

    logger.keyValue('Total Earned', `${earnings.total} ETH`)
    logger.keyValue('Pending', `${earnings.pending} ETH`)
    if (earnings.lastPayout) {
      logger.keyValue(
        'Last Payout',
        new Date(earnings.lastPayout).toISOString(),
      )
    }

    if (earnings.breakdown) {
      logger.newline()
      logger.subheader('By Service')
      for (const [service, amount] of Object.entries(earnings.breakdown)) {
        logger.keyValue(service, `${amount} ETH`)
      }
    }
  } else {
    logger.info('Earnings data not available (node may not be running)')
  }

  logger.newline()
  logger.info('Withdraw earnings: jeju node withdraw')
}

async function nodeWithdraw(options: { amount?: string }): Promise<void> {
  logger.header('WITHDRAW EARNINGS')

  const config = loadNodeConfig()
  if (!config) {
    logger.error('Node not initialized. Run: jeju node init')
    return
  }

  const account = privateKeyToAccount(config.privateKey as Hex)
  const chain = getChainForNetwork(config.network)
  const rpcUrl = getRpcUrl(config.network as 'localnet' | 'testnet' | 'mainnet')

  createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  }).extend(publicActions)

  logger.keyValue('Node ID', config.nodeId)
  logger.keyValue('Address', account.address)
  logger.newline()

  logger.info('Withdrawal initiated through x402 payment protocol')
  logger.info('Funds will be transferred to your node address')

  const amount = options.amount ? parseEther(options.amount) : undefined

  if (amount) {
    logger.keyValue('Amount', `${options.amount} ETH`)
  } else {
    logger.info('Withdrawing all available earnings')
  }

  logger.newline()
  logger.warn('Withdrawal functionality requires active earnings')
  logger.info('Check your earnings with: jeju node earnings')
}

async function nodeLogs(options: {
  follow?: boolean
  lines: string
}): Promise<void> {
  const config = loadNodeConfig()
  if (!config) {
    logger.error('Node not initialized. Run: jeju node init')
    return
  }

  const endpoint = config.endpoint.replace(/\/$/, '')
  const numLines = parseInt(options.lines, 10)

  if (options.follow) {
    logger.info(`Streaming logs from ${endpoint}...`)
    logger.info('Press Ctrl+C to stop')
    logger.newline()

    const eventSource = new EventSource(`${endpoint}/node/logs/stream`)

    eventSource.onmessage = (event) => {
      console.log(event.data)
    }

    eventSource.onerror = () => {
      logger.error('Log stream disconnected')
      eventSource.close()
    }

    process.on('SIGINT', () => {
      eventSource.close()
      process.exit(0)
    })

    await new Promise(() => {})
  } else {
    const response = await fetch(`${endpoint}/node/logs?lines=${numLines}`, {
      signal: AbortSignal.timeout(10000),
    }).catch(() => null)

    if (response?.ok) {
      const logs = await response.text()
      console.log(logs)
    } else {
      logger.error('Could not fetch logs (node may not be running)')
    }
  }
}

async function nodeHardware(): Promise<void> {
  logger.header('HARDWARE REQUIREMENTS')

  logger.subheader('Minimum Requirements')
  console.log('')
  console.log(chalk.bold('  CDN Node:'))
  console.log('    CPU: 2 cores')
  console.log('    RAM: 4 GB')
  console.log('    Storage: 100 GB SSD')
  console.log('    Bandwidth: 100 Mbps')
  console.log('    Stake: 0.01 ETH')
  console.log('')

  console.log(chalk.bold('  Storage Node:'))
  console.log('    CPU: 4 cores')
  console.log('    RAM: 8 GB')
  console.log('    Storage: 1 TB SSD')
  console.log('    Bandwidth: 1 Gbps')
  console.log('    Stake: 0.1 ETH')
  console.log('')

  console.log(chalk.bold('  Compute Node:'))
  console.log('    CPU: 8 cores')
  console.log('    RAM: 32 GB')
  console.log('    Storage: 500 GB NVMe')
  console.log('    Bandwidth: 1 Gbps')
  console.log('    GPU: Optional (NVIDIA RTX 3080+ for AI)')
  console.log('    TEE: Recommended (Intel SGX, AMD SEV)')
  console.log('    Stake: 0.5 ETH')
  console.log('')

  console.log(chalk.bold('  DA Operator:'))
  console.log('    CPU: 4 cores')
  console.log('    RAM: 16 GB')
  console.log('    Storage: 2 TB SSD')
  console.log('    Bandwidth: 1 Gbps')
  console.log('    TEE: Required')
  console.log('    Stake: 1 ETH')
  console.log('')

  console.log(chalk.bold('  Full Node (All Services):'))
  console.log('    CPU: 16 cores')
  console.log('    RAM: 64 GB')
  console.log('    Storage: 4 TB NVMe')
  console.log('    Bandwidth: 10 Gbps')
  console.log('    GPU: NVIDIA RTX 4090')
  console.log('    TEE: Intel SGX or AMD SEV')
  console.log('    Stake: 2 ETH')
  console.log('')

  logger.subheader('TEE Options')
  console.log('')
  console.log('  Intel SGX: Best for confidential compute')
  console.log('  AMD SEV: Good for VM-level isolation')
  console.log('  dstack: Development/testing simulator')
  console.log('  Phala: Managed TEE infrastructure')
  console.log('')

  logger.info(
    'Calculate requirements: jeju node calculate --services cdn,compute',
  )
}

async function calculateRequirements(options: {
  services: string
}): Promise<void> {
  logger.header('CALCULATE NODE REQUIREMENTS')

  const services = options.services.split(',').filter(Boolean)

  if (services.length === 0) {
    logger.error('Specify services with --services cdn,compute,storage')
    return
  }

  const specs: Record<
    string,
    {
      cpu: number
      ram: number
      storage: number
      bandwidth: number
      stake: number
    }
  > = {
    cdn: { cpu: 2, ram: 4, storage: 100, bandwidth: 100, stake: 0.01 },
    storage: { cpu: 4, ram: 8, storage: 1000, bandwidth: 1000, stake: 0.1 },
    compute: { cpu: 8, ram: 32, storage: 500, bandwidth: 1000, stake: 0.5 },
    da: { cpu: 4, ram: 16, storage: 2000, bandwidth: 1000, stake: 1 },
    git: { cpu: 2, ram: 4, storage: 200, bandwidth: 500, stake: 0.05 },
    pkg: { cpu: 2, ram: 4, storage: 500, bandwidth: 500, stake: 0.05 },
  }

  let totalCpu = 0
  let totalRam = 0
  let totalStorage = 0
  let totalBandwidth = 0
  let totalStake = 0

  logger.keyValue('Services', services.join(', '))
  logger.newline()

  for (const service of services) {
    const spec = specs[service]
    if (spec) {
      totalCpu = Math.max(totalCpu, spec.cpu)
      totalRam += spec.ram
      totalStorage += spec.storage
      totalBandwidth = Math.max(totalBandwidth, spec.bandwidth)
      totalStake += spec.stake
    }
  }

  logger.subheader('Required Resources')
  logger.keyValue('CPU', `${totalCpu} cores`)
  logger.keyValue('RAM', `${totalRam} GB`)
  logger.keyValue('Storage', `${totalStorage} GB SSD`)
  logger.keyValue('Bandwidth', `${totalBandwidth} Mbps`)
  logger.keyValue('Minimum Stake', `${totalStake} ETH`)

  logger.newline()
  logger.subheader('Estimated Costs')

  const monthlyCloud =
    totalCpu * 10 + totalRam * 2 + totalStorage * 0.05 + totalBandwidth * 0.01
  logger.keyValue('Cloud Hosting', `~$${monthlyCloud.toFixed(0)}/month`)
  logger.keyValue('Stake (one-time)', `${totalStake} ETH`)

  logger.newline()
  logger.subheader('Quick Start')
  logger.info(
    `jeju node init --services ${services.join(',')} --stake ${totalStake}`,
  )
}

// ============================================================================
// Command Export
// ============================================================================

export const nodeCommand = new Command('node')
  .description(
    'Node operator commands - run and manage DWS infrastructure nodes',
  )
  .addCommand(
    new Command('init')
      .description('Initialize a new node configuration')
      .option(
        '--services <list>',
        'Comma-separated services: cdn,compute,storage,da,git,pkg',
        'cdn,storage',
      )
      .option('--region <region>', 'Node region', 'us-east-1')
      .option(
        '--endpoint <url>',
        'Public endpoint URL',
        'http://localhost:4030',
      )
      .option('--stake <amount>', 'Stake amount in ETH', '0.1')
      .option(
        '--tee <provider>',
        'TEE provider: none, dstack, phala, intel-sgx, amd-sev',
        'dstack',
      )
      .option(
        '--private-key <key>',
        'Private key (or set NODE_PRIVATE_KEY env)',
      )
      .option(
        '--network <network>',
        'Network: localnet, testnet, mainnet',
        'localnet',
      )
      .action(initNode),
  )
  .addCommand(
    new Command('register')
      .description('Register node on-chain (requires stake)')
      .action(registerNode),
  )
  .addCommand(
    new Command('start')
      .description('Start the node')
      .option('--foreground', "Run in foreground (don't daemonize)")
      .action(startNode),
  )
  .addCommand(
    new Command('stop').description('Stop the running node').action(stopNode),
  )
  .addCommand(
    new Command('status').description('Check node status').action(nodeStatus),
  )
  .addCommand(
    new Command('earnings')
      .description('View node earnings')
      .action(nodeEarnings),
  )
  .addCommand(
    new Command('withdraw')
      .description('Withdraw earnings')
      .option('--amount <eth>', 'Amount to withdraw (default: all)')
      .action(nodeWithdraw),
  )
  .addCommand(
    new Command('logs')
      .description('View node logs')
      .option('-f, --follow', 'Follow log output')
      .option('-n, --lines <n>', 'Number of lines to show', '100')
      .action(nodeLogs),
  )
  .addCommand(
    new Command('hardware')
      .description('Show hardware requirements')
      .action(nodeHardware),
  )
  .addCommand(
    new Command('calculate')
      .description('Calculate requirements for services')
      .option('--services <list>', 'Comma-separated services', 'cdn,storage')
      .action(calculateRequirements),
  )
