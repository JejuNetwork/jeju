#!/usr/bin/env bun
/**
 * Register DWS as On-Chain Provider
 *
 * This script registers the DWS node as a provider in the on-chain registry,
 * enabling it to participate in the decentralized provider network.
 *
 * Usage:
 *   bun run packages/deployment/scripts/deploy/register-dws-provider.ts --network testnet
 */

import {
  getContract,
  getCurrentNetwork,
  getDWSUrl,
  getRpcUrl,
} from '@jejunetwork/config'
import { type Address, createWalletClient, http, parseEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia } from 'viem/chains'

// Provider registration parameters
interface ProviderRegistration {
  endpoint: string
  capabilities: Array<
    'compute' | 'storage' | 'cdn' | 'database' | 'gpu' | 'tee'
  >
  stake: bigint
  specs: {
    cpuCores: number
    memoryMb: number
    storageMb: number
    bandwidthMbps: number
    gpuType?: string
    gpuCount?: number
    teePlatform?: 'intel_sgx' | 'intel_tdx' | 'amd_sev' | 'none'
  }
  pricing: {
    pricePerHour: bigint
    pricePerGb: bigint
    pricePerRequest: bigint
  }
  region: string
}

const DWS_PROVIDER_REGISTRY_ABI = [
  {
    name: 'registerProvider',
    type: 'function',
    inputs: [
      { name: 'endpoint', type: 'string' },
      { name: 'capabilities', type: 'uint8[]' },
      {
        name: 'specs',
        type: 'tuple',
        components: [
          { name: 'cpuCores', type: 'uint32' },
          { name: 'memoryMb', type: 'uint32' },
          { name: 'storageMb', type: 'uint64' },
          { name: 'bandwidthMbps', type: 'uint32' },
          { name: 'gpuType', type: 'string' },
          { name: 'gpuCount', type: 'uint8' },
          { name: 'teePlatform', type: 'uint8' },
        ],
      },
      {
        name: 'pricing',
        type: 'tuple',
        components: [
          { name: 'pricePerHour', type: 'uint256' },
          { name: 'pricePerGb', type: 'uint256' },
          { name: 'pricePerRequest', type: 'uint256' },
        ],
      },
      { name: 'region', type: 'string' },
    ],
    outputs: [{ name: 'providerId', type: 'uint256' }],
    stateMutability: 'payable',
  },
  {
    name: 'getProvider',
    type: 'function',
    inputs: [{ name: 'providerId', type: 'uint256' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'owner', type: 'address' },
          { name: 'endpoint', type: 'string' },
          { name: 'stake', type: 'uint256' },
          { name: 'reputation', type: 'uint256' },
          { name: 'isActive', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getProviderByOwner',
    type: 'function',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ name: 'providerId', type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

// Capability enum mapping
const CAPABILITY_MAP = {
  compute: 0,
  storage: 1,
  cdn: 2,
  database: 3,
  gpu: 4,
  tee: 5,
} as const

// TEE platform enum mapping
const TEE_PLATFORM_MAP = {
  none: 0,
  intel_sgx: 1,
  intel_tdx: 2,
  amd_sev: 3,
} as const

async function main() {
  const args = process.argv.slice(2)
  const networkArg =
    args.find((a) => a.startsWith('--network='))?.split('=')[1] ||
    args[args.indexOf('--network') + 1] ||
    process.env.NETWORK ||
    'testnet'

  process.env.NETWORK = networkArg
  const network = getCurrentNetwork()
  console.log(`[Provider Registration] Network: ${network}`)

  // Get private key
  const privateKey = process.env.DWS_PRIVATE_KEY
  if (!privateKey) {
    console.error('ERROR: DWS_PRIVATE_KEY environment variable required')
    process.exit(1)
  }

  // Get contract address
  const registryAddress = getContract('dws', 'providerRegistry') as Address
  if (
    !registryAddress ||
    registryAddress === '0x0000000000000000000000000000000000000000'
  ) {
    console.error('ERROR: DWSProviderRegistry contract not deployed')
    console.log('Deploy contracts first: bun run scripts/deploy/contracts.ts')
    process.exit(1)
  }

  console.log(`[Provider Registration] Registry: ${registryAddress}`)

  // Create wallet client
  const account = privateKeyToAccount(privateKey as `0x${string}`)
  const chain = network === 'mainnet' ? base : baseSepolia
  const rpcUrl = getRpcUrl(network)

  const walletClient = createWalletClient({
    account,
    chain,
    transport: http(rpcUrl),
  })

  console.log(`[Provider Registration] Account: ${account.address}`)

  // Get DWS endpoint
  const dwsUrl = getDWSUrl(network)
  console.log(`[Provider Registration] Endpoint: ${dwsUrl}`)

  // Define provider registration
  const registration: ProviderRegistration = {
    endpoint: dwsUrl,
    capabilities: ['compute', 'storage', 'cdn', 'database'],
    stake: network === 'mainnet' ? parseEther('1000') : parseEther('10'), // 10 ETH testnet, 1000 mainnet
    specs: {
      cpuCores: 4,
      memoryMb: 8192,
      storageMb: 500000, // 500GB
      bandwidthMbps: 1000,
      teePlatform: 'none',
    },
    pricing: {
      pricePerHour: parseEther('0.001'), // 0.001 ETH/hour
      pricePerGb: parseEther('0.0001'), // 0.0001 ETH/GB
      pricePerRequest: parseEther('0.000001'), // 0.000001 ETH/request
    },
    region: 'us-east-1',
  }

  // Check if already registered
  try {
    const { publicClient } = await import('viem').then(async (m) => {
      const { createPublicClient } = m
      return {
        publicClient: createPublicClient({
          chain,
          transport: http(rpcUrl),
        }),
      }
    })

    const existingProviderId = await publicClient.readContract({
      address: registryAddress,
      abi: DWS_PROVIDER_REGISTRY_ABI,
      functionName: 'getProviderByOwner',
      args: [account.address],
    })

    if (existingProviderId > 0n) {
      console.log(
        `[Provider Registration] Already registered as provider ${existingProviderId}`,
      )

      // Get provider details
      const provider = await publicClient.readContract({
        address: registryAddress,
        abi: DWS_PROVIDER_REGISTRY_ABI,
        functionName: 'getProvider',
        args: [existingProviderId],
      })

      console.log('[Provider Registration] Current registration:')
      console.log(`  Endpoint: ${provider.endpoint}`)
      console.log(`  Stake: ${provider.stake} wei`)
      console.log(`  Reputation: ${provider.reputation}`)
      console.log(`  Active: ${provider.isActive}`)

      return
    }
  } catch (_error) {
    // Not registered, continue with registration
    console.log('[Provider Registration] Not registered yet, proceeding...')
  }

  // Convert capabilities to uint8 array
  const capabilityIds = registration.capabilities.map((c) => CAPABILITY_MAP[c])

  // Convert TEE platform to uint8
  const teePlatformId =
    TEE_PLATFORM_MAP[registration.specs.teePlatform || 'none']

  console.log('[Provider Registration] Registering provider...')
  console.log(`  Capabilities: ${registration.capabilities.join(', ')}`)
  console.log(`  Stake: ${registration.stake} wei`)
  console.log(`  Region: ${registration.region}`)

  try {
    const hash = await walletClient.writeContract({
      address: registryAddress,
      abi: DWS_PROVIDER_REGISTRY_ABI,
      functionName: 'registerProvider',
      args: [
        registration.endpoint,
        capabilityIds,
        {
          cpuCores: registration.specs.cpuCores,
          memoryMb: registration.specs.memoryMb,
          storageMb: BigInt(registration.specs.storageMb),
          bandwidthMbps: registration.specs.bandwidthMbps,
          gpuType: registration.specs.gpuType || '',
          gpuCount: registration.specs.gpuCount || 0,
          teePlatform: teePlatformId,
        },
        {
          pricePerHour: registration.pricing.pricePerHour,
          pricePerGb: registration.pricing.pricePerGb,
          pricePerRequest: registration.pricing.pricePerRequest,
        },
        registration.region,
      ],
      value: registration.stake,
    })

    console.log(`[Provider Registration] Transaction submitted: ${hash}`)
    console.log('[Provider Registration] Waiting for confirmation...')

    // Wait for transaction
    const { createPublicClient } = await import('viem')
    const publicClient = createPublicClient({
      chain,
      transport: http(rpcUrl),
    })

    const receipt = await publicClient.waitForTransactionReceipt({ hash })

    if (receipt.status === 'success') {
      console.log(
        '[Provider Registration] ✅ Provider registered successfully!',
      )
      console.log(`  Block: ${receipt.blockNumber}`)
      console.log(`  Gas used: ${receipt.gasUsed}`)

      // Get the provider ID from logs
      // (In a real implementation, parse the ProviderRegistered event)
      console.log('\n[Provider Registration] Next steps:')
      console.log(
        '1. Enable P2P: kubectl patch deployment dws -n dws -p \'{"spec":{"template":{"spec":{"containers":[{"name":"dws","env":[{"name":"DWS_P2P_ENABLED","value":"true"}]}]}}}}\'',
      )
      console.log('2. Update DWS to provider mode: DWS_PROVIDER_ENABLED=true')
      console.log('3. Monitor provider health at /provider/health')
    } else {
      console.error('[Provider Registration] ❌ Transaction failed')
      process.exit(1)
    }
  } catch (error) {
    console.error('[Provider Registration] Error:', error)

    // If contract doesn't exist or ABI mismatch, provide helpful message
    if (String(error).includes('contract') || String(error).includes('ABI')) {
      console.log('\n[Provider Registration] Contract may not be deployed.')
      console.log('To deploy contracts: bun run scripts/deploy/contracts.ts')
      console.log(
        '\nFor now, DWS can run in standalone mode without on-chain registration.',
      )
      console.log(
        'Apps will be served via the app router without provider network.',
      )
    }

    process.exit(1)
  }
}

main().catch(console.error)
