#!/usr/bin/env bun
/**
 * Register the local DWS node on-chain
 */
import { createWalletClient, http, publicActions, parseEther } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'

const RPC_URL = 'http://127.0.0.1:6546'
const PRIVATE_KEY = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'
const DWS_ENDPOINT = 'http://127.0.0.1:4030'

// Load contract addresses from deployment
const contracts = await Bun.file('/home/shaw/Documents/jeju/.dws/localnet/contracts.json').json()

const STORAGE_MANAGER_ABI = [
  {
    name: 'registerProvider',
    type: 'function',
    inputs: [
      { name: 'backend', type: 'uint8' },
      { name: 'endpoint', type: 'string' },
      { name: 'capacityGB', type: 'uint256' },
      { name: 'pricePerGBMonth', type: 'uint256' },
    ],
    outputs: [{ name: 'providerId', type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    name: 'getProviderCount',
    type: 'function',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

const CDN_REGISTRY_ABI = [
  {
    name: 'registerEdgeNode',
    type: 'function',
    inputs: [
      { name: 'endpoint', type: 'string' },
      { name: 'region', type: 'uint8' },
      { name: 'providerType', type: 'uint8' },
    ],
    outputs: [{ name: 'nodeId', type: 'bytes32' }],
    stateMutability: 'payable',
  },
  {
    name: 'minNodeStake',
    type: 'function',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'getNodeCount',
    type: 'function',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

const WORKER_REGISTRY_ABI = [
  {
    name: 'registerWorker',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'endpoint', type: 'string' },
    ],
    outputs: [{ name: 'workerId', type: 'bytes32' }],
    stateMutability: 'payable',
  },
  {
    name: 'minWorkerStake',
    type: 'function',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
  {
    name: 'getWorkerCount',
    type: 'function',
    inputs: [],
    outputs: [{ type: 'uint256' }],
    stateMutability: 'view',
  },
] as const

async function main() {
  console.log('=== REGISTERING LOCAL DWS NODE ===\n')

  const account = privateKeyToAccount(PRIVATE_KEY as `0x${string}`)
  const client = createWalletClient({
    account,
    chain: foundry,
    transport: http(RPC_URL),
  }).extend(publicActions)

  console.log(`Account: ${account.address}`)
  console.log(`DWS Endpoint: ${DWS_ENDPOINT}\n`)

  // 1. Register as storage provider
  console.log('1. Registering as Storage Provider...')
  try {
    const storageHash = await client.writeContract({
      address: contracts.storageManager as `0x${string}`,
      abi: STORAGE_MANAGER_ABI,
      functionName: 'registerProvider',
      args: [
        0, // IPFS backend
        DWS_ENDPOINT,
        BigInt(1000), // 1 TB capacity
        BigInt(0), // Free for localnet
      ],
    })
    await client.waitForTransactionReceipt({ hash: storageHash })
    console.log(`   ✓ Storage provider registered: ${storageHash}`)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('already registered') || msg.includes('AlreadyExists')) {
      console.log('   ✓ Storage provider already registered')
    } else {
      console.log(`   ✗ Failed: ${msg.slice(0, 100)}`)
    }
  }

  // 2. Register as CDN edge node
  console.log('2. Registering as CDN Edge Node...')
  try {
    let minStake = BigInt(0)
    try {
      minStake = await client.readContract({
        address: contracts.cdnRegistry as `0x${string}`,
        abi: CDN_REGISTRY_ABI,
        functionName: 'minNodeStake',
      })
    } catch {
      minStake = parseEther('0.01') // Default small stake
    }

    const cdnHash = await client.writeContract({
      address: contracts.cdnRegistry as `0x${string}`,
      abi: CDN_REGISTRY_ABI,
      functionName: 'registerEdgeNode',
      args: [
        DWS_ENDPOINT,
        0, // GLOBAL region
        1, // EDGE provider type
      ],
      value: minStake,
    })
    await client.waitForTransactionReceipt({ hash: cdnHash })
    console.log(`   ✓ CDN edge node registered: ${cdnHash}`)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('already registered') || msg.includes('AlreadyExists')) {
      console.log('   ✓ CDN edge node already registered')
    } else {
      console.log(`   ✗ Failed: ${msg.slice(0, 100)}`)
    }
  }

  // 3. Register as worker
  console.log('3. Registering as Worker Node...')
  try {
    let minStake = BigInt(0)
    try {
      minStake = await client.readContract({
        address: contracts.workerRegistry as `0x${string}`,
        abi: WORKER_REGISTRY_ABI,
        functionName: 'minWorkerStake',
      })
    } catch {
      minStake = parseEther('0.01') // Default small stake
    }

    const workerHash = await client.writeContract({
      address: contracts.workerRegistry as `0x${string}`,
      abi: WORKER_REGISTRY_ABI,
      functionName: 'registerWorker',
      args: [
        'local-dev-node',
        'Local development DWS node',
        `${DWS_ENDPOINT}/workerd`,
      ],
      value: minStake,
    })
    await client.waitForTransactionReceipt({ hash: workerHash })
    console.log(`   ✓ Worker node registered: ${workerHash}`)
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e)
    if (msg.includes('already registered') || msg.includes('AlreadyExists')) {
      console.log('   ✓ Worker already registered')
    } else {
      console.log(`   ✗ Failed: ${msg.slice(0, 100)}`)
    }
  }

  console.log('\n=== REGISTRATION COMPLETE ===')
  
  // Check counts
  console.log('\nCurrent registrations:')
  try {
    const storageCount = await client.readContract({
      address: contracts.storageManager as `0x${string}`,
      abi: STORAGE_MANAGER_ABI,
      functionName: 'getProviderCount',
    })
    console.log(`  Storage Providers: ${storageCount}`)
  } catch {}
  
  try {
    const cdnCount = await client.readContract({
      address: contracts.cdnRegistry as `0x${string}`,
      abi: CDN_REGISTRY_ABI,
      functionName: 'getNodeCount',
    })
    console.log(`  CDN Edge Nodes: ${cdnCount}`)
  } catch {}

  try {
    const workerCount = await client.readContract({
      address: contracts.workerRegistry as `0x${string}`,
      abi: WORKER_REGISTRY_ABI,
      functionName: 'getWorkerCount',
    })
    console.log(`  Worker Nodes: ${workerCount}`)
  } catch {}
}

main().catch(console.error)
