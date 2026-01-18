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
  sqlitPort: z.number().int().min(0).max(65535).optional(),
  l1Rpc: z.string().url().optional(),
  l2Rpc: z.string().url().optional(),
  sqlitApi: z.string().url().optional(),
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

export async function getRpcChainId(
  rpcUrl: string,
  timeout = 5000,
): Promise<number | null> {
  try {
    const client = createPublicClient({
      transport: http(rpcUrl, { timeout }),
    })
    return await client.getChainId()
  } catch {
    return null
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
  // If localnet is already running and reachable, don't try to recreate it.
  // This avoids hard-failing on Kurtosis/Docker client issues during E2E,
  // and preserves existing port forwarding config.
  const existingPorts = loadPortsConfig(rootDir)
  const allowedChainIds = new Set([CHAIN_CONFIG.localnet.chainId, 1337])
  if (existingPorts) {
    const existingL2RpcUrl = `http://127.0.0.1:${existingPorts.l2Port}`
    const healthy = await checkRpcHealth(existingL2RpcUrl, 2000)
    const expectedChainId = CHAIN_CONFIG.localnet.chainId
    const chainId = await getRpcChainId(existingL2RpcUrl, 2000)
    if (healthy && chainId !== null && allowedChainIds.has(chainId)) {
      logger.success(
        `Localnet already running (L1: ${existingPorts.l1Port}, L2: ${existingPorts.l2Port})`,
      )
      return existingPorts
    }
    if (healthy && chainId !== null && !allowedChainIds.has(chainId)) {
      logger.warn(
        `Localnet chain ID mismatch (expected ${expectedChainId} or 1337, got ${chainId}) - restarting`,
      )
      await stopLocalnet()
    }
  }

  // Fallback: localnet may already be running without a ports.json file.
  // If the default L2 RPC is reachable, proceed without Kurtosis.
  const defaultL2RpcUrl = CHAIN_CONFIG.localnet.rpcUrl
  const defaultHealthy = await checkRpcHealth(defaultL2RpcUrl, 2000)
  const defaultChainId = await getRpcChainId(defaultL2RpcUrl, 2000)
  if (
    defaultHealthy &&
    defaultChainId !== null &&
    allowedChainIds.has(defaultChainId)
  ) {
    logger.success(`Localnet already running (L2: ${defaultL2RpcUrl})`)
    return { l1Port: DEFAULT_PORTS.l1Rpc, l2Port: DEFAULT_PORTS.l2Rpc }
  }
  if (
    defaultHealthy &&
    defaultChainId !== null &&
    !allowedChainIds.has(defaultChainId)
  ) {
    logger.warn(
      `Localnet chain ID mismatch (expected ${CHAIN_CONFIG.localnet.chainId} or 1337, got ${defaultChainId}) - restarting`,
    )
    await stopLocalnet()
  }

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
  const runResult = await execa(
    'kurtosis',
    ['run', kurtosisPackage, '--enclave', ENCLAVE_NAME],
    { stdio: 'inherit', reject: false },
  )
  if (runResult.exitCode !== 0) {
    logger.warn(
      `Kurtosis run exited with code ${runResult.exitCode}. Verifying enclave state before failing...`,
    )
  }

  // Get ports
  logger.step('Getting port assignments...')
  const l1PortResult = await execa(
    'kurtosis',
    ['port', 'print', ENCLAVE_NAME, 'geth-l1', 'rpc'],
    { reject: false },
  )
  const l2PortResult = await execa(
    'kurtosis',
    ['port', 'print', ENCLAVE_NAME, 'op-geth', 'rpc'],
    { reject: false },
  )
  const sqlitPortResult = await execa(
    'kurtosis',
    ['port', 'print', ENCLAVE_NAME, 'sqlit', 'api'],
    { reject: false },
  )

  if (l1PortResult.exitCode !== 0 || l2PortResult.exitCode !== 0) {
    throw new Error(
      `Failed to resolve Kurtosis ports (L1 exit=${l1PortResult.exitCode}, L2 exit=${l2PortResult.exitCode}). ` +
        `L1 stderr: ${l1PortResult.stderr?.trim() || 'n/a'} | ` +
        `L2 stderr: ${l2PortResult.stderr?.trim() || 'n/a'}`,
    )
  }

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
  const sqlitPortStr =
    sqlitPortResult.exitCode === 0
      ? sqlitPortResult.stdout.trim().split(':').pop()
      : null
  const sqlitPort = sqlitPortStr ? parseInt(sqlitPortStr, 10) : 0

  // Set up port forwarding to static ports
  logger.step('Setting up port forwarding...')
  await setupPortForwarding(l1Port, DEFAULT_PORTS.l1Rpc, 'L1 RPC')
  await setupPortForwarding(l2Port, DEFAULT_PORTS.l2Rpc, 'L2 RPC')
  if (sqlitPort) {
    await setupPortForwarding(sqlitPort, DEFAULT_PORTS.sqlit, 'SQLit API')
  }

  // Save ports config with STATIC forwarded ports (not dynamic Kurtosis ports)
  // This ensures all code uses the same consistent ports
  const localhost = getLocalhostHost()
  const staticL1Port = DEFAULT_PORTS.l1Rpc
  const staticL2Port = DEFAULT_PORTS.l2Rpc
  const staticSqlitPort = sqlitPort ? DEFAULT_PORTS.sqlit : 0
  const portsConfig = {
    l1Port: staticL1Port,
    l2Port: staticL2Port,
    sqlitPort: staticSqlitPort,
    l1Rpc: `http://${localhost}:${staticL1Port}`,
    l2Rpc: `http://${localhost}:${staticL2Port}`,
    sqlitApi: staticSqlitPort
      ? `http://${localhost}:${staticSqlitPort}`
      : undefined,
    chainId: 31337,
    timestamp: new Date().toISOString(),
  }
  writeFileSync(
    join(kurtosisDir, 'ports.json'),
    JSON.stringify(portsConfig, null, 2),
  )

  // Wait for chain to be ready
  logger.step('Waiting for chain...')
  await waitForChain(getL2RpcUrl())

  logger.success('Localnet running')

  return { l1Port: staticL1Port, l2Port: staticL2Port }
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
      reject: false,
    },
  )
  subprocess.catch(() => {})
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

/**
 * Verify a contract has code deployed on-chain.
 * Returns true if contract code exists, false otherwise.
 */
async function verifyContractOnChain(
  rpcUrl: string,
  contractAddress: string,
): Promise<boolean> {
  try {
    const response = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getCode',
        params: [contractAddress, 'latest'],
        id: 1,
      }),
      signal: AbortSignal.timeout(10000),
    })

    if (!response.ok) return false

    const result = await response.json()
    const code = result.result as string
    return Boolean(code && code !== '0x' && code.length > 4)
  } catch {
    return false
  }
}

/**
 * Fund the deployer account from Geth dev account.
 * Geth --dev mode creates a pre-funded dev account that can be used for transfers.
 */
async function fundDeployerFromDevAccount(rpcUrl: string): Promise<void> {
  // Anvil default deployer account
  const DEPLOYER_ADDRESS = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
  const FUNDING_AMOUNT = '100' // 100 ETH

  // Check if deployer already has funds
  const balanceResponse = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_getBalance',
      params: [DEPLOYER_ADDRESS, 'latest'],
      id: 1,
    }),
    signal: AbortSignal.timeout(10000),
  })

  const balanceData = await balanceResponse.json()
  const balance = BigInt(balanceData.result ?? '0x0')

  // If deployer has at least 1 ETH, skip funding
  if (balance >= BigInt('1000000000000000000')) {
    logger.debug('Deployer already funded, skipping')
    return
  }

  logger.step('Funding deployer account from Geth dev account...')

  // Get dev account address (first account in Geth --dev mode)
  const accountsResponse = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_accounts',
      params: [],
      id: 1,
    }),
    signal: AbortSignal.timeout(10000),
  })

  const accountsData = await accountsResponse.json()
  const accounts = accountsData.result as string[] | undefined

  if (!accounts || accounts.length === 0) {
    throw new Error('No dev accounts available - Geth may not be in dev mode')
  }

  const devAccount = accounts[0]
  logger.debug(`Using Geth dev account: ${devAccount}`)

  // Send ETH from dev account to deployer
  const sendResponse = await fetch(rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'eth_sendTransaction',
      params: [
        {
          from: devAccount,
          to: DEPLOYER_ADDRESS,
          value: `0x${(BigInt(FUNDING_AMOUNT) * BigInt('1000000000000000000')).toString(16)}`,
        },
      ],
      id: 1,
    }),
    signal: AbortSignal.timeout(30000),
  })

  const sendData = await sendResponse.json()

  if (sendData.error) {
    throw new Error(`Failed to fund deployer: ${sendData.error.message}`)
  }

  // Wait for transaction to be mined
  const txHash = sendData.result as string
  logger.debug(`Funding tx: ${txHash}`)

  for (let i = 0; i < 30; i++) {
    await new Promise((resolve) => setTimeout(resolve, 1000))

    const receiptResponse = await fetch(rpcUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        method: 'eth_getTransactionReceipt',
        params: [txHash],
        id: 1,
      }),
      signal: AbortSignal.timeout(10000),
    })

    const receiptData = await receiptResponse.json()
    if (receiptData.result) {
      logger.success(`Deployer funded with ${FUNDING_AMOUNT} ETH`)
      return
    }
  }

  throw new Error('Funding transaction not mined within 30 seconds')
}

export async function bootstrapContracts(
  rootDir: string,
  rpcUrl: string,
): Promise<void> {
  const bootstrapFile = join(
    rootDir,
    'packages/contracts/deployments/localnet-complete.json',
  )
  const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

  // Check if bootstrap file exists AND has valid contract addresses
  if (existsSync(bootstrapFile)) {
    const data = JSON.parse(readFileSync(bootstrapFile, 'utf-8'))
    const contracts = data?.contracts ?? {}
    const jnsRegistry = contracts.jnsRegistry as string | undefined

    // If JNS Registry has valid address, verify it's on-chain
    if (jnsRegistry && jnsRegistry !== ZERO_ADDRESS) {
      const onChain = await verifyContractOnChain(rpcUrl, jnsRegistry)
      if (onChain) {
        logger.debug('Contracts already bootstrapped and verified on-chain')
        return
      }
      logger.debug(
        'Bootstrap file exists but JNS Registry not on-chain (chain may have been reset)',
      )
    } else {
      logger.debug('Bootstrap file has placeholder addresses, will redeploy')
    }
  }

  // Fund the deployer account from Geth dev account if needed
  await fundDeployerFromDevAccount(rpcUrl)

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
    stdio: 'inherit',
  })

  // Verify deployment ON-CHAIN
  if (existsSync(bootstrapFile)) {
    const data = JSON.parse(readFileSync(bootstrapFile, 'utf-8'))
    const contracts = data?.contracts ?? {}
    const jnsRegistry = contracts.jnsRegistry as string | undefined

    if (jnsRegistry && jnsRegistry !== ZERO_ADDRESS) {
      const onChain = await verifyContractOnChain(rpcUrl, jnsRegistry)
      if (!onChain) {
        throw new Error(
          'Contract deployment verification failed. ' +
            `JNS Registry at ${jnsRegistry} has no code on-chain.`,
        )
      }
    } else {
      throw new Error(
        'Bootstrap script completed but JNS Registry address is missing or zero.',
      )
    }
  } else {
    throw new Error(
      'Bootstrap script completed but deployment file was not created.',
    )
  }

  logger.success('Contracts bootstrapped and verified on-chain')
}
