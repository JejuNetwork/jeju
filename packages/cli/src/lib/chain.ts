/** Chain management utilities */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getL2RpcUrl, getLocalhostHost } from '@jejunetwork/config'
import { execa } from 'execa'
import type { Chain } from 'viem'
import { createPublicClient, formatEther, http } from 'viem'
import { z } from 'zod'
import { CHAIN_CONFIG, DEFAULT_PORTS, type NetworkType } from '../types'
import { logger } from './logger'

/**
 * Custom localnet chain definition with chain ID 31337 (Hardhat/Anvil default).
 * NOTE: viem's built-in `localhost` chain uses chain ID 31337 (Foundry default),
 * which causes "invalid chain id for signer" errors with our Anvil setup.
 */
export const localnetChain: Chain = {
  id: 31337,
  name: 'Jeju Localnet',
  nativeCurrency: {
    decimals: 18,
    name: 'Ether',
    symbol: 'ETH',
  },
  rpcUrls: {
    default: { http: [getL2RpcUrl()] },
  },
}

import {
  checkDocker,
  checkKurtosis,
  checkSocat,
  installKurtosis,
  killPort,
} from './system'

// Schema for ports.json to prevent insecure deserialization
const PortsConfigSchema = z.object({
  l1Port: z.number().int().min(1).max(65535),
  l2Port: z.number().int().min(1).max(65535),
  eqlitePort: z.number().int().min(0).max(65535).optional(),
  l1Rpc: z.string().url().optional(),
  l2Rpc: z.string().url().optional(),
  eqliteApi: z.string().url().optional(),
  chainId: z.number().int().positive().optional(),
  timestamp: z.string().optional(),
})

const KURTOSIS_DIR = '.kurtosis'
const ENCLAVE_NAME = 'jeju-localnet'

export interface ChainStatus {
  running: boolean
  l1Rpc?: string
  l2Rpc?: string
  chainId?: number
  blockNumber?: bigint
}

export async function getChainStatus(
  network: NetworkType = 'localnet',
): Promise<ChainStatus> {
  const config = CHAIN_CONFIG[network]

  try {
    const client = createPublicClient({
      transport: http(config.rpcUrl, { timeout: 3000 }),
    })

    const [chainId, blockNumber] = await Promise.all([
      client.getChainId(),
      client.getBlockNumber(),
    ])

    return {
      running: true,
      l2Rpc: config.rpcUrl,
      chainId,
      blockNumber,
    }
  } catch {
    return { running: false }
  }
}

export async function checkRpcHealth(
  rpcUrl: string,
  timeout = 5000,
): Promise<boolean> {
  try {
    const client = createPublicClient({
      transport: http(rpcUrl, { timeout }),
    })
    await client.getChainId()
    return true
  } catch {
    return false
  }
}

export async function getAccountBalance(
  rpcUrl: string,
  address: `0x${string}`,
): Promise<string> {
  const client = createPublicClient({
    transport: http(rpcUrl, { timeout: 5000 }),
  })
  const balance = await client.getBalance({ address })
  return formatEther(balance)
}

export async function startLocalnet(
  rootDir: string,
): Promise<{ l1Port: number; l2Port: number }> {
  // Check Docker
  logger.step('Checking Docker...')
  const dockerResult = await checkDocker()
  if (dockerResult.status === 'error') {
    throw new Error(
      'Docker is required. Please install and start Docker Desktop.',
    )
  }
  logger.success('Docker running')

  // Check Kurtosis
  logger.step('Checking Kurtosis...')
  const kurtosisResult = await checkKurtosis()
  if (kurtosisResult.status !== 'ok') {
    logger.step('Installing Kurtosis...')
    const installed = await installKurtosis()
    if (!installed) {
      throw new Error(
        'Failed to install Kurtosis. Please install manually: https://docs.kurtosis.com/install/',
      )
    }
    logger.success('Kurtosis installed')
  } else {
    logger.success(`Kurtosis ${kurtosisResult.message}`)
  }

  // Check socat for port forwarding
  logger.step('Checking socat...')
  const socatResult = await checkSocat()
  if (socatResult.status !== 'ok') {
    throw new Error(
      'Socat is required for port forwarding. ' +
        (socatResult.details?.install ?? 'Please install socat.'),
    )
  }
  logger.success('Socat available')

  // Ensure kurtosis directory exists
  const kurtosisDir = join(rootDir, KURTOSIS_DIR)
  if (!existsSync(kurtosisDir)) {
    mkdirSync(kurtosisDir, { recursive: true })
  }

  // Clean up existing enclave
  logger.step('Cleaning up existing enclave...')
  await execa('kurtosis', ['enclave', 'rm', '-f', ENCLAVE_NAME], {
    reject: false,
  })

  // Start Kurtosis engine
  logger.step('Starting Kurtosis engine...')
  await execa('kurtosis', ['engine', 'start'], { reject: false })

  // Find kurtosis package
  const kurtosisPackage = join(
    rootDir,
    'packages/deployment/kurtosis/main.star',
  )
  if (!existsSync(kurtosisPackage)) {
    throw new Error(`Kurtosis package not found: ${kurtosisPackage}`)
  }

  // Deploy localnet
  logger.step('Deploying network stack...')
  await execa('kurtosis', ['run', kurtosisPackage, '--enclave', ENCLAVE_NAME], {
    stdio: 'inherit',
  })

  // Get ports
  logger.step('Getting port assignments...')
  const l1PortResult = await execa('kurtosis', [
    'port',
    'print',
    ENCLAVE_NAME,
    'geth-l1',
    'rpc',
  ])
  const l2PortResult = await execa('kurtosis', [
    'port',
    'print',
    ENCLAVE_NAME,
    'op-geth',
    'rpc',
  ])
  const eqlitePortResult = await execa(
    'kurtosis',
    ['port', 'print', ENCLAVE_NAME, 'eqlite', 'api'],
    { reject: false },
  )

  const l1PortStr = l1PortResult.stdout.trim().split(':').pop()
  const l2PortStr = l2PortResult.stdout.trim().split(':').pop()
  if (!l1PortStr || !l2PortStr) {
    throw new Error('Failed to parse L1 or L2 port from Kurtosis output')
  }
  const l1Port = parseInt(l1PortStr, 10)
  const l2Port = parseInt(l2PortStr, 10)
  if (
    Number.isNaN(l1Port) ||
    Number.isNaN(l2Port) ||
    l1Port === 0 ||
    l2Port === 0
  ) {
    throw new Error(`Invalid port values: L1=${l1Port}, L2=${l2Port}`)
  }
  const eqlitePortStr =
    eqlitePortResult.exitCode === 0
      ? eqlitePortResult.stdout.trim().split(':').pop()
      : null
  const eqlitePort = eqlitePortStr ? parseInt(eqlitePortStr, 10) : 0

  // Save ports config
  const localhost = getLocalhostHost()
  const portsConfig = {
    l1Port,
    l2Port,
    eqlitePort,
    l1Rpc: `http://${localhost}:${l1Port}`,
    l2Rpc: `http://${localhost}:${l2Port}`,
    eqliteApi: eqlitePort ? `http://${localhost}:${eqlitePort}` : undefined,
    chainId: 31337,
    timestamp: new Date().toISOString(),
  }
  writeFileSync(
    join(kurtosisDir, 'ports.json'),
    JSON.stringify(portsConfig, null, 2),
  )

  // Set up port forwarding to static ports
  logger.step('Setting up port forwarding...')
  await setupPortForwarding(l1Port, DEFAULT_PORTS.l1Rpc, 'L1 RPC')
  await setupPortForwarding(l2Port, DEFAULT_PORTS.l2Rpc, 'L2 RPC')
  if (eqlitePort) {
    await setupPortForwarding(eqlitePort, DEFAULT_PORTS.eqlite, 'EQLite API')
  }

  // Wait for chain to be ready
  logger.step('Waiting for chain...')
  await waitForChain(getL2RpcUrl())

  logger.success('Localnet running')

  return { l1Port: DEFAULT_PORTS.l1Rpc, l2Port: DEFAULT_PORTS.l2Rpc }
}

async function setupPortForwarding(
  dynamicPort: number,
  staticPort: number,
  name: string,
): Promise<void> {
  // Validate port numbers are safe integers in valid range
  if (!Number.isInteger(staticPort) || staticPort < 1 || staticPort > 65535) {
    throw new Error('Invalid static port number')
  }
  if (
    !Number.isInteger(dynamicPort) ||
    dynamicPort < 1 ||
    dynamicPort > 65535
  ) {
    throw new Error('Invalid dynamic port number')
  }

  // Kill any existing process on the static port
  await killPort(staticPort)

  // Start socat in background using array args to prevent shell injection
  // Using execa with array arguments is safer than sh -c with string interpolation
  const subprocess = execa(
    'socat',
    [`TCP-LISTEN:${staticPort},fork,reuseaddr`, `TCP:127.0.0.1:${dynamicPort}`],
    {
      detached: true,
      stdio: 'ignore',
    },
  )
  subprocess.unref()

  logger.debug(`Port forwarding: ${staticPort} -> ${dynamicPort} (${name})`)
}

async function waitForChain(rpcUrl: string, maxWait = 60000): Promise<void> {
  const startTime = Date.now()

  while (Date.now() - startTime < maxWait) {
    if (await checkRpcHealth(rpcUrl, 2000)) {
      return
    }
    await new Promise((r) => setTimeout(r, 2000))
  }

  throw new Error('Chain failed to start in time')
}

export async function stopLocalnet(): Promise<void> {
  logger.step('Stopping localnet...')

  // Kill port forwarding processes
  await killPort(DEFAULT_PORTS.l1Rpc)
  await killPort(DEFAULT_PORTS.l2Rpc)

  // Stop Kurtosis enclave
  await execa('kurtosis', ['enclave', 'stop', ENCLAVE_NAME], { reject: false })
  await execa('kurtosis', ['enclave', 'rm', '-f', ENCLAVE_NAME], {
    reject: false,
  })

  logger.success('Localnet stopped')
}

export function loadPortsConfig(
  rootDir: string,
): { l1Port: number; l2Port: number } | undefined {
  const portsFile = join(rootDir, KURTOSIS_DIR, 'ports.json')
  if (!existsSync(portsFile)) {
    return undefined
  }

  // SECURITY: Parse and validate with schema to prevent insecure deserialization
  const rawData = JSON.parse(readFileSync(portsFile, 'utf-8'))
  const result = PortsConfigSchema.safeParse(rawData)

  if (!result.success) {
    logger.warn(
      `Invalid ports.json format, using defaults: ${result.error.message}`,
    )
    return {
      l1Port: DEFAULT_PORTS.l1Rpc,
      l2Port: DEFAULT_PORTS.l2Rpc,
    }
  }

  // Use validated data or fall back to defaults
  return {
    l1Port: result.data.l1Port ?? DEFAULT_PORTS.l1Rpc,
    l2Port: result.data.l2Port ?? DEFAULT_PORTS.l2Rpc,
  }
}

export async function bootstrapContracts(
  rootDir: string,
  rpcUrl: string,
): Promise<void> {
  const bootstrapFile = join(
    rootDir,
    'packages/contracts/deployments/localnet-complete.json',
  )

  // Check if bootstrap file exists AND has valid contract addresses
  if (existsSync(bootstrapFile)) {
    const data = JSON.parse(readFileSync(bootstrapFile, 'utf-8'))
    const contracts = data?.contracts ?? {}
    // Check if any key contracts are deployed (not zero addresses)
    const hasValidContracts =
      (contracts.jnsRegistry &&
        contracts.jnsRegistry !==
          '0x0000000000000000000000000000000000000000') ||
      (contracts.storageManager &&
        contracts.storageManager !==
          '0x0000000000000000000000000000000000000000') ||
      (contracts.identityRegistry &&
        contracts.identityRegistry !==
          '0x0000000000000000000000000000000000000000')

    if (hasValidContracts) {
      logger.debug('Contracts already bootstrapped')
      return
    }
    logger.debug('Bootstrap file has placeholder addresses, will redeploy')
  }

  logger.step('Bootstrapping contracts...')

  const bootstrapScript = join(
    rootDir,
    'packages/deployment/scripts/bootstrap-localnet-complete.ts',
  )
  if (!existsSync(bootstrapScript)) {
    throw new Error(`Bootstrap script not found: ${bootstrapScript}`)
  }

  await execa('bun', ['run', bootstrapScript], {
    cwd: rootDir,
    env: {
      ...process.env,
      JEJU_RPC_URL: rpcUrl,
      L2_RPC_URL: rpcUrl,
    },
    stdio: 'pipe',
  })
  logger.success('Contracts bootstrapped')
}
