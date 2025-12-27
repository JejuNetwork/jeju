#!/usr/bin/env bun
/**
 * DWS External Chain Provisioning
 *
 * Provisions archive nodes for all external blockchains via DWS.
 * Deploys all EVM chains and Solana by default.
 *
 * Deployment Modes (based on NETWORK env):
 * - localnet: Anvil forks mainnet (real Chainlink feeds) - for production mode locally
 * - testnet:  DWS-provisioned reth/nitro nodes, TEE optional
 * - mainnet:  DWS-provisioned full archive nodes, TEE required
 *
 * Usage:
 *   NETWORK=localnet bun run scripts/deploy/dws-external-chains.ts
 *   NETWORK=testnet bun run scripts/deploy/dws-external-chains.ts
 *   NETWORK=mainnet bun run scripts/deploy/dws-external-chains.ts
 */

import { execSync } from 'node:child_process'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
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

// All chains to deploy - always deploy everything
const ALL_CHAINS = ['ethereum', 'arbitrum', 'optimism', 'base', 'solana']

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
  Ethereum = 13,
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
  evmChainId?: number
  forkUrl?: string
  rpcPort?: number
  wsPort?: number
}

// Chain configurations for all modes
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

  ethereum: {
    [NetworkMode.Devnet]: {
      chainType: ChainType.Ethereum,
      nodeType: NodeType.Archive,
      version: 'v1.1.5',
      teeRequired: false,
      teeType: '',
      minMemoryGb: 8,
      minStorageGb: 50,
      minCpuCores: 4,
      dockerImage: 'ghcr.io/foundry-rs/foundry:latest',
      ports: { rpc: 8545, ws: 8546 },
      additionalParams: [],
      evmChainId: 1,
      forkUrl: 'https://1rpc.io/eth',
      rpcPort: 8545,
      wsPort: 8546,
    },
    [NetworkMode.Testnet]: {
      chainType: ChainType.Ethereum,
      nodeType: NodeType.Archive,
      version: 'v1.1.5',
      teeRequired: false,
      teeType: '',
      minMemoryGb: 32,
      minStorageGb: 500,
      minCpuCores: 8,
      dockerImage: 'ghcr.io/paradigmxyz/reth:v1.1.5',
      ports: { rpc: 8545, ws: 8546 },
      additionalParams: [
        '--chain',
        'mainnet',
        '--http',
        '--http.api',
        'all',
        '--ws',
        '--ws.api',
        'all',
      ],
      evmChainId: 1,
      rpcPort: 8545,
      wsPort: 8546,
    },
    [NetworkMode.Mainnet]: {
      chainType: ChainType.Ethereum,
      nodeType: NodeType.Archive,
      version: 'v1.1.5',
      teeRequired: true,
      teeType: 'intel_tdx',
      minMemoryGb: 64,
      minStorageGb: 2500,
      minCpuCores: 16,
      dockerImage: 'ghcr.io/paradigmxyz/reth:v1.1.5',
      ports: { rpc: 8545, ws: 8546 },
      additionalParams: [
        '--chain',
        'mainnet',
        '--http',
        '--http.api',
        'all',
        '--ws',
        '--ws.api',
        'all',
        '--full',
      ],
      evmChainId: 1,
      rpcPort: 8545,
      wsPort: 8546,
    },
  },

  arbitrum: {
    [NetworkMode.Devnet]: {
      chainType: ChainType.Arbitrum,
      nodeType: NodeType.Archive,
      version: 'v3.2.1',
      teeRequired: false,
      teeType: '',
      minMemoryGb: 8,
      minStorageGb: 50,
      minCpuCores: 4,
      dockerImage: 'ghcr.io/foundry-rs/foundry:latest',
      ports: { rpc: 8547, ws: 8548 },
      additionalParams: [],
      evmChainId: 42161,
      forkUrl: 'https://arb1.arbitrum.io/rpc',
      rpcPort: 8547,
      wsPort: 8548,
    },
    [NetworkMode.Testnet]: {
      chainType: ChainType.Arbitrum,
      nodeType: NodeType.Archive,
      version: 'v3.2.1',
      teeRequired: false,
      teeType: '',
      minMemoryGb: 32,
      minStorageGb: 300,
      minCpuCores: 8,
      dockerImage: 'offchainlabs/nitro-node:v3.2.1-d1c5a49',
      ports: { rpc: 8547, ws: 8548 },
      additionalParams: [
        '--chain.id=42161',
        '--http.api=net,web3,eth,arb,debug',
        '--http.vhosts=*',
        '--http.addr=0.0.0.0',
      ],
      evmChainId: 42161,
      rpcPort: 8547,
      wsPort: 8548,
    },
    [NetworkMode.Mainnet]: {
      chainType: ChainType.Arbitrum,
      nodeType: NodeType.Archive,
      version: 'v3.2.1',
      teeRequired: true,
      teeType: 'intel_tdx',
      minMemoryGb: 64,
      minStorageGb: 1000,
      minCpuCores: 16,
      dockerImage: 'offchainlabs/nitro-node:v3.2.1-d1c5a49',
      ports: { rpc: 8547, ws: 8548 },
      additionalParams: [
        '--chain.id=42161',
        '--http.api=net,web3,eth,arb,debug',
        '--http.vhosts=*',
        '--http.addr=0.0.0.0',
        '--execution.caching.archive',
      ],
      evmChainId: 42161,
      rpcPort: 8547,
      wsPort: 8548,
    },
  },

  optimism: {
    [NetworkMode.Devnet]: {
      chainType: ChainType.Optimism,
      nodeType: NodeType.Archive,
      version: 'v1.9.4',
      teeRequired: false,
      teeType: '',
      minMemoryGb: 8,
      minStorageGb: 50,
      minCpuCores: 4,
      dockerImage: 'ghcr.io/foundry-rs/foundry:latest',
      ports: { rpc: 8549, ws: 8550 },
      additionalParams: [],
      evmChainId: 10,
      forkUrl: 'https://mainnet.optimism.io',
      rpcPort: 8549,
      wsPort: 8550,
    },
    [NetworkMode.Testnet]: {
      chainType: ChainType.Optimism,
      nodeType: NodeType.Archive,
      version: 'v1.9.4',
      teeRequired: false,
      teeType: '',
      minMemoryGb: 32,
      minStorageGb: 300,
      minCpuCores: 8,
      dockerImage: 'ghcr.io/paradigmxyz/op-reth:v1.1.5',
      ports: { rpc: 8549, ws: 8550 },
      additionalParams: [
        '--chain',
        'optimism',
        '--http',
        '--http.api',
        'all',
        '--ws',
        '--ws.api',
        'all',
      ],
      evmChainId: 10,
      rpcPort: 8549,
      wsPort: 8550,
    },
    [NetworkMode.Mainnet]: {
      chainType: ChainType.Optimism,
      nodeType: NodeType.Archive,
      version: 'v1.9.4',
      teeRequired: true,
      teeType: 'intel_tdx',
      minMemoryGb: 64,
      minStorageGb: 800,
      minCpuCores: 16,
      dockerImage: 'ghcr.io/paradigmxyz/op-reth:v1.1.5',
      ports: { rpc: 8549, ws: 8550 },
      additionalParams: [
        '--chain',
        'optimism',
        '--http',
        '--http.api',
        'all',
        '--ws',
        '--ws.api',
        'all',
        '--full',
      ],
      evmChainId: 10,
      rpcPort: 8549,
      wsPort: 8550,
    },
  },

  base: {
    [NetworkMode.Devnet]: {
      chainType: ChainType.Base,
      nodeType: NodeType.Archive,
      version: 'v1.9.4',
      teeRequired: false,
      teeType: '',
      minMemoryGb: 8,
      minStorageGb: 50,
      minCpuCores: 4,
      dockerImage: 'ghcr.io/foundry-rs/foundry:latest',
      ports: { rpc: 8551, ws: 8552 },
      additionalParams: [],
      evmChainId: 8453,
      forkUrl: 'https://mainnet.base.org',
      rpcPort: 8551,
      wsPort: 8552,
    },
    [NetworkMode.Testnet]: {
      chainType: ChainType.Base,
      nodeType: NodeType.Archive,
      version: 'v1.9.4',
      teeRequired: false,
      teeType: '',
      minMemoryGb: 32,
      minStorageGb: 300,
      minCpuCores: 8,
      dockerImage: 'ghcr.io/paradigmxyz/op-reth:v1.1.5',
      ports: { rpc: 8551, ws: 8552 },
      additionalParams: [
        '--chain',
        'base',
        '--http',
        '--http.api',
        'all',
        '--ws',
        '--ws.api',
        'all',
      ],
      evmChainId: 8453,
      rpcPort: 8551,
      wsPort: 8552,
    },
    [NetworkMode.Mainnet]: {
      chainType: ChainType.Base,
      nodeType: NodeType.Archive,
      version: 'v1.9.4',
      teeRequired: true,
      teeType: 'intel_tdx',
      minMemoryGb: 64,
      minStorageGb: 600,
      minCpuCores: 16,
      dockerImage: 'ghcr.io/paradigmxyz/op-reth:v1.1.5',
      ports: { rpc: 8551, ws: 8552 },
      additionalParams: [
        '--chain',
        'base',
        '--http',
        '--http.api',
        'all',
        '--ws',
        '--ws.api',
        'all',
        '--full',
      ],
      evmChainId: 8453,
      rpcPort: 8551,
      wsPort: 8552,
    },
  },
}

// Contract ABI for on-chain provisioning
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
 * Used for localnet "production mode" - forks mainnet for real data
 */
async function deployLocalNode(
  chain: string,
  config: ChainConfig,
  nodeId: string,
): Promise<{ rpc: string; ws: string }> {
  const containerName = `jeju-${chain}-${nodeId.slice(0, 8)}`

  // Check if already running
  try {
    const running = execSync(`docker ps -q -f name=${containerName}`, {
      encoding: 'utf-8',
    }).trim()
    if (running) {
      console.log(`    Already running`)
      const rpcPort = config.rpcPort ?? config.ports.rpc
      const wsPort = config.wsPort ?? config.ports.ws
      return {
        rpc: `http://localhost:${rpcPort}`,
        ws: wsPort ? `ws://localhost:${wsPort}` : '',
      }
    }
  } catch {
    // Not running
  }

  // Remove stopped container if exists
  try {
    const existing = execSync(`docker ps -aq -f name=${containerName}`, {
      encoding: 'utf-8',
    }).trim()
    if (existing) {
      console.log(`    Removing stopped container...`)
      execSync(`docker rm -f ${containerName}`, { stdio: 'pipe' })
    }
  } catch {
    // No existing container
  }

  // Start container based on chain type
  if (chain === 'solana') {
    console.log('    Starting Solana test validator...')
    // Detect ARM architecture and add --no-bpf-jit flag for compatibility
    const arch = process.arch
    const isArm = arch === 'arm64' || arch === 'arm'
    const bpfFlag = isArm ? '--no-bpf-jit' : ''

    execSync(
      `docker run -d --name ${containerName} \
      --platform linux/amd64 \
      -p 8899:8899 -p 8900:8900 -p 9900:9900 \
      ${config.dockerImage} \
      solana-test-validator \
      --bind-address 0.0.0.0 \
      --rpc-port 8899 \
      --faucet-port 9900 \
      --ledger /data/ledger \
      ${bpfFlag} \
      --reset \
      --quiet`,
      { stdio: 'pipe' },
    )
    await Bun.sleep(8000) // Give time for startup
  } else if (config.evmChainId && config.forkUrl) {
    const rpcPort = config.rpcPort ?? 8545
    console.log(`    Starting Anvil fork (${config.forkUrl})...`)

    execSync(
      `docker run -d --name ${containerName} \
      -p ${rpcPort}:8545 \
      --entrypoint anvil \
      ${config.dockerImage} \
      --fork-url ${config.forkUrl} \
      --chain-id ${config.evmChainId} \
      --host 0.0.0.0 \
      --port 8545 \
      --block-time 2`,
      { stdio: 'pipe' },
    )
    await Bun.sleep(10000) // Give time for fork to sync

    // Verify fork is working
    try {
      const response = await fetch(`http://localhost:${rpcPort}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0',
          method: 'eth_blockNumber',
          params: [],
          id: 1,
        }),
      })
      const result = (await response.json()) as { result?: string }
      const blockNumber = parseInt(result.result ?? '0', 16)
      console.log(`    Block: ${blockNumber}, Chain ID: ${config.evmChainId}`)
    } catch (err) {
      console.log(`    Warning: Could not verify fork - ${err}`)
    }
  }

  const rpcPort = config.rpcPort ?? config.ports.rpc
  const wsPort = config.wsPort ?? config.ports.ws

  return {
    rpc: `http://localhost:${rpcPort}`,
    ws: wsPort ? `ws://localhost:${wsPort}` : '',
  }
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
          console.log(
            `   Node is active after ${Math.round((Date.now() - startTime) / 1000)}s`,
          )
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

/**
 * Provision via on-chain contracts (testnet/mainnet)
 */
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

  const privateKey = process.env.DEPLOYER_PRIVATE_KEY
  if (!privateKey) {
    throw new Error('DEPLOYER_PRIVATE_KEY required for testnet/mainnet')
  }

  // Load contract addresses
  const addressesPath = join(DEPLOYMENTS_DIR, `${network}-dws.json`)
  if (!existsSync(addressesPath)) {
    throw new Error(
      `DWS contracts not deployed. Run contract deployment first.`,
    )
  }

  const addresses = JSON.parse(readFileSync(addressesPath, 'utf-8'))
  const externalChainProviderAddress =
    addresses.externalChainProvider as Address

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

  // Check if already registered as provider
  let providerId: Hex
  try {
    providerId = await publicClient.readContract({
      address: externalChainProviderAddress,
      abi: EXTERNAL_CHAIN_PROVIDER_ABI,
      functionName: 'providerIds',
      args: [account.address],
    })

    if (providerId === `0x${'0'.repeat(64)}`) {
      throw new Error('Not registered')
    }
    console.log(
      `   Already registered as provider: ${providerId.slice(0, 18)}...`,
    )
  } catch {
    // Register as provider
    console.log('   Registering as provider...')

    const teeAttestation = useTee
      ? keccak256(toBytes(`tee-attestation-${account.address}-${Date.now()}`))
      : `0x${'0'.repeat(64)}`

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
      value: parseEther('5000'), // Production stake
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

  // Provision node on-chain
  console.log('   Provisioning node on-chain...')

  const durationHours = 24 * 30 // 30 days
  const hourlyRate = network === 'testnet' ? 0.1 : 0.5
  const totalPayment = String(durationHours * hourlyRate + 1)

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

  const provisionReceipt = await publicClient.waitForTransactionReceipt({
    hash: provisionHash,
  })
  const nodeId = keccak256(
    toBytes(`${account.address}${providerId}${provisionReceipt.blockNumber}`),
  )
  console.log(`   ✅ Node provisioned on-chain: ${nodeId.slice(0, 18)}...`)

  // Wait for DWS to deploy the node
  const endpoints = await waitForDwsDeployment(providerEndpoint, nodeId)

  // Report node ready
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
  const network = getRequiredNetwork()
  const useTee = network === 'mainnet'
  const networkMode = getNetworkMode(network)

  // DWS endpoints
  const dwsEndpoints: Record<NetworkType, string> = {
    localnet: 'http://localhost:4030',
    testnet: 'https://dws.testnet.jejunetwork.org',
    mainnet: 'https://dws.jejunetwork.org',
  }

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║       DWS EXTERNAL CHAIN PROVISIONING                        ║
╠══════════════════════════════════════════════════════════════╣
║  Network: ${network.padEnd(50)}║
║  Chains:  ${ALL_CHAINS.join(', ').padEnd(50)}║
║  TEE:     ${useTee ? 'Required'.padEnd(50) : 'Optional'.padEnd(50)}║
╚══════════════════════════════════════════════════════════════╝
`)

  const results: DeploymentResult[] = []
  const outputDir = join(DEPLOYMENTS_DIR, 'external-chains')
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true })
  }

  console.log('Deploying nodes:')

  for (const chain of ALL_CHAINS) {
    console.log(`\n  ${chain.toUpperCase()}:`)

    const config = CHAIN_CONFIGS[chain]?.[networkMode]
    if (!config) {
      console.log(`    Skipped (no config)`)
      continue
    }

    let result: DeploymentResult

    if (network === 'localnet') {
      // Local mode - Docker containers with mainnet forks
      const nodeId = keccak256(toBytes(`local-${chain}-${Date.now()}`))
      const endpoints = await deployLocalNode(chain, config, nodeId)

      result = {
        network,
        chain,
        providerId: 'local',
        nodeId,
        endpoints,
        tee: false,
        deployedAt: new Date().toISOString(),
      }

      console.log(`    RPC: ${endpoints.rpc}`)
    } else {
      // Testnet/Mainnet - DWS on-chain provisioning
      result = await provisionViaOnChain(
        chain,
        network,
        useTee,
        dwsEndpoints[network],
      )
    }

    results.push(result)

    const outputFile = join(outputDir, `${network}-${chain}.json`)
    writeFileSync(outputFile, JSON.stringify(result, null, 2))
  }

  // Save combined results
  const combinedFile = join(outputDir, `${network}-all.json`)
  writeFileSync(
    combinedFile,
    JSON.stringify(
      {
        network,
        deployedAt: new Date().toISOString(),
        chains: Object.fromEntries(results.map((r) => [r.chain, r])),
      },
      null,
      2,
    ),
  )

  console.log(`
╔══════════════════════════════════════════════════════════════╗
║                    DEPLOYMENT COMPLETE                       ║
╠══════════════════════════════════════════════════════════════╣`)

  for (const result of results) {
    if (result.endpoints.rpc) {
      console.log(
        `║  ${result.chain.padEnd(10)} ${result.endpoints.rpc.slice(0, 46).padEnd(46)}║`,
      )
    } else {
      console.log(
        `║  ${result.chain.padEnd(10)} pending DWS provisioning`.padEnd(58) +
          '║',
      )
    }
  }

  console.log(`╠══════════════════════════════════════════════════════════════╣
║  Results: ${combinedFile.slice(-48).padEnd(48)}║
╚══════════════════════════════════════════════════════════════╝
`)
}

main().catch((error) => {
  console.error('Deployment failed:', error.message)
  process.exit(1)
})
