/**
 * DWS Local Provisioner - On-chain provisioning for local development
 *
 * Core Principle: ALL services are provisioned on-chain, even locally.
 * The only difference is the compute backend (Docker vs cloud).
 *
 * Fast HMR Strategy:
 * - First boot: Deploy contracts, provision services (slow, ~30s)
 * - Subsequent boots: Check cache, skip if already provisioned (fast, ~2s)
 * - HMR: Don't touch infrastructure, just reload code
 *
 * Cached State (in .dws-local/):
 * - contracts.json: Deployed contract addresses
 * - provisions.json: Provisioned services with their endpoints
 * - docker-state.json: Running container IDs
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { getDWSUrl, getL1RpcUrl, getLocalhostHost } from '@jejunetwork/config'
import { execa } from 'execa'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
  keccak256,
  parseEther,
  toBytes,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import { logger } from '../lib/logger'
import { WELL_KNOWN_KEYS } from '../types'

// Contract ABIs
const EXTERNAL_CHAIN_PROVIDER_ABI = [
  {
    name: 'registerProvider',
    type: 'function',
    inputs: [
      { name: 'supportedChains', type: 'uint8[]' },
      { name: 'supportedNodes', type: 'uint8[]' },
      { name: 'supportedNetworks', type: 'uint8[]' },
      { name: 'endpoint', type: 'string' },
      { name: 'teeAttestation', type: 'bytes32' },
    ],
    outputs: [{ name: 'providerId', type: 'bytes32' }],
    stateMutability: 'payable',
  },
  {
    name: 'provisionNode',
    type: 'function',
    inputs: [
      {
        name: 'config',
        type: 'tuple',
        components: [
          { name: 'chainType', type: 'uint8' },
          { name: 'nodeType', type: 'uint8' },
          { name: 'network', type: 'uint8' },
          { name: 'version', type: 'string' },
          { name: 'teeRequired', type: 'bool' },
          { name: 'teeType', type: 'string' },
          { name: 'minMemoryGb', type: 'uint256' },
          { name: 'minStorageGb', type: 'uint256' },
          { name: 'minCpuCores', type: 'uint256' },
          { name: 'additionalParams', type: 'string[]' },
        ],
      },
      { name: 'durationHours', type: 'uint256' },
    ],
    outputs: [{ name: 'nodeId', type: 'bytes32' }],
    stateMutability: 'payable',
  },
  {
    name: 'reportNodeReady',
    type: 'function',
    inputs: [
      { name: 'nodeId', type: 'bytes32' },
      { name: 'rpcEndpoint', type: 'string' },
      { name: 'wsEndpoint', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'setMinProviderStake',
    type: 'function',
    inputs: [{ name: 'stake', type: 'uint256' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'providerIds',
    type: 'function',
    inputs: [{ name: 'operator', type: 'address' }],
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
  },
  {
    name: 'getNode',
    type: 'function',
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'nodeId', type: 'bytes32' },
          { name: 'providerId', type: 'bytes32' },
          { name: 'consumer', type: 'address' },
          { name: 'rpcEndpoint', type: 'string' },
          { name: 'wsEndpoint', type: 'string' },
          { name: 'provisionedAt', type: 'uint256' },
          { name: 'expiresAt', type: 'uint256' },
          { name: 'pricePerHour', type: 'uint256' },
          { name: 'totalPaid', type: 'uint256' },
          { name: 'status', type: 'uint8' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const

// Service configurations
interface ServiceConfig {
  chainType: number // ChainType enum
  nodeType: number // NodeType enum
  version: string
  dockerImage: string
  ports: { main: number; secondary?: number }
  env?: Record<string, string>
  healthCheck: { path: string; method: 'GET' | 'POST' }
  startupDelay: number
}

const SERVICE_CONFIGS: Record<string, ServiceConfig> = {
  postgres: {
    chainType: 12, // Custom
    nodeType: 0, // RPC
    version: '16',
    dockerImage: 'postgres:16-alpine',
    ports: { main: 5432 },
    env: {
      POSTGRES_USER: 'jeju',
      POSTGRES_PASSWORD: 'jejudev',
      POSTGRES_DB: 'jeju',
    },
    healthCheck: { path: '', method: 'GET' },
    startupDelay: 3000,
  },
  redis: {
    chainType: 12, // Custom
    nodeType: 0,
    version: '7',
    dockerImage: 'redis:7-alpine',
    ports: { main: 6379 },
    healthCheck: { path: '', method: 'GET' },
    startupDelay: 1000,
  },
  ipfs: {
    chainType: 12, // Custom
    nodeType: 0,
    version: '0.29',
    dockerImage: 'ipfs/kubo:v0.29.0',
    ports: { main: 5001, secondary: 8080 },
    healthCheck: { path: '/api/v0/id', method: 'POST' },
    startupDelay: 5000,
  },
}

interface CachedContracts {
  externalChainProvider: Address
  deployedAt: string
}

interface CachedProvision {
  serviceId: string
  nodeId: string
  containerId: string
  endpoint: string
  provisionedAt: string
}

interface CachedState {
  contracts: CachedContracts | null
  provisions: CachedProvision[]
  providerId: string | null
}

export class DWSLocalProvisioner {
  private rootDir: string
  private cacheDir: string
  private state: CachedState
  private rpcUrl = getL1RpcUrl()
  private privateKey: Hex

  constructor(rootDir: string) {
    this.rootDir = rootDir
    this.cacheDir = join(rootDir, '.dws-local')
    this.privateKey = WELL_KNOWN_KEYS.dev[0].privateKey as Hex
    this.state = this.loadState()
  }

  private loadState(): CachedState {
    const statePath = join(this.cacheDir, 'state.json')
    if (existsSync(statePath)) {
      return JSON.parse(readFileSync(statePath, 'utf-8'))
    }
    return { contracts: null, provisions: [], providerId: null }
  }

  private saveState(): void {
    if (!existsSync(this.cacheDir)) {
      mkdirSync(this.cacheDir, { recursive: true })
    }
    writeFileSync(
      join(this.cacheDir, 'state.json'),
      JSON.stringify(this.state, null, 2),
    )
  }

  /**
   * Check if Anvil is running on port 8545
   */
  async isAnvilRunning(): Promise<boolean> {
    try {
      const response = await fetch(this.rpcUrl, {
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
      return response.ok
    } catch {
      return false
    }
  }

  /**
   * Start Anvil if not running
   */
  async ensureAnvil(): Promise<boolean> {
    if (await this.isAnvilRunning()) {
      logger.debug('Anvil already running on port 8545')
      return true
    }

    logger.step('Starting Anvil...')

    // Start anvil in background
    execa(
      'anvil',
      ['--host', '0.0.0.0', '--port', '8545', '--chain-id', '31337'],
      {
        stdio: 'ignore',
        detached: true,
      },
    ).unref()

    // Wait for startup
    for (let i = 0; i < 30; i++) {
      await this.sleep(500)
      if (await this.isAnvilRunning()) {
        logger.success('Anvil running on port 8545')
        return true
      }
    }

    logger.error('Anvil failed to start')
    return false
  }

  /**
   * Deploy ExternalChainProvider contract if not cached
   */
  async ensureContracts(): Promise<Address> {
    // Check if already deployed (from cache)
    if (this.state.contracts) {
      // Verify contract still exists on chain
      const publicClient = createPublicClient({
        chain: foundry,
        transport: http(this.rpcUrl),
      })

      try {
        const code = await publicClient.getCode({
          address: this.state.contracts.externalChainProvider,
        })
        if (code && code !== '0x') {
          logger.debug(
            `Using cached ExternalChainProvider: ${this.state.contracts.externalChainProvider}`,
          )
          return this.state.contracts.externalChainProvider
        }
      } catch {
        // Contract not found, need to redeploy
      }
    }

    logger.step('Deploying ExternalChainProvider contract...')

    const contractsDir = join(this.rootDir, 'packages/contracts')

    // Deploy contract
    const result = await execa(
      'forge',
      [
        'create',
        'src/dws/ExternalChainProvider.sol:ExternalChainProvider',
        '--rpc-url',
        this.rpcUrl,
        '--private-key',
        this.privateKey,
        '--constructor-args',
        '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', // treasury
        '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', // owner
        '--json',
      ],
      { cwd: contractsDir },
    )

    const deployData = JSON.parse(result.stdout)
    const contractAddress = deployData.deployedTo as Address

    // Set low min stake for local dev (1 ETH instead of 5000)
    const account = privateKeyToAccount(this.privateKey)
    const walletClient = createWalletClient({
      account,
      chain: foundry,
      transport: http(this.rpcUrl),
    })

    const publicClient = createPublicClient({
      chain: foundry,
      transport: http(this.rpcUrl),
    })

    const setStakeHash = await walletClient.writeContract({
      address: contractAddress,
      abi: EXTERNAL_CHAIN_PROVIDER_ABI,
      functionName: 'setMinProviderStake',
      args: [parseEther('1')],
    })
    await publicClient.waitForTransactionReceipt({ hash: setStakeHash })

    // Cache
    this.state.contracts = {
      externalChainProvider: contractAddress,
      deployedAt: new Date().toISOString(),
    }
    this.saveState()

    logger.success(`ExternalChainProvider deployed: ${contractAddress}`)
    return contractAddress
  }

  /**
   * Register as provider on-chain if not already
   */
  async ensureProvider(contractAddress: Address): Promise<string> {
    const account = privateKeyToAccount(this.privateKey)
    const publicClient = createPublicClient({
      chain: foundry,
      transport: http(this.rpcUrl),
    })
    const walletClient = createWalletClient({
      account,
      chain: foundry,
      transport: http(this.rpcUrl),
    })

    // Check if already registered
    const existingProviderId = await publicClient.readContract({
      address: contractAddress,
      abi: EXTERNAL_CHAIN_PROVIDER_ABI,
      functionName: 'providerIds',
      args: [account.address],
    })

    if (existingProviderId !== `0x${'0'.repeat(64)}`) {
      logger.debug(
        `Already registered as provider: ${existingProviderId.slice(0, 18)}...`,
      )
      this.state.providerId = existingProviderId
      this.saveState()
      return existingProviderId
    }

    logger.step('Registering as DWS provider...')

    // Register with all service types
    const supportedChains = [12] // Custom
    const supportedNodes = [0] // RPC
    const supportedNetworks = [0] // Devnet

    const registerHash = await walletClient.writeContract({
      address: contractAddress,
      abi: EXTERNAL_CHAIN_PROVIDER_ABI,
      functionName: 'registerProvider',
      args: [
        supportedChains,
        supportedNodes,
        supportedNetworks,
        getDWSUrl() ?? `http://${getLocalhostHost()}:4030`,
        `0x${'0'.repeat(64)}` as Hex, // No TEE for local
      ],
      value: parseEther('1'),
    })

    await publicClient.waitForTransactionReceipt({ hash: registerHash })

    const providerId = await publicClient.readContract({
      address: contractAddress,
      abi: EXTERNAL_CHAIN_PROVIDER_ABI,
      functionName: 'providerIds',
      args: [account.address],
    })

    this.state.providerId = providerId
    this.saveState()

    logger.success(`Registered as provider: ${providerId.slice(0, 18)}...`)
    return providerId
  }

  /**
   * Provision a service on-chain and start Docker container
   */
  async provisionService(
    serviceId: string,
    contractAddress: Address,
  ): Promise<{ endpoint: string; nodeId: string }> {
    const config = SERVICE_CONFIGS[serviceId]
    if (!config) {
      throw new Error(`Unknown service: ${serviceId}`)
    }

    // Check if already provisioned
    const existing = this.state.provisions.find(
      (p) => p.serviceId === serviceId,
    )
    if (existing) {
      // Verify container is still running
      const isRunning = await this.isContainerRunning(existing.containerId)
      if (isRunning) {
        logger.debug(`${serviceId} already provisioned: ${existing.endpoint}`)
        return { endpoint: existing.endpoint, nodeId: existing.nodeId }
      }
      // Container stopped, remove from cache
      this.state.provisions = this.state.provisions.filter(
        (p) => p.serviceId !== serviceId,
      )
    }

    logger.step(`Provisioning ${serviceId} on-chain...`)

    const account = privateKeyToAccount(this.privateKey)
    const publicClient = createPublicClient({
      chain: foundry,
      transport: http(this.rpcUrl),
    })
    const walletClient = createWalletClient({
      account,
      chain: foundry,
      transport: http(this.rpcUrl),
    })

    // Provision on-chain
    const provisionHash = await walletClient.writeContract({
      address: contractAddress,
      abi: EXTERNAL_CHAIN_PROVIDER_ABI,
      functionName: 'provisionNode',
      args: [
        {
          chainType: config.chainType,
          nodeType: config.nodeType,
          network: 0, // Devnet
          version: config.version,
          teeRequired: false,
          teeType: '',
          minMemoryGb: BigInt(1),
          minStorageGb: BigInt(10),
          minCpuCores: BigInt(1),
          additionalParams: [],
        },
        BigInt(24 * 7), // 1 week
      ],
      value: parseEther('2'), // Enough for 1 week at 0.01 ETH/hour
    })

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: provisionHash,
    })

    const nodeId = keccak256(
      toBytes(
        `${account.address}${this.state.providerId}${receipt.blockNumber}`,
      ),
    )

    // Start Docker container
    const containerId = await this.startDockerContainer(serviceId, config)

    // Build endpoint
    const endpoint =
      serviceId === 'postgres'
        ? `postgresql://jeju:jejudev@localhost:${config.ports.main}/jeju`
        : serviceId === 'redis'
          ? `redis://localhost:${config.ports.main}`
          : `http://localhost:${config.ports.main}`

    // Report ready on-chain
    const reportHash = await walletClient.writeContract({
      address: contractAddress,
      abi: EXTERNAL_CHAIN_PROVIDER_ABI,
      functionName: 'reportNodeReady',
      args: [nodeId, endpoint, ''],
    })
    await publicClient.waitForTransactionReceipt({ hash: reportHash })

    // Cache
    this.state.provisions.push({
      serviceId,
      nodeId,
      containerId,
      endpoint,
      provisionedAt: new Date().toISOString(),
    })
    this.saveState()

    logger.success(`${serviceId} provisioned: ${endpoint}`)
    return { endpoint, nodeId }
  }

  /**
   * Start a Docker container for a service
   */
  private async startDockerContainer(
    serviceId: string,
    config: ServiceConfig,
  ): Promise<string> {
    const containerName = `jeju-dws-${serviceId}`

    // Stop existing if any
    await execa('docker', ['stop', containerName], { reject: false })
    await execa('docker', ['rm', containerName], { reject: false })

    // Build docker run args
    const args = [
      'run',
      '-d',
      '--name',
      containerName,
      '-p',
      `${config.ports.main}:${config.ports.main}`,
    ]

    if (config.ports.secondary) {
      args.push('-p', `${config.ports.secondary}:${config.ports.secondary}`)
    }

    if (config.env) {
      for (const [key, value] of Object.entries(config.env)) {
        args.push('-e', `${key}=${value}`)
      }
    }

    args.push(config.dockerImage)

    // Run
    const result = await execa('docker', args)
    const containerId = result.stdout.trim()

    // Wait for startup
    await this.sleep(config.startupDelay)

    return containerId
  }

  /**
   * Check if a Docker container is running
   */
  private async isContainerRunning(containerId: string): Promise<boolean> {
    try {
      const result = await execa('docker', [
        'inspect',
        '-f',
        '{{.State.Running}}',
        containerId,
      ])
      return result.stdout.trim() === 'true'
    } catch {
      return false
    }
  }

  /**
   * Main entry point - ensure all infrastructure is provisioned
   */
  async ensureAllProvisioned(
    services: string[] = ['ipfs'],
  ): Promise<Record<string, string>> {
    logger.header('DWS ON-CHAIN PROVISIONING')

    // Step 1: Ensure Anvil running
    if (!(await this.ensureAnvil())) {
      throw new Error('Failed to start Anvil')
    }

    // Step 2: Ensure contracts deployed
    const contractAddress = await this.ensureContracts()

    // Step 3: Ensure registered as provider
    await this.ensureProvider(contractAddress)

    // Step 4: Provision each service
    const endpoints: Record<string, string> = {}
    for (const serviceId of services) {
      const { endpoint } = await this.provisionService(
        serviceId,
        contractAddress,
      )
      endpoints[serviceId] = endpoint
    }

    logger.newline()
    logger.success('All services provisioned on-chain')

    return endpoints
  }

  /**
   * Get cached endpoints (for fast HMR)
   */
  getCachedEndpoints(): Record<string, string> {
    const endpoints: Record<string, string> = {}
    for (const provision of this.state.provisions) {
      endpoints[provision.serviceId] = provision.endpoint
    }
    return endpoints
  }

  /**
   * Check if fully provisioned (for fast startup check)
   */
  async isFullyProvisioned(services: string[]): Promise<boolean> {
    // Check contracts exist
    if (!this.state.contracts) return false

    // Check all services provisioned
    for (const serviceId of services) {
      const provision = this.state.provisions.find(
        (p) => p.serviceId === serviceId,
      )
      if (!provision) return false

      // Verify container running
      const isRunning = await this.isContainerRunning(provision.containerId)
      if (!isRunning) return false
    }

    // Verify Anvil has the contracts
    if (!(await this.isAnvilRunning())) return false

    return true
  }

  /**
   * Clean up all provisioned services
   */
  async cleanup(): Promise<void> {
    logger.step('Cleaning up provisioned services...')

    for (const provision of this.state.provisions) {
      await execa('docker', ['stop', provision.containerId], { reject: false })
      await execa('docker', ['rm', provision.containerId], { reject: false })
    }

    // Kill Anvil
    await execa('pkill', ['-f', 'anvil.*--port.*8545'], { reject: false })

    // Clear cache
    this.state = { contracts: null, provisions: [], providerId: null }
    this.saveState()

    logger.success('Cleanup complete')
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}

export function createDWSLocalProvisioner(
  rootDir: string,
): DWSLocalProvisioner {
  return new DWSLocalProvisioner(rootDir)
}
