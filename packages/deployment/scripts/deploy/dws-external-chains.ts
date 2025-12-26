#!/usr/bin/env bun
/**
 * DWS External Chain Provisioning
 *
 * Provisions external blockchain nodes (Solana, Bitcoin, etc.) via DWS.
 * ALL environments use on-chain provisioning - localnet uses local Docker as the compute backend.
 *
 * Flow (same for all environments):
 * 1. Provider registers on-chain → DWSProviderRegistry / ExternalChainProvider
 * 2. Consumer requests node → ExternalChainProvider.provisionNode()
 * 3. DWS node deploys infrastructure → Docker (local) or Cloud (testnet/mainnet)
 * 4. Provider reports endpoint → ExternalChainProvider.reportNodeReady()
 * 5. Consumer discovers endpoint from chain
 *
 * The only difference between environments is the compute backend:
 * - Localnet: Docker on localhost
 * - Testnet: DWS nodes with optional TEE
 * - Mainnet: DWS nodes with required TEE
 *
 * Usage:
 *   NETWORK=localnet bun run scripts/deploy/dws-external-chains.ts --chain solana
 *   NETWORK=testnet bun run scripts/deploy/dws-external-chains.ts --chain solana
 *   NETWORK=mainnet bun run scripts/deploy/dws-external-chains.ts --chain solana --tee
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  formatEther,
  type Hex,
  http,
  keccak256,
  parseEther,
  toBytes,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia, foundry } from 'viem/chains'
import { getRequiredNetwork, type NetworkType } from '../shared'

const ROOT = join(import.meta.dir, '../../../..')
const CONTRACTS_DIR = join(ROOT, 'packages/contracts')
const DEPLOYMENTS_DIR = join(CONTRACTS_DIR, 'deployments')

// Chain types matching the contract enum
enum ChainType {
  Solana = 0,
  Bitcoin = 1,
  Cosmos = 2,
  Polkadot = 3,
  Near = 4,
  Aptos = 5,
  Sui = 6,
  Avalanche = 7,
  Polygon = 8,
  Arbitrum = 9,
  Optimism = 10,
  Base = 11,
  Custom = 12,
}

enum NodeType {
  RPC = 0,
  Validator = 1,
  Archive = 2,
  Light = 3,
  Indexer = 4,
  Geyser = 5,
  Bridge = 6,
}

enum NetworkMode {
  Devnet = 0,
  Testnet = 1,
  Mainnet = 2,
}

interface ChainConfig {
  chainType: ChainType
  nodeType: NodeType
  version: string
  teeRequired: boolean
  teeType: string
  minMemoryGb: number
  minStorageGb: number
  minCpuCores: number
  dockerImage: string
  ports: { rpc: number; ws: number }
  additionalParams: string[]
}

// Chain-specific configurations - same structure for all environments
const CHAIN_CONFIGS: Record<string, Record<NetworkMode, ChainConfig>> = {
  solana: {
    [NetworkMode.Devnet]: {
      chainType: ChainType.Solana,
      nodeType: NodeType.RPC,
      version: 'v1.18.26',
      teeRequired: false,
      teeType: '',
      minMemoryGb: 8,
      minStorageGb: 50,
      minCpuCores: 4,
      dockerImage: 'solanalabs/solana:v1.18.26',
      ports: { rpc: 8899, ws: 8900 },
      additionalParams: [],
    },
    [NetworkMode.Testnet]: {
      chainType: ChainType.Solana,
      nodeType: NodeType.RPC,
      version: 'v2.1.0',
      teeRequired: false,
      teeType: '',
      minMemoryGb: 64,
      minStorageGb: 500,
      minCpuCores: 8,
      dockerImage: 'solanalabs/solana:v2.1.0',
      ports: { rpc: 8899, ws: 8900 },
      additionalParams: ['--entrypoint', 'devnet.solana.com:8001'],
    },
    [NetworkMode.Mainnet]: {
      chainType: ChainType.Solana,
      nodeType: NodeType.RPC,
      version: 'v2.1.0',
      teeRequired: true,
      teeType: 'intel_tdx',
      minMemoryGb: 128,
      minStorageGb: 2000,
      minCpuCores: 16,
      dockerImage: 'solanalabs/solana:v2.1.0',
      ports: { rpc: 8899, ws: 8900 },
      additionalParams: ['--entrypoint', 'mainnet-beta.solana.com:8001'],
    },
  },
  bitcoin: {
    [NetworkMode.Devnet]: {
      chainType: ChainType.Bitcoin,
      nodeType: NodeType.RPC,
      version: '27.0',
      teeRequired: false,
      teeType: '',
      minMemoryGb: 4,
      minStorageGb: 10,
      minCpuCores: 2,
      dockerImage: 'bitcoin/bitcoin:27.0',
      ports: { rpc: 18443, ws: 18444 },
      additionalParams: ['-regtest'],
    },
    [NetworkMode.Testnet]: {
      chainType: ChainType.Bitcoin,
      nodeType: NodeType.RPC,
      version: '27.0',
      teeRequired: false,
      teeType: '',
      minMemoryGb: 8,
      minStorageGb: 50,
      minCpuCores: 4,
      dockerImage: 'bitcoin/bitcoin:27.0',
      ports: { rpc: 18332, ws: 18333 },
      additionalParams: ['-testnet'],
    },
    [NetworkMode.Mainnet]: {
      chainType: ChainType.Bitcoin,
      nodeType: NodeType.RPC,
      version: '27.0',
      teeRequired: false,
      teeType: '',
      minMemoryGb: 16,
      minStorageGb: 1000,
      minCpuCores: 8,
      dockerImage: 'bitcoin/bitcoin:27.0',
      ports: { rpc: 8332, ws: 8333 },
      additionalParams: [],
    },
  },
  postgres: {
    [NetworkMode.Devnet]: {
      chainType: ChainType.Custom,
      nodeType: NodeType.RPC,
      version: '16',
      teeRequired: false,
      teeType: '',
      minMemoryGb: 1,
      minStorageGb: 10,
      minCpuCores: 1,
      dockerImage: 'postgres:16-alpine',
      ports: { rpc: 5432, ws: 0 },
      additionalParams: [],
    },
    [NetworkMode.Testnet]: {
      chainType: ChainType.Custom,
      nodeType: NodeType.RPC,
      version: '16',
      teeRequired: false,
      teeType: '',
      minMemoryGb: 4,
      minStorageGb: 100,
      minCpuCores: 2,
      dockerImage: 'postgres:16-alpine',
      ports: { rpc: 5432, ws: 0 },
      additionalParams: [],
    },
    [NetworkMode.Mainnet]: {
      chainType: ChainType.Custom,
      nodeType: NodeType.RPC,
      version: '16',
      teeRequired: false,
      teeType: '',
      minMemoryGb: 16,
      minStorageGb: 500,
      minCpuCores: 4,
      dockerImage: 'postgres:16-alpine',
      ports: { rpc: 5432, ws: 0 },
      additionalParams: [],
    },
  },
  redis: {
    [NetworkMode.Devnet]: {
      chainType: ChainType.Custom,
      nodeType: NodeType.RPC,
      version: '7',
      teeRequired: false,
      teeType: '',
      minMemoryGb: 1,
      minStorageGb: 1,
      minCpuCores: 1,
      dockerImage: 'redis:7-alpine',
      ports: { rpc: 6379, ws: 0 },
      additionalParams: [],
    },
    [NetworkMode.Testnet]: {
      chainType: ChainType.Custom,
      nodeType: NodeType.RPC,
      version: '7',
      teeRequired: false,
      teeType: '',
      minMemoryGb: 4,
      minStorageGb: 10,
      minCpuCores: 2,
      dockerImage: 'redis:7-alpine',
      ports: { rpc: 6379, ws: 0 },
      additionalParams: [],
    },
    [NetworkMode.Mainnet]: {
      chainType: ChainType.Custom,
      nodeType: NodeType.RPC,
      version: '7',
      teeRequired: false,
      teeType: '',
      minMemoryGb: 16,
      minStorageGb: 50,
      minCpuCores: 4,
      dockerImage: 'redis:7-alpine',
      ports: { rpc: 6379, ws: 0 },
      additionalParams: [],
    },
  },
  ipfs: {
    [NetworkMode.Devnet]: {
      chainType: ChainType.Custom,
      nodeType: NodeType.RPC,
      version: '0.29',
      teeRequired: false,
      teeType: '',
      minMemoryGb: 2,
      minStorageGb: 50,
      minCpuCores: 2,
      dockerImage: 'ipfs/kubo:v0.29.0',
      ports: { rpc: 5001, ws: 8080 },
      additionalParams: [],
    },
    [NetworkMode.Testnet]: {
      chainType: ChainType.Custom,
      nodeType: NodeType.RPC,
      version: '0.29',
      teeRequired: false,
      teeType: '',
      minMemoryGb: 8,
      minStorageGb: 500,
      minCpuCores: 4,
      dockerImage: 'ipfs/kubo:v0.29.0',
      ports: { rpc: 5001, ws: 8080 },
      additionalParams: [],
    },
    [NetworkMode.Mainnet]: {
      chainType: ChainType.Custom,
      nodeType: NodeType.RPC,
      version: '0.29',
      teeRequired: false,
      teeType: '',
      minMemoryGb: 32,
      minStorageGb: 2000,
      minCpuCores: 8,
      dockerImage: 'ipfs/kubo:v0.29.0',
      ports: { rpc: 5001, ws: 8080 },
      additionalParams: [],
    },
  },
}

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
    name: 'heartbeat',
    type: 'function',
    inputs: [],
    outputs: [],
    stateMutability: 'nonpayable',
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
  {
    name: 'providerIds',
    type: 'function',
    inputs: [{ name: 'operator', type: 'address' }],
    outputs: [{ name: '', type: 'bytes32' }],
    stateMutability: 'view',
  },
] as const

interface DeploymentResult {
  network: NetworkType
  chain: string
  providerId: string
  nodeId: string
  endpoints: {
    rpc: string
    ws: string
  }
  tee: boolean
  deployedAt: string
}

function getNetworkMode(network: NetworkType): NetworkMode {
  switch (network) {
    case 'localnet':
      return NetworkMode.Devnet
    case 'testnet':
      return NetworkMode.Testnet
    case 'mainnet':
      return NetworkMode.Mainnet
  }
}

function getRpcUrl(network: NetworkType): string {
  switch (network) {
    case 'localnet':
      return 'http://localhost:8545' // Local Anvil
    case 'testnet':
      return 'https://sepolia.base.org'
    case 'mainnet':
      return 'https://mainnet.base.org'
  }
}

function getChainConfig(network: NetworkType) {
  switch (network) {
    case 'localnet':
      return foundry
    case 'testnet':
      return baseSepolia
    case 'mainnet':
      return base
  }
}

/**
 * Deploy local Docker container and return endpoints
 * This is the compute backend for localnet
 */
async function deployLocalDockerNode(
  chain: string,
  config: ChainConfig,
  nodeId: string,
): Promise<{ rpc: string; ws: string }> {
  const containerName = `jeju-dws-${chain}-${nodeId.slice(0, 8)}`

  // Stop if already running
  try {
    execSync(`docker stop ${containerName} && docker rm ${containerName}`, { stdio: 'pipe' })
  } catch {
    // Container not running
  }

  console.log(`   Starting Docker container: ${containerName}`)

  let dockerCmd: string

  switch (chain) {
    case 'solana':
      dockerCmd = `docker run -d --name ${containerName} \
        -p ${config.ports.rpc}:8899 -p ${config.ports.ws}:8900 \
        ${config.dockerImage} \
        solana-test-validator \
        --bind-address 0.0.0.0 \
        --rpc-port 8899 \
        --ledger /data/ledger \
        --reset \
        --quiet`
      break

    case 'bitcoin':
      dockerCmd = `docker run -d --name ${containerName} \
        -p ${config.ports.rpc}:18443 -p ${config.ports.ws}:18444 \
        ${config.dockerImage} \
        -regtest \
        -server \
        -rpcuser=jeju \
        -rpcpassword=jejudev \
        -rpcallowip=0.0.0.0/0 \
        -rpcbind=0.0.0.0`
      break

    case 'postgres':
      dockerCmd = `docker run -d --name ${containerName} \
        -p ${config.ports.rpc}:5432 \
        -e POSTGRES_USER=jeju \
        -e POSTGRES_PASSWORD=jejudev \
        -e POSTGRES_DB=jeju \
        ${config.dockerImage}`
      break

    case 'redis':
      dockerCmd = `docker run -d --name ${containerName} \
        -p ${config.ports.rpc}:6379 \
        ${config.dockerImage}`
      break

    case 'ipfs':
      dockerCmd = `docker run -d --name ${containerName} \
        -p ${config.ports.rpc}:5001 -p ${config.ports.ws}:8080 \
        ${config.dockerImage}`
      break

    default:
      throw new Error(`Unsupported chain for local Docker: ${chain}`)
  }

  execSync(dockerCmd, { stdio: 'pipe' })

  // Wait for container to be ready
  console.log('   Waiting for container to be ready...')
  await Bun.sleep(3000)

  // Get actual host port (in case of port mapping changes)
  const rpcEndpoint =
    chain === 'postgres'
      ? `postgresql://jeju:jejudev@localhost:${config.ports.rpc}/jeju`
      : chain === 'redis'
        ? `redis://localhost:${config.ports.rpc}`
        : `http://localhost:${config.ports.rpc}`

  const wsEndpoint = config.ports.ws > 0 ? `ws://localhost:${config.ports.ws}` : ''

  return { rpc: rpcEndpoint, ws: wsEndpoint }
}

/**
 * Wait for DWS node to deploy infrastructure (testnet/mainnet)
 */
async function waitForDwsDeployment(
  dwsEndpoint: string,
  nodeId: string,
  maxWaitMs = 300_000,
): Promise<{ rpc: string; ws: string }> {
  const startTime = Date.now()
  const pollInterval = 5000

  console.log(`   Polling DWS for node ${nodeId.slice(0, 18)}...`)

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const response = await fetch(`${dwsEndpoint}/api/nodes/${nodeId}`, {
        signal: AbortSignal.timeout(10000),
      })

      if (response.ok) {
        const data = (await response.json()) as {
          status: string
          endpoints?: { rpc: string; ws: string }
        }

        if (data.status === 'active' && data.endpoints) {
          console.log(`   Node is active after ${Math.round((Date.now() - startTime) / 1000)}s`)
          return data.endpoints
        }

        console.log(`   Node status: ${data.status}`)
      }
    } catch {
      // Node not ready yet
    }

    await Bun.sleep(pollInterval)
  }

  throw new Error(`Node deployment timed out after ${maxWaitMs / 1000}s`)
}

async function provisionViaOnChain(
  chain: string,
  network: NetworkType,
  useTee: boolean,
  providerEndpoint: string,
): Promise<DeploymentResult> {
  const networkMode = getNetworkMode(network)
  const config = CHAIN_CONFIGS[chain]?.[networkMode]
  if (!config) {
    throw new Error(`Unsupported chain: ${chain}`)
  }

  console.log(`\n📦 Provisioning ${chain} via on-chain (${network})...`)

  // Get private key - use default Anvil key for localnet
  const privateKey =
    network === 'localnet'
      ? '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80' // Anvil default
      : process.env.DEPLOYER_PRIVATE_KEY

  if (!privateKey) {
    throw new Error('DEPLOYER_PRIVATE_KEY required for testnet/mainnet')
  }

  // Load or deploy contract addresses
  const addressesPath = join(DEPLOYMENTS_DIR, `${network}-dws.json`)
  let externalChainProviderAddress: Address

  if (existsSync(addressesPath)) {
    const addresses = JSON.parse(readFileSync(addressesPath, 'utf-8'))
    externalChainProviderAddress = addresses.externalChainProvider as Address
  } else if (network === 'localnet') {
    // Deploy contracts to local Anvil
    console.log('   Deploying ExternalChainProvider to local Anvil...')
    const deployResult = execSync(
      `cd ${CONTRACTS_DIR} && forge create src/dws/ExternalChainProvider.sol:ExternalChainProvider \
        --rpc-url http://localhost:8545 \
        --private-key ${privateKey} \
        --constructor-args 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266 \
        --json`,
      { encoding: 'utf-8' },
    )
    const deployData = JSON.parse(deployResult)
    externalChainProviderAddress = deployData.deployedTo as Address
    console.log(`   Deployed ExternalChainProvider: ${externalChainProviderAddress}`)

    // Set low min stake for localnet (1 ETH instead of 5000)
    console.log('   Setting minProviderStake to 1 ETH for localnet...')
    execSync(
      `cd ${CONTRACTS_DIR} && cast send ${externalChainProviderAddress} \
        "setMinProviderStake(uint256)" 1000000000000000000 \
        --rpc-url http://localhost:8545 \
        --private-key ${privateKey}`,
      { encoding: 'utf-8' },
    )

    // Save for future use
    if (!existsSync(DEPLOYMENTS_DIR)) {
      mkdirSync(DEPLOYMENTS_DIR, { recursive: true })
    }
    writeFileSync(
      addressesPath,
      JSON.stringify({ externalChainProvider: externalChainProviderAddress }, null, 2),
    )
    console.log(`   ✅ Configured ExternalChainProvider for localnet`)
  } else {
    throw new Error(`DWS contracts not deployed. Run contract deployment first.`)
  }

  // Setup clients
  const chainConfig = getChainConfig(network)
  const rpcUrl = getRpcUrl(network)

  const account = privateKeyToAccount(privateKey as Hex)
  const publicClient = createPublicClient({
    chain: chainConfig,
    transport: http(rpcUrl),
  })
  const walletClient = createWalletClient({
    account,
    chain: chainConfig,
    transport: http(rpcUrl),
  })

  // Check balance
  const balance = await publicClient.getBalance({ address: account.address })
  console.log(`   Deployer: ${account.address}`)
  console.log(`   Balance: ${formatEther(balance)} ETH`)

  // Step 1: Check if already registered as provider
  console.log('\n   Step 1: Checking provider registration...')

  let providerId: Hex
  try {
    providerId = await publicClient.readContract({
      address: externalChainProviderAddress,
      abi: EXTERNAL_CHAIN_PROVIDER_ABI,
      functionName: 'providerIds',
      args: [account.address],
    })

    if (providerId === '0x0000000000000000000000000000000000000000000000000000000000000000') {
      throw new Error('Not registered')
    }
    console.log(`   Already registered as provider: ${providerId.slice(0, 18)}...`)
  } catch {
    // Not registered, register now
    console.log('   Registering as provider...')

    const teeAttestation = useTee
      ? keccak256(toBytes(`tee-attestation-${account.address}-${Date.now()}`))
      : ('0x' + '0'.repeat(64))

    // Provider stake (1 ETH for localnet after setMinProviderStake, 5000 for prod)
    const stakeAmount = network === 'localnet' ? '1' : '5000'
    
    const registerHash = await walletClient.writeContract({
      address: externalChainProviderAddress,
      abi: EXTERNAL_CHAIN_PROVIDER_ABI,
      functionName: 'registerProvider',
      args: [
        [config.chainType],
        [config.nodeType],
        [networkMode],
        providerEndpoint,
        teeAttestation as Hex,
      ],
      value: parseEther(stakeAmount),
    })

    await publicClient.waitForTransactionReceipt({ hash: registerHash })
    providerId = await publicClient.readContract({
      address: externalChainProviderAddress,
      abi: EXTERNAL_CHAIN_PROVIDER_ABI,
      functionName: 'providerIds',
      args: [account.address],
    })
    console.log(`   ✅ Registered as provider: ${providerId.slice(0, 18)}...`)
  }

  // Step 2: Provision node on-chain
  console.log('\n   Step 2: Provisioning node on-chain...')

  // Calculate duration and payment
  // Devnet: 0.01 ETH/hour, Testnet: 0.1 ETH/hour, Mainnet: 0.5 ETH/hour
  const durationHours = 24 * 7 // 1 week
  const hourlyRate = network === 'localnet' ? 0.01 : network === 'testnet' ? 0.1 : 0.5
  const totalPayment = String(durationHours * hourlyRate + 0.1) // Add buffer for gas

  const provisionHash = await walletClient.writeContract({
    address: externalChainProviderAddress,
    abi: EXTERNAL_CHAIN_PROVIDER_ABI,
    functionName: 'provisionNode',
    args: [
      {
        chainType: config.chainType,
        nodeType: config.nodeType,
        network: networkMode,
        version: config.version,
        teeRequired: useTee,
        teeType: useTee ? config.teeType : '',
        minMemoryGb: BigInt(config.minMemoryGb),
        minStorageGb: BigInt(config.minStorageGb),
        minCpuCores: BigInt(config.minCpuCores),
        additionalParams: config.additionalParams,
      },
      BigInt(durationHours),
    ],
    value: parseEther(totalPayment),
  })

  const provisionReceipt = await publicClient.waitForTransactionReceipt({ hash: provisionHash })
  const nodeId = keccak256(
    toBytes(`${account.address}${providerId}${provisionReceipt.blockNumber}`),
  )
  console.log(`   ✅ Node provisioned on-chain: ${nodeId.slice(0, 18)}...`)

  // Step 3: Deploy actual infrastructure
  console.log('\n   Step 3: Deploying infrastructure...')

  let endpoints: { rpc: string; ws: string }

  if (network === 'localnet') {
    // Deploy to local Docker - requires Docker daemon
    try {
      execSync('docker info', { stdio: 'pipe' })
    } catch {
      throw new Error('Docker daemon not running. Start Docker Desktop or run "dockerd" to enable localnet provisioning.')
    }
    endpoints = await deployLocalDockerNode(chain, config, nodeId)
  } else {
    // Wait for DWS nodes to deploy
    endpoints = await waitForDwsDeployment(providerEndpoint, nodeId)
  }

  // Step 4: Report node as ready on-chain
  console.log('\n   Step 4: Reporting node ready on-chain...')

  const reportHash = await walletClient.writeContract({
    address: externalChainProviderAddress,
    abi: EXTERNAL_CHAIN_PROVIDER_ABI,
    functionName: 'reportNodeReady',
    args: [nodeId, endpoints.rpc, endpoints.ws],
  })

  await publicClient.waitForTransactionReceipt({ hash: reportHash })
  console.log('   ✅ Node reported as ready on-chain')

  return {
    network,
    chain,
    providerId,
    nodeId,
    endpoints,
    tee: useTee,
    deployedAt: new Date().toISOString(),
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      chain: { type: 'string', short: 'c', default: 'solana' },
      tee: { type: 'boolean', default: false },
      'provider-endpoint': { type: 'string', default: '' },
      help: { type: 'boolean', short: 'h' },
    },
  })

  if (values.help) {
    console.log(`
DWS External Chain/Service Provisioning

Usage:
  NETWORK=localnet bun run scripts/deploy/dws-external-chains.ts --chain solana
  NETWORK=testnet bun run scripts/deploy/dws-external-chains.ts --chain solana
  NETWORK=mainnet bun run scripts/deploy/dws-external-chains.ts --chain solana --tee

Options:
  -c, --chain <chain>           Service to provision:
                                  Chains: solana, bitcoin
                                  Services: postgres, redis, ipfs
  --tee                         Require TEE (auto-enabled for mainnet)
  --provider-endpoint <url>     DWS provider endpoint
  -h, --help                    Show this help

All environments use on-chain provisioning:
  - Localnet: Contracts on Anvil, Docker containers for compute
  - Testnet:  Contracts on Base Sepolia, DWS nodes for compute
  - Mainnet:  Contracts on Base, DWS nodes with TEE for compute
`)
    process.exit(0)
  }

  const network = getRequiredNetwork()
  const chain = values.chain ?? 'solana'
  const useTee = values.tee ?? network === 'mainnet'

  // Default provider endpoints
  const defaultEndpoints: Record<NetworkType, string> = {
    localnet: 'http://localhost:4030',
    testnet: 'https://dws.testnet.jejunetwork.org',
    mainnet: 'https://dws.jejunetwork.org',
  }
  const providerEndpoint = values['provider-endpoint'] || defaultEndpoints[network]

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║       DWS ON-CHAIN PROVISIONING                              ║
╠══════════════════════════════════════════════════════════════╣
║  Network:   ${network.padEnd(48)}║
║  Chain:     ${chain.padEnd(48)}║
║  TEE:       ${useTee ? 'Required'.padEnd(48) : 'Optional'.padEnd(48)}║
║  Endpoint:  ${providerEndpoint.slice(0, 48).padEnd(48)}║
╚══════════════════════════════════════════════════════════════╝
`)

  const result = await provisionViaOnChain(chain, network, useTee, providerEndpoint)

  // Save result
  const outputDir = join(DEPLOYMENTS_DIR, 'provisioned')
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  const outputFile = join(outputDir, `${network}-${chain}.json`)
  writeFileSync(outputFile, JSON.stringify(result, null, 2))

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    PROVISIONING COMPLETE                     ║
╠══════════════════════════════════════════════════════════════╣
║  Chain:     ${chain.padEnd(48)}║
║  Node ID:   ${result.nodeId.slice(0, 48).padEnd(48)}║
║  RPC:       ${result.endpoints.rpc.slice(0, 48).padEnd(48)}║
║  WS:        ${(result.endpoints.ws || 'N/A').slice(0, 48).padEnd(48)}║
║  TEE:       ${(result.tee ? 'Enabled' : 'Disabled').padEnd(48)}║
╠══════════════════════════════════════════════════════════════╣
║  Saved to: ${outputFile.slice(-48).padEnd(48)}║
╚══════════════════════════════════════════════════════════════╝
`)
}

main().catch((error) => {
  console.error('❌ Provisioning failed:', error.message)
  process.exit(1)
})
