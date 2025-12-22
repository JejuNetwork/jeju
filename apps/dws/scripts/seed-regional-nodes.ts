#!/usr/bin/env bun
/**
 * Seed Regional TEE Nodes
 *
 * Seeds TEE worker nodes for different environments:
 * - localnet: Single local node with simulated TEE
 * - testnet: 2 regions (us-east, eu-west) for testing
 * - mainnet: Registers node in operator's chosen region
 *
 * Usage:
 *   bun run scripts/seed-regional-nodes.ts --env localnet
 *   bun run scripts/seed-regional-nodes.ts --env testnet --region aws:us-east-1
 *   bun run scripts/seed-regional-nodes.ts --env mainnet --region gcp:us-central1 --endpoint https://my-node.example.com
 */

import {
  type Address,
  createPublicClient,
  createWalletClient,
  type Hex,
  http,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia, localhost } from 'viem/chains'
import {
  getRegion,
  getRegionConfig,
  KNOWN_REGIONS,
} from '../src/workers/tee/regions'
import type {
  NetworkEnvironment,
  RegionId,
  TEEPlatform,
} from '../src/workers/tee/types'

// ============================================================================
// ERC-8004 Registry ABI
// ============================================================================

const IDENTITY_REGISTRY_ABI = [
  {
    name: 'register',
    type: 'function',
    inputs: [{ name: 'tokenURI', type: 'string' }],
    outputs: [{ name: 'agentId', type: 'uint256' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'setMetadata',
    type: 'function',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'key', type: 'string' },
      { name: 'value', type: 'bytes' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'setA2AEndpoint',
    type: 'function',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'endpoint', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'addTag',
    type: 'function',
    inputs: [
      { name: 'agentId', type: 'uint256' },
      { name: 'tag', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getAgentsByTag',
    type: 'function',
    inputs: [{ name: 'tag', type: 'string' }],
    outputs: [{ name: 'agentIds', type: 'uint256[]' }],
    stateMutability: 'view',
  },
] as const

// Tags
const TEE_WORKER_TAG = 'dws-tee-worker'
const REGION_KEY = 'teeRegion'
const TEE_PLATFORM_KEY = 'teePlatform'
const CAPABILITIES_KEY = 'teeCapabilities'

// ============================================================================
// Configuration
// ============================================================================

interface SeedConfig {
  environment: NetworkEnvironment
  region: RegionId
  endpoint: string
  teePlatform: TEEPlatform
  capabilities: string[]
  rpcUrl: string
  registryAddress: Address
  privateKey: `0x${string}`
}

function parseArgs(): Partial<SeedConfig> {
  const args = process.argv.slice(2)
  const config: Partial<SeedConfig> = {}

  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    const value = args[i + 1]

    switch (arg) {
      case '--env':
      case '-e':
        config.environment = value as NetworkEnvironment
        i++
        break
      case '--region':
      case '-r':
        config.region = value
        i++
        break
      case '--endpoint':
        config.endpoint = value
        i++
        break
      case '--tee':
        config.teePlatform = value as TEEPlatform
        i++
        break
      case '--capabilities':
        config.capabilities = value.split(',')
        i++
        break
      case '--rpc':
        config.rpcUrl = value
        i++
        break
      case '--registry':
        config.registryAddress = value as Address
        i++
        break
      case '--key':
        config.privateKey = value as `0x${string}`
        i++
        break
      case '--help':
      case '-h':
        printHelp()
        process.exit(0)
    }
  }

  return config
}

function printHelp(): void {
  console.log(`
Seed Regional TEE Nodes

Usage:
  bun run scripts/seed-regional-nodes.ts [options]

Options:
  --env, -e <env>         Environment: localnet, testnet, mainnet (default: localnet)
  --region, -r <region>   Region ID (e.g., aws:us-east-1, gcp:us-central1, local)
  --endpoint <url>        Node's public HTTP endpoint
  --tee <platform>        TEE platform: intel-sgx, intel-tdx, amd-sev, simulator
  --capabilities <list>   Comma-separated capabilities (e.g., gpu,high-memory)
  --rpc <url>             RPC URL
  --registry <address>    Identity registry contract address
  --key <privateKey>      Private key for node operator
  --help, -h              Show this help

Examples:
  # Local development (single node, simulated TEE)
  bun run scripts/seed-regional-nodes.ts --env localnet

  # Testnet (2 regions)
  bun run scripts/seed-regional-nodes.ts --env testnet --region aws:us-east-1 --endpoint http://localhost:4040

  # Mainnet (operator registers their node)
  bun run scripts/seed-regional-nodes.ts --env mainnet --region gcp:us-central1 --endpoint https://my-node.example.com --tee amd-sev
`)
}

// ============================================================================
// Node Registration
// ============================================================================

async function registerNode(config: SeedConfig): Promise<bigint> {
  console.log(`\n📍 Registering TEE worker node in ${config.region}...`)

  const chain = inferChain(config.rpcUrl)
  const account = privateKeyToAccount(config.privateKey)

  const publicClient = createPublicClient({
    chain,
    transport: http(config.rpcUrl),
  })

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(config.rpcUrl),
  })

  // Create token URI with node metadata
  const regionInfo = getRegion(config.region)
  const tokenURI = `data:application/json,${encodeURIComponent(
    JSON.stringify({
      name: `TEE Worker - ${regionInfo?.name ?? config.region}`,
      description: `DWS TEE Worker Node in ${config.region}`,
      image: '',
      properties: {
        type: 'dws-tee-worker',
        region: config.region,
        teePlatform: config.teePlatform,
        capabilities: config.capabilities,
      },
    }),
  )}`

  // Register agent
  const { request: registerRequest } = await publicClient.simulateContract({
    address: config.registryAddress,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'register',
    args: [tokenURI],
    account,
  })

  const registerTx = await walletClient.writeContract(registerRequest)
  console.log(`  ⏳ Registration tx: ${registerTx}`)

  const receipt = await publicClient.waitForTransactionReceipt({
    hash: registerTx,
  })

  // Extract agentId from logs (Transfer event)
  const agentId = extractAgentId(receipt.logs)
  console.log(`  ✅ Registered with agentId: ${agentId}`)

  // Set endpoint
  const { request: endpointRequest } = await publicClient.simulateContract({
    address: config.registryAddress,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'setA2AEndpoint',
    args: [agentId, config.endpoint],
    account,
  })
  await walletClient.writeContract(endpointRequest)
  console.log(`  ✅ Set endpoint: ${config.endpoint}`)

  // Set metadata
  const metadata: [string, string][] = [
    [REGION_KEY, config.region],
    [TEE_PLATFORM_KEY, config.teePlatform],
    [CAPABILITIES_KEY, config.capabilities.join(',')],
  ]

  for (const [key, value] of metadata) {
    const { request } = await publicClient.simulateContract({
      address: config.registryAddress,
      abi: IDENTITY_REGISTRY_ABI,
      functionName: 'setMetadata',
      args: [agentId, key, `0x${Buffer.from(value).toString('hex')}` as Hex],
      account,
    })
    await walletClient.writeContract(request)
  }
  console.log(`  ✅ Set metadata (region, teePlatform, capabilities)`)

  // Add TEE worker tag
  const { request: tagRequest } = await publicClient.simulateContract({
    address: config.registryAddress,
    abi: IDENTITY_REGISTRY_ABI,
    functionName: 'addTag',
    args: [agentId, TEE_WORKER_TAG],
    account,
  })
  await walletClient.writeContract(tagRequest)
  console.log(`  ✅ Added tag: ${TEE_WORKER_TAG}`)

  return agentId
}

function extractAgentId(logs: readonly { topics: readonly Hex[] }[]): bigint {
  // Find Transfer event and extract tokenId (agentId)
  for (const log of logs) {
    if (log.topics.length >= 4) {
      // Transfer event: Transfer(from, to, tokenId)
      return BigInt(log.topics[3])
    }
  }
  throw new Error('Could not extract agentId from transaction logs')
}

function inferChain(rpcUrl: string) {
  if (rpcUrl.includes('base-sepolia') || rpcUrl.includes('84532')) {
    return baseSepolia
  }
  if (rpcUrl.includes('base') && !rpcUrl.includes('localhost')) {
    return base
  }
  return localhost
}

// ============================================================================
// Environment-Specific Seeding
// ============================================================================

async function seedLocalnet(baseConfig: Partial<SeedConfig>): Promise<void> {
  console.log('\n🏠 Seeding LOCALNET environment...')
  console.log('   Single local node with simulated TEE')

  const config: SeedConfig = {
    environment: 'localnet',
    region: 'local',
    endpoint: baseConfig.endpoint ?? 'http://localhost:4040',
    teePlatform: 'simulator',
    capabilities: ['compute', 'storage'],
    rpcUrl: baseConfig.rpcUrl ?? 'http://localhost:9545',
    registryAddress:
      baseConfig.registryAddress ??
      (process.env.IDENTITY_REGISTRY_ADDRESS as Address) ??
      '0x0000000000000000000000000000000000000000',
    privateKey:
      baseConfig.privateKey ??
      (process.env.PRIVATE_KEY as `0x${string}`) ??
      '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80', // Anvil default
  }

  const agentId = await registerNode(config)
  console.log(
    `\n✅ Localnet seeded with 1 TEE worker node (agentId: ${agentId})`,
  )
}

async function seedTestnet(baseConfig: Partial<SeedConfig>): Promise<void> {
  console.log('\n🧪 Seeding TESTNET environment...')
  console.log('   2 regions: us-east, eu-west')

  const regionConfig = getRegionConfig('testnet')
  console.log(
    `   Available regions: ${regionConfig.regions.map((r) => r.id).join(', ')}`,
  )

  // Require region to be specified
  if (!baseConfig.region) {
    console.log('\n⚠️  Please specify a region with --region <region>')
    console.log('   Available: aws:us-east-1, aws:eu-west-1')
    process.exit(1)
  }

  if (!baseConfig.endpoint) {
    console.log('\n⚠️  Please specify an endpoint with --endpoint <url>')
    process.exit(1)
  }

  const config: SeedConfig = {
    environment: 'testnet',
    region: baseConfig.region,
    endpoint: baseConfig.endpoint,
    teePlatform: baseConfig.teePlatform ?? 'simulator',
    capabilities: baseConfig.capabilities ?? ['compute'],
    rpcUrl: baseConfig.rpcUrl ?? process.env.RPC_URL ?? '',
    registryAddress:
      baseConfig.registryAddress ??
      (process.env.IDENTITY_REGISTRY_ADDRESS as Address),
    privateKey:
      baseConfig.privateKey ?? (process.env.PRIVATE_KEY as `0x${string}`),
  }

  if (!config.rpcUrl) {
    console.log('\n⚠️  Please specify RPC URL with --rpc <url> or RPC_URL env')
    process.exit(1)
  }

  if (!config.registryAddress) {
    console.log(
      '\n⚠️  Please specify registry address with --registry or IDENTITY_REGISTRY_ADDRESS env',
    )
    process.exit(1)
  }

  if (!config.privateKey) {
    console.log('\n⚠️  Please specify private key with --key or PRIVATE_KEY env')
    process.exit(1)
  }

  const agentId = await registerNode(config)
  console.log(`\n✅ Testnet node registered (agentId: ${agentId})`)
}

async function seedMainnet(baseConfig: Partial<SeedConfig>): Promise<void> {
  console.log('\n🚀 Seeding MAINNET environment...')
  console.log('   Registering operator node')

  // Require all config
  if (!baseConfig.region) {
    console.log('\n⚠️  Please specify a region with --region <region>')
    console.log(
      '   See available regions: bun run scripts/seed-regional-nodes.ts --list-regions',
    )
    process.exit(1)
  }

  if (!baseConfig.endpoint) {
    console.log('\n⚠️  Please specify your node endpoint with --endpoint <url>')
    process.exit(1)
  }

  const region = getRegion(baseConfig.region)
  if (!region) {
    console.log(`\n⚠️  Unknown region: ${baseConfig.region}`)
    console.log(
      '   You can still use custom regions, but make sure coordinates are correct',
    )
  }

  // Default TEE platform based on region
  const teePlatform =
    baseConfig.teePlatform ??
    (region?.teePlatforms[0] as TEEPlatform) ??
    'simulator'

  const config: SeedConfig = {
    environment: 'mainnet',
    region: baseConfig.region,
    endpoint: baseConfig.endpoint,
    teePlatform,
    capabilities: baseConfig.capabilities ?? ['compute'],
    rpcUrl: baseConfig.rpcUrl ?? process.env.RPC_URL ?? '',
    registryAddress:
      baseConfig.registryAddress ??
      (process.env.IDENTITY_REGISTRY_ADDRESS as Address),
    privateKey:
      baseConfig.privateKey ?? (process.env.PRIVATE_KEY as `0x${string}`),
  }

  if (!config.rpcUrl) {
    console.log('\n⚠️  Please specify RPC URL with --rpc <url> or RPC_URL env')
    process.exit(1)
  }

  if (!config.registryAddress) {
    console.log(
      '\n⚠️  Please specify registry address with --registry or IDENTITY_REGISTRY_ADDRESS env',
    )
    process.exit(1)
  }

  if (!config.privateKey) {
    console.log('\n⚠️  Please specify private key with --key or PRIVATE_KEY env')
    process.exit(1)
  }

  console.log(`\n📋 Configuration:`)
  console.log(`   Region:       ${config.region}`)
  console.log(`   Endpoint:     ${config.endpoint}`)
  console.log(`   TEE Platform: ${config.teePlatform}`)
  console.log(`   Capabilities: ${config.capabilities.join(', ')}`)

  const agentId = await registerNode(config)
  console.log(`\n✅ Mainnet node registered (agentId: ${agentId})`)
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  console.log('🌐 Regional TEE Node Seeding')
  console.log('============================')

  const args = parseArgs()

  // Check for list regions
  if (process.argv.includes('--list-regions')) {
    console.log('\n📍 Known Regions:\n')

    const byProvider = new Map<string, typeof KNOWN_REGIONS>()
    for (const region of KNOWN_REGIONS) {
      const list = byProvider.get(region.provider) ?? []
      list.push(region)
      byProvider.set(region.provider, list)
    }

    for (const [provider, regions] of byProvider) {
      console.log(`${provider.toUpperCase()}:`)
      for (const r of regions) {
        const tee = r.teeCapable
          ? `TEE: ${r.teePlatforms.join(', ')}`
          : 'No TEE'
        console.log(`  ${r.id.padEnd(25)} ${r.name.padEnd(30)} ${tee}`)
      }
      console.log()
    }
    return
  }

  const environment = args.environment ?? 'localnet'

  switch (environment) {
    case 'localnet':
      await seedLocalnet(args)
      break
    case 'testnet':
      await seedTestnet(args)
      break
    case 'mainnet':
      await seedMainnet(args)
      break
    default:
      console.log(`\n⚠️  Unknown environment: ${environment}`)
      console.log('   Use: localnet, testnet, or mainnet')
      process.exit(1)
  }
}

main().catch((err) => {
  console.error('\n❌ Seeding failed:', err.message)
  process.exit(1)
})
