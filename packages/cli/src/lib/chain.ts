/**
 * Chain management utilities
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { execa } from 'execa'
import { createPublicClient, formatEther, http } from 'viem'
import { z } from 'zod'
import { CHAIN_CONFIG, DEFAULT_PORTS, type NetworkType } from '../types'
import { logger } from './logger'
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
  cqlPort: z.number().int().min(0).max(65535).optional(),
  l1Rpc: z.string().url().optional(),
  l2Rpc: z.string().url().optional(),
  cqlApi: z.string().url().nullable().optional(),
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
        (socatResult.details?.install || 'Please install socat.'),
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
  const cqlPortResult = await execa(
    'kurtosis',
    ['port', 'print', ENCLAVE_NAME, 'covenantsql', 'api'],
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
  const cqlPortStr =
    cqlPortResult.exitCode === 0
      ? cqlPortResult.stdout.trim().split(':').pop()
      : null
  const cqlPort = cqlPortStr ? parseInt(cqlPortStr, 10) : 0

  // Save ports config
  const portsConfig = {
    l1Port,
    l2Port,
    cqlPort,
    l1Rpc: `http://127.0.0.1:${l1Port}`,
    l2Rpc: `http://127.0.0.1:${l2Port}`,
    cqlApi: cqlPort ? `http://127.0.0.1:${cqlPort}` : null,
    chainId: 1337,
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
  if (cqlPort) {
    await setupPortForwarding(cqlPort, DEFAULT_PORTS.cql, 'CQL API')
  }

  // Wait for chain to be ready
  logger.step('Waiting for chain...')
  await waitForChain(`http://127.0.0.1:${DEFAULT_PORTS.l2Rpc}`)

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
): { l1Port: number; l2Port: number } | null {
  const portsFile = join(rootDir, KURTOSIS_DIR, 'ports.json')
  if (!existsSync(portsFile)) {
    return null
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

  if (existsSync(bootstrapFile)) {
    logger.debug('Contracts already bootstrapped')
    return
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
