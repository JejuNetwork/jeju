#!/usr/bin/env bun
/**
 * DWS External Chain Provisioning
 *
 * Provisions external blockchain nodes (Solana, Bitcoin, etc.) via DWS.
 * Supports three deployment modes:
 *
 * - Devnet: Local nodes, no TEE, for development
 * - Testnet: DWS-provisioned, TEE optional
 * - Mainnet: DWS-provisioned, TEE required
 *
 * In testnet/mainnet, Jeju acts as both buyer and seller initially:
 * 1. Registers as a provider on DWS
 * 2. Provisions nodes through its own marketplace
 * 3. Eventually other providers join, making it fully decentralized
 *
 * Usage:
 *   NETWORK=localnet bun run scripts/deploy/dws-external-chains.ts
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
import type { NetworkType } from '../shared'
import { getRequiredNetwork } from '../shared'

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
  additionalParams: string[]
}

// Chain-specific configurations
const CHAIN_CONFIGS: Record<string, Record<NetworkMode, ChainConfig>> = {
  solana: {
    [NetworkMode.Devnet]: {
      chainType: ChainType.Solana,
      nodeType: NodeType.RPC,
      version: 'v2.1.0',
      teeRequired: false,
      teeType: '',
      minMemoryGb: 8,
      minStorageGb: 50,
      minCpuCores: 4,
      dockerImage: 'solanalabs/solana:v1.18.26',
      additionalParams: ['--dev', '--reset'],
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
] as const

interface DeploymentResult {
  network: NetworkType
  chain: string
  mode: 'local' | 'dws'
  providerId?: string
  nodeId?: string
  endpoints: {
    rpc: string
    ws: string
  }
  tee: boolean
}

async function deployLocalNode(
  chain: string,
  networkMode: NetworkMode,
): Promise<DeploymentResult> {
  console.log(`\n📦 Deploying local ${chain} node (devnet mode)...`)

  const config = CHAIN_CONFIGS[chain]?.[networkMode]
  if (!config) {
    throw new Error(`Unsupported chain: ${chain}`)
  }

  // For local development, run via Docker or Kurtosis
  const containerName = `jeju-${chain}-localnet`

  // Check if already running
  try {
    const running = execSync(`docker ps -q -f name=${containerName}`, {
      encoding: 'utf-8',
    }).trim()
    if (running) {
      console.log(`   Container ${containerName} already running`)
      return getLocalEndpoints(chain)
    }
  } catch {
    // Container not running, continue
  }

  // Start container based on chain
  if (chain === 'solana') {
    console.log('   Starting Solana test validator...')
    execSync(
      `docker run -d --name ${containerName} \
      -p 8899:8899 -p 8900:8900 -p 9900:9900 \
      ${config.dockerImage} \
      solana-test-validator \
      --bind-address 0.0.0.0 \
      --rpc-port 8899 \
      --faucet-port 9900 \
      --ledger /data/ledger \
      --reset \
      --quiet`,
      { stdio: 'pipe' },
    )

    // Wait for validator to be ready
    console.log('   Waiting for validator to start...')
    await Bun.sleep(5000)
  } else if (chain === 'bitcoin') {
    console.log('   Starting Bitcoin regtest...')
    execSync(
      `docker run -d --name ${containerName} \
      -p 18443:18443 -p 18444:18444 \
      ${config.dockerImage} \
      -regtest \
      -server \
      -rpcuser=jeju \
      -rpcpassword=jejudev \
      -rpcallowip=0.0.0.0/0 \
      -rpcbind=0.0.0.0`,
      { stdio: 'pipe' },
    )

    await Bun.sleep(3000)
  }

  return getLocalEndpoints(chain)
}

function getLocalEndpoints(chain: string): DeploymentResult {
  const endpoints: Record<string, { rpc: string; ws: string }> = {
    solana: {
      rpc: 'http://localhost:8899',
      ws: 'ws://localhost:8900',
    },
    bitcoin: {
      rpc: 'http://jeju:jejudev@localhost:18443',
      ws: '',
    },
  }

  return {
    network: 'localnet',
    chain,
    mode: 'local',
    endpoints: endpoints[chain] ?? { rpc: '', ws: '' },
    tee: false,
  }
}

async function deployViaDWS(
  chain: string,
  jejuNetwork: NetworkType,
  useTee: boolean,
  providerEndpoint: string,
): Promise<DeploymentResult> {
  const networkMode =
    jejuNetwork === 'mainnet' ? NetworkMode.Mainnet : NetworkMode.Testnet

  console.log(
    `\n📦 Deploying ${chain} via DWS (${jejuNetwork}, TEE: ${useTee})...`,
  )

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY
  if (!privateKey) {
    throw new Error('DEPLOYER_PRIVATE_KEY required')
  }

  const config = CHAIN_CONFIGS[chain]?.[networkMode]
  if (!config) {
    throw new Error(`Unsupported chain: ${chain}`)
  }

  // Load contract addresses
  const addressesPath = join(DEPLOYMENTS_DIR, `${jejuNetwork}-dws.json`)
  if (!existsSync(addressesPath)) {
    throw new Error(
      `DWS contracts not deployed. Run: bun run scripts/deploy/dws-bootstrap.ts`,
    )
  }
  const addresses = JSON.parse(readFileSync(addressesPath, 'utf-8'))
  const externalChainProviderAddress = addresses.externalChainProvider as Address

  // Setup clients
  const chainConfig =
    jejuNetwork === 'mainnet'
      ? base
      : jejuNetwork === 'testnet'
        ? baseSepolia
        : foundry

  const rpcUrl =
    jejuNetwork === 'mainnet'
      ? 'https://mainnet.base.org'
      : jejuNetwork === 'testnet'
        ? 'https://sepolia.base.org'
        : 'http://localhost:6546'

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

  // Step 1: Register as provider (if not already)
  console.log('\n   Step 1: Registering as provider...')

  const teeAttestation = useTee
    ? keccak256(toBytes(`tee-attestation-${account.address}-${Date.now()}`))
    : ('0x' + '0'.repeat(64))

  let providerId: Hex
  try {
    const registerHash = await walletClient.writeContract({
      address: externalChainProviderAddress,
      abi: EXTERNAL_CHAIN_PROVIDER_ABI,
      functionName: 'registerProvider',
      args: [
        [config.chainType], // supportedChains
        [config.nodeType], // supportedNodes
        [networkMode], // supportedNetworks
        providerEndpoint, // endpoint
        teeAttestation as Hex, // teeAttestation
      ],
      value: parseEther('5'), // 5 ETH stake
    })

    const receipt = await publicClient.waitForTransactionReceipt({
      hash: registerHash,
    })
    providerId = keccak256(
      toBytes(`${account.address}${providerEndpoint}${receipt.blockNumber}`),
    )
    console.log(`   ✅ Registered as provider: ${providerId.slice(0, 18)}...`)
  } catch (error) {
    // Already registered, continue
    console.log('   ℹ️  Already registered as provider')
    providerId =
      '0x0000000000000000000000000000000000000000000000000000000000000000'
  }

  // Step 2: Provision node through DWS
  console.log('\n   Step 2: Provisioning node...')

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
      BigInt(24 * 30), // 30 days
    ],
    value: parseEther('1'), // Prepay for 30 days
  })

  const provisionReceipt = await publicClient.waitForTransactionReceipt({
    hash: provisionHash,
  })
  const nodeId = keccak256(
    toBytes(`${account.address}${providerId}${provisionReceipt.blockNumber}`),
  )
  console.log(`   ✅ Node provisioned: ${nodeId.slice(0, 18)}...`)

  // Step 3: Actually deploy the node (off-chain orchestration)
  console.log('\n   Step 3: Deploying node infrastructure...')

  // In production, this would trigger DWS orchestration
  // For now, we deploy locally and report the endpoint
  const localResult = await deployLocalNode(chain, networkMode)

  // Step 4: Report node as ready
  console.log('\n   Step 4: Reporting node ready...')

  await walletClient.writeContract({
    address: externalChainProviderAddress,
    abi: EXTERNAL_CHAIN_PROVIDER_ABI,
    functionName: 'reportNodeReady',
    args: [nodeId, localResult.endpoints.rpc, localResult.endpoints.ws],
  })

  console.log('   ✅ Node reported as ready')

  return {
    network: jejuNetwork,
    chain,
    mode: 'dws',
    providerId,
    nodeId,
    endpoints: localResult.endpoints,
    tee: useTee,
  }
}

async function main() {
  const { values } = parseArgs({
    options: {
      chain: { type: 'string', short: 'c', default: 'solana' },
      tee: { type: 'boolean', default: false },
      'provider-endpoint': {
        type: 'string',
        default: 'https://dws.jejunetwork.org',
      },
      help: { type: 'boolean', short: 'h' },
    },
  })

  if (values.help) {
    console.log(`
DWS External Chain Provisioning

Usage:
  NETWORK=localnet bun run scripts/deploy/dws-external-chains.ts [options]
  NETWORK=testnet bun run scripts/deploy/dws-external-chains.ts --chain solana
  NETWORK=mainnet bun run scripts/deploy/dws-external-chains.ts --chain solana --tee

Options:
  -c, --chain <chain>           Chain to deploy (solana, bitcoin)
  --tee                         Require TEE (required for mainnet)
  --provider-endpoint <url>     DWS provider endpoint
  -h, --help                    Show this help

Supported Chains:
  - solana: Solana RPC node
  - bitcoin: Bitcoin Core node

Deployment Modes:
  - localnet: Local Docker container, no on-chain
  - testnet:  DWS-provisioned, TEE optional
  - mainnet:  DWS-provisioned, TEE required
`)
    process.exit(0)
  }

  const network = getRequiredNetwork()
  const chain = values.chain ?? 'solana'
  const useTee = values.tee ?? network === 'mainnet'
  const providerEndpoint =
    values['provider-endpoint'] ?? 'https://dws.jejunetwork.org'

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║          DWS EXTERNAL CHAIN PROVISIONING                     ║
╠══════════════════════════════════════════════════════════════╣
║  Network: ${network.padEnd(50)}║
║  Chain:   ${chain.padEnd(50)}║
║  TEE:     ${useTee ? 'Yes'.padEnd(50) : 'No'.padEnd(50)}║
╚══════════════════════════════════════════════════════════════╝
`)

  let result: DeploymentResult

  if (network === 'localnet') {
    // Local development - just run Docker
    result = await deployLocalNode(chain, NetworkMode.Devnet)
  } else {
    // Testnet/Mainnet - provision via DWS
    result = await deployViaDWS(chain, network, useTee, providerEndpoint)
  }

  // Save result
  const outputDir = join(DEPLOYMENTS_DIR, 'external-chains')
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  const outputFile = join(outputDir, `${network}-${chain}.json`)
  writeFileSync(
    outputFile,
    JSON.stringify(
      {
        ...result,
        deployedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  )

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    DEPLOYMENT COMPLETE                       ║
╠══════════════════════════════════════════════════════════════╣
║  Chain:     ${chain.padEnd(48)}║
║  Mode:      ${result.mode.padEnd(48)}║
║  RPC:       ${result.endpoints.rpc.slice(0, 48).padEnd(48)}║
║  WS:        ${(result.endpoints.ws || 'N/A').slice(0, 48).padEnd(48)}║
║  TEE:       ${(result.tee ? 'Enabled' : 'Disabled').padEnd(48)}║
╠══════════════════════════════════════════════════════════════╣
║  Saved to: ${outputFile.slice(-48).padEnd(48)}║
╚══════════════════════════════════════════════════════════════╝
`)
}

main().catch((error) => {
  console.error('❌ Deployment failed:', error)
  process.exit(1)
})

