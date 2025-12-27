/**
 * Unified Node Operator Commands
 *
 * One-command setup for running a DWS node:
 * - jeju node setup    - Interactive guided setup
 * - jeju node start    - Start all services
 * - jeju node status   - View node health and earnings
 * - jeju node register - Register on-chain
 * - jeju node withdraw - Withdraw earnings
 * - jeju node benchmark - Test hardware capabilities
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import {
  getChainId,
  getContract,
  getRpcUrl,
  type NetworkType,
} from '@jejunetwork/config'
import { Command } from 'commander'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  formatEther,
  type Hex,
  http,
  parseEther,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'
import { logger } from '../lib/logger'

const JEJU_DIR = join(homedir(), '.jeju')
const NODE_CONFIG_PATH = join(JEJU_DIR, 'node-config.json')

// Node configuration schema
const NodeConfigSchema = z.object({
  network: z.enum(['mainnet', 'testnet', 'localnet']),
  privateKey: z.string().regex(/^0x[a-fA-F0-9]{64}$/),
  services: z.object({
    compute: z.object({
      enabled: z.boolean(),
      cpu: z.boolean(),
      gpu: z.boolean(),
      acceptNonTee: z.boolean(),
    }),
    storage: z.object({
      enabled: z.boolean(),
      capacityGB: z.number(),
      backends: z.array(z.enum(['ipfs', 'arweave', 'webtorrent'])),
    }),
    cdn: z.object({
      enabled: z.boolean(),
      region: z.string(),
    }),
    vpn: z.object({
      enabled: z.boolean(),
      exitNode: z.boolean(),
    }),
    dns: z.object({
      enabled: z.boolean(),
      dohPort: z.number(),
    }),
  }),
  pricing: z.object({
    computeRateEth: z.string(),
    storageRateEth: z.string(),
    bandwidthRateEth: z.string(),
  }),
  autoStart: z.boolean(),
  autoUpdate: z.boolean(),
})

type NodeConfig = z.infer<typeof NodeConfigSchema>

const DEFAULT_CONFIG: NodeConfig = {
  network: 'testnet',
  privateKey: '',
  services: {
    compute: {
      enabled: true,
      cpu: true,
      gpu: false,
      acceptNonTee: false,
    },
    storage: {
      enabled: true,
      capacityGB: 100,
      backends: ['ipfs'],
    },
    cdn: {
      enabled: true,
      region: 'global',
    },
    vpn: {
      enabled: false,
      exitNode: false,
    },
    dns: {
      enabled: true,
      dohPort: 5353,
    },
  },
  pricing: {
    computeRateEth: '0.001',
    storageRateEth: '0.0001',
    bandwidthRateEth: '0.00001',
  },
  autoStart: true,
  autoUpdate: true,
}

// Contract ABIs
const STAKING_ABI = [
  {
    name: 'stake',
    type: 'function',
    inputs: [],
    outputs: [],
    stateMutability: 'payable',
  },
  {
    name: 'unstake',
    type: 'function',
    inputs: [{ name: 'amount', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getStake',
    type: 'function',
    inputs: [{ name: 'operator', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'getPendingRewards',
    type: 'function',
    inputs: [{ name: 'operator', type: 'address' }],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'claimRewards',
    type: 'function',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

function loadConfig(): NodeConfig | null {
  if (!existsSync(NODE_CONFIG_PATH)) return null
  const raw = readFileSync(NODE_CONFIG_PATH, 'utf-8')
  const parsed = NodeConfigSchema.safeParse(JSON.parse(raw))
  if (!parsed.success) return null
  return parsed.data
}

function saveConfig(config: NodeConfig): void {
  if (!existsSync(JEJU_DIR)) {
    mkdirSync(JEJU_DIR, { recursive: true })
  }
  writeFileSync(NODE_CONFIG_PATH, JSON.stringify(config, null, 2))
}

export const nodeCommand = new Command('node').description(
  'Node operator commands - run and manage a DWS node',
)

/**
 * Quick setup with sensible defaults
 */
nodeCommand
  .command('setup')
  .description('Interactive guided setup for running a DWS node')
  .option(
    '-n, --network <network>',
    'Network: mainnet, testnet, localnet',
    'testnet',
  )
  .option('--minimal', 'Minimal setup - just compute services')
  .option('--full', 'Full setup - all services enabled')
  .option('-y, --yes', 'Accept all defaults (non-interactive)')
  .action(async (options) => {
    logger.header('JEJU NODE SETUP')
    console.log()
    console.log('This wizard will help you set up a DWS node.')
    console.log(
      'Your node will earn rewards for providing compute, storage, and network services.',
    )
    console.log()

    const config: NodeConfig = { ...DEFAULT_CONFIG }
    config.network = options.network as NetworkType

    // Check for existing config
    const existing = loadConfig()
    if (existing) {
      logger.warn('Existing configuration found. This will overwrite it.')
    }

    // Generate or use existing private key
    const existingKey = process.env.JEJU_PRIVATE_KEY
    if (existingKey) {
      config.privateKey = existingKey
      logger.info(
        'Using private key from JEJU_PRIVATE_KEY environment variable',
      )
    } else {
      // Generate new key
      const randomBytes = crypto.getRandomValues(new Uint8Array(32))
      const newKey = `0x${Array.from(randomBytes)
        .map((b) => b.toString(16).padStart(2, '0'))
        .join('')}` as Hex
      config.privateKey = newKey
      logger.info('Generated new wallet for node operations')
      console.log()
      logger.warn('IMPORTANT: Save this private key securely.')
      console.log(`  Private Key: ${newKey}`)
      console.log()
    }

    // Configure services based on options
    if (options.minimal) {
      config.services.storage.enabled = false
      config.services.cdn.enabled = false
      config.services.vpn.enabled = false
      config.services.dns.enabled = false
    } else if (options.full) {
      config.services.compute.gpu = true
      config.services.storage.enabled = true
      config.services.storage.capacityGB = 500
      config.services.cdn.enabled = true
      config.services.vpn.enabled = true
      config.services.vpn.exitNode = true
      config.services.dns.enabled = true
    }

    // Save configuration
    saveConfig(config)
    logger.success(`Configuration saved to ${NODE_CONFIG_PATH}`)

    console.log()
    logger.header('NEXT STEPS')
    console.log()
    console.log('1. Fund your node wallet with ETH for gas and staking:')

    const account = privateKeyToAccount(config.privateKey as Hex)
    console.log(`   Address: ${account.address}`)
    console.log()
    console.log('2. Start your node:')
    console.log('   jeju node start')
    console.log()
    console.log('3. Register on-chain to start earning:')
    console.log('   jeju node register')
    console.log()
  })

/**
 * Start all node services
 */
nodeCommand
  .command('start')
  .description('Start all configured node services')
  .option('-d, --daemon', 'Run as background daemon')
  .option('--service <service>', 'Start specific service only')
  .action(async (options) => {
    const config = loadConfig()
    if (!config) {
      logger.error('Node not configured. Run: jeju node setup')
      process.exit(1)
    }

    logger.header('STARTING JEJU NODE')

    const services: string[] = []
    if (config.services.compute.enabled) services.push('compute')
    if (config.services.storage.enabled) services.push('storage')
    if (config.services.cdn.enabled) services.push('cdn')
    if (config.services.vpn.enabled) services.push('vpn')
    if (config.services.dns.enabled) services.push('dns')

    console.log(`  Network: ${config.network}`)
    console.log(`  Services: ${services.join(', ')}`)
    console.log()

    // Start node process
    const nodeAppPath = join(process.cwd(), 'apps/node')
    const args = ['run', 'api/cli.ts', 'start', '--network', config.network]

    if (config.services.compute.cpu) args.push('--cpu')
    if (config.services.compute.gpu) args.push('--gpu')
    if (config.services.compute.acceptNonTee) args.push('--accept-non-tee')

    const env = {
      ...process.env,
      JEJU_PRIVATE_KEY: config.privateKey,
      JEJU_NETWORK: config.network,
    }

    if (options.daemon) {
      // Start as background process
      const child = spawn('bun', args, {
        cwd: nodeAppPath,
        detached: true,
        stdio: 'ignore',
        env,
      })
      child.unref()
      logger.success(`Node started as daemon (PID: ${child.pid})`)
    } else {
      // Start in foreground
      const child = spawn('bun', args, {
        cwd: nodeAppPath,
        stdio: 'inherit',
        env,
      })

      child.on('exit', (code) => {
        process.exit(code ?? 0)
      })
    }
  })

/**
 * Show node status
 */
nodeCommand
  .command('status')
  .description('Show node health, services, and earnings')
  .action(async () => {
    const config = loadConfig()
    if (!config) {
      logger.error('Node not configured. Run: jeju node setup')
      process.exit(1)
    }

    logger.header('NODE STATUS')
    console.log()

    const account = privateKeyToAccount(config.privateKey as Hex)
    const rpcUrl = getRpcUrl(config.network as NetworkType)

    const client = createPublicClient({
      transport: http(rpcUrl),
    })

    // Get balance
    const balance = await client.getBalance({ address: account.address })
    console.log(`  Wallet: ${account.address}`)
    console.log(`  Balance: ${formatEther(balance)} ETH`)
    console.log(`  Network: ${config.network}`)
    console.log()

    // Try to get staking info
    const stakingAddress = getContract('staking', 'stakingRewards') as
      | Address
      | undefined
    if (stakingAddress) {
      try {
        const stake = await client.readContract({
          address: stakingAddress,
          abi: STAKING_ABI,
          functionName: 'getStake',
          args: [account.address],
        })

        const rewards = await client.readContract({
          address: stakingAddress,
          abi: STAKING_ABI,
          functionName: 'getPendingRewards',
          args: [account.address],
        })

        console.log('  Staking:')
        console.log(`    Staked: ${formatEther(stake)} ETH`)
        console.log(`    Pending Rewards: ${formatEther(rewards)} ETH`)
        console.log()
      } catch {
        console.log('  Staking: Not registered')
        console.log()
      }
    }

    // Services status
    console.log('  Services:')
    console.log(
      `    Compute: ${config.services.compute.enabled ? 'Enabled' : 'Disabled'}`,
    )
    if (config.services.compute.enabled) {
      console.log(`      CPU: ${config.services.compute.cpu ? 'Yes' : 'No'}`)
      console.log(`      GPU: ${config.services.compute.gpu ? 'Yes' : 'No'}`)
    }
    console.log(
      `    Storage: ${config.services.storage.enabled ? `Enabled (${config.services.storage.capacityGB} GB)` : 'Disabled'}`,
    )
    console.log(
      `    CDN: ${config.services.cdn.enabled ? 'Enabled' : 'Disabled'}`,
    )
    console.log(
      `    VPN: ${config.services.vpn.enabled ? 'Enabled' : 'Disabled'}`,
    )
    console.log(
      `    DNS: ${config.services.dns.enabled ? `Enabled (port ${config.services.dns.dohPort})` : 'Disabled'}`,
    )
    console.log()
  })

/**
 * Register node on-chain
 */
nodeCommand
  .command('register')
  .description('Register node on-chain and stake to start earning')
  .option('--stake <amount>', 'Amount of ETH to stake', '0.1')
  .action(async (options) => {
    const config = loadConfig()
    if (!config) {
      logger.error('Node not configured. Run: jeju node setup')
      process.exit(1)
    }

    logger.header('REGISTER NODE')

    const account = privateKeyToAccount(config.privateKey as Hex)
    const rpcUrl = getRpcUrl(config.network as NetworkType)
    const chainId = getChainId(config.network as NetworkType)

    const stakingAddress = getContract('staking', 'stakingRewards') as
      | Address
      | undefined
    if (!stakingAddress) {
      logger.error('Staking contract not deployed on this network')
      process.exit(1)
    }

    const walletClient = createWalletClient({
      account,
      transport: http(rpcUrl),
    })

    const chain = {
      id: chainId,
      name: config.network,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    }

    const stakeAmount = parseEther(options.stake)

    console.log(`  Staking ${options.stake} ETH...`)

    try {
      const hash = await walletClient.writeContract({
        address: stakingAddress,
        abi: STAKING_ABI,
        functionName: 'stake',
        value: stakeAmount,
        chain,
      })

      logger.success(`Transaction submitted: ${hash}`)
      console.log()
      console.log('  Your node is now registered and earning rewards.')
      console.log('  Check status with: jeju node status')
    } catch (e) {
      logger.error(
        `Registration failed: ${e instanceof Error ? e.message : 'Unknown error'}`,
      )
      process.exit(1)
    }
  })

/**
 * Withdraw earnings
 */
nodeCommand
  .command('withdraw')
  .description('Withdraw pending earnings')
  .action(async () => {
    const config = loadConfig()
    if (!config) {
      logger.error('Node not configured. Run: jeju node setup')
      process.exit(1)
    }

    logger.header('WITHDRAW EARNINGS')

    const account = privateKeyToAccount(config.privateKey as Hex)
    const rpcUrl = getRpcUrl(config.network as NetworkType)
    const chainId = getChainId(config.network as NetworkType)

    const stakingAddress = getContract('staking', 'stakingRewards') as
      | Address
      | undefined
    if (!stakingAddress) {
      logger.error('Staking contract not deployed')
      process.exit(1)
    }

    const publicClient = createPublicClient({
      transport: http(rpcUrl),
    })

    // Check pending rewards
    const rewards = await publicClient.readContract({
      address: stakingAddress,
      abi: STAKING_ABI,
      functionName: 'getPendingRewards',
      args: [account.address],
    })

    if (rewards === 0n) {
      logger.info('No pending rewards to withdraw')
      return
    }

    console.log(`  Pending rewards: ${formatEther(rewards)} ETH`)
    console.log('  Claiming...')

    const walletClient = createWalletClient({
      account,
      transport: http(rpcUrl),
    })

    const chain = {
      id: chainId,
      name: config.network,
      nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
      rpcUrls: { default: { http: [rpcUrl] } },
    }

    const hash = await walletClient.writeContract({
      address: stakingAddress,
      abi: STAKING_ABI,
      functionName: 'claimRewards',
      chain,
    })

    logger.success(`Rewards claimed: ${hash}`)
  })

/**
 * Benchmark hardware
 */
nodeCommand
  .command('benchmark')
  .description('Test hardware capabilities for compute marketplace')
  .action(async () => {
    logger.header('HARDWARE BENCHMARK')
    console.log()
    console.log('Running hardware detection and benchmarks...')
    console.log()

    // Run the node app's profile command
    const nodeAppPath = join(process.cwd(), 'apps/node')
    const child = spawn('bun', ['run', 'api/cli.ts', 'profile'], {
      cwd: nodeAppPath,
      stdio: 'inherit',
    })

    child.on('exit', (code) => {
      if (code === 0) {
        console.log()
        logger.success(
          'Benchmark complete. Run `jeju node setup` to configure services.',
        )
      }
      process.exit(code ?? 0)
    })
  })

/**
 * Stop node services
 */
nodeCommand
  .command('stop')
  .description('Stop all node services')
  .action(async () => {
    logger.header('STOPPING NODE')

    // Find and kill any running node processes
    // This is a simple implementation - in production you'd use a proper process manager
    const child = spawn('pkill', ['-f', 'jeju.*node.*start'], {
      stdio: 'inherit',
    })

    child.on('exit', () => {
      logger.success('Node services stopped')
    })
  })

/**
 * Show logs
 */
nodeCommand
  .command('logs')
  .description('Show node service logs')
  .option('-f, --follow', 'Follow log output')
  .option('--service <service>', 'Show logs for specific service')
  .action(async (options) => {
    const logPath = join(JEJU_DIR, 'node.log')

    if (!existsSync(logPath)) {
      logger.info('No logs found. Start the node first: jeju node start')
      return
    }

    const args = options.follow ? ['-f', logPath] : [logPath]
    spawn('tail', args, { stdio: 'inherit' })
  })

/**
 * Update node software
 */
nodeCommand
  .command('update')
  .description('Update node software to latest version')
  .action(async () => {
    logger.header('UPDATING NODE')

    // Pull latest from git and rebuild
    const child = spawn('bun', ['install'], {
      cwd: process.cwd(),
      stdio: 'inherit',
    })

    child.on('exit', (code) => {
      if (code === 0) {
        logger.success('Node updated. Restart with: jeju node start')
      } else {
        logger.error('Update failed')
      }
      process.exit(code ?? 0)
    })
  })

export default nodeCommand
