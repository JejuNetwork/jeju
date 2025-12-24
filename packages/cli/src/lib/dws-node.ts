/** DWS node on-chain registration */

import type { Address, Hex } from 'viem'
import { createWalletClient, http, publicActions } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { localhost } from 'viem/chains'
import { logger } from './logger'

// Contract ABIs (minimal for registration)
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
] as const

const WORKER_REGISTRY_ABI = [
  {
    name: 'addEndpoint',
    type: 'function',
    inputs: [
      { name: 'workerId', type: 'bytes32' },
      { name: 'endpoint', type: 'string' },
      { name: 'attestationHash', type: 'bytes32' },
      { name: 'teeType', type: 'uint8' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
] as const

// Storage backend enum matching contract
enum StorageBackend {
  IPFS = 0,
  ARWEAVE = 1,
  WEBTORRENT = 2,
  FILECOIN = 3,
}

// CDN Region enum matching contract
enum Region {
  GLOBAL = 0,
  NORTH_AMERICA = 1,
  EUROPE = 2,
  ASIA_PACIFIC = 3,
  SOUTH_AMERICA = 4,
  AFRICA = 5,
  OCEANIA = 6,
}

// CDN Provider type enum
enum ProviderType {
  DATACENTER = 0,
  EDGE = 1,
  RESIDENTIAL = 2,
}

interface DWSNodeConfig {
  rpcUrl: string
  privateKey: Hex
  dwsEndpoint: string
  storageManagerAddress: Address
  cdnRegistryAddress: Address
  workerRegistryAddress: Address
}

interface RegistrationResult {
  storageProviderId: Hex
  cdnNodeId: Hex
}

/**
 * Register the local DWS node on-chain
 */
export async function registerDWSNode(
  config: DWSNodeConfig,
): Promise<RegistrationResult> {
  const account = privateKeyToAccount(config.privateKey)

  const client = createWalletClient({
    account,
    chain: localhost,
    transport: http(config.rpcUrl),
  }).extend(publicActions)

  logger.step('Registering DWS node on-chain...')

  // Register as storage provider
  logger.debug('Registering as storage provider...')
  const storageHash = await client.writeContract({
    address: config.storageManagerAddress,
    abi: STORAGE_MANAGER_ABI,
    functionName: 'registerProvider',
    args: [
      StorageBackend.IPFS,
      config.dwsEndpoint,
      BigInt(1000), // 1 TB capacity
      BigInt(0), // Free for localnet
    ],
  })

  await client.waitForTransactionReceipt({ hash: storageHash })
  logger.debug(`  Storage provider registered: ${storageHash}`)

  // Get min stake for CDN node
  const minStake = await client.readContract({
    address: config.cdnRegistryAddress,
    abi: CDN_REGISTRY_ABI,
    functionName: 'minNodeStake',
  })

  // Register as CDN edge node
  logger.debug('Registering as CDN edge node...')
  const cdnHash = await client.writeContract({
    address: config.cdnRegistryAddress,
    abi: CDN_REGISTRY_ABI,
    functionName: 'registerEdgeNode',
    args: [config.dwsEndpoint, Region.GLOBAL, ProviderType.DATACENTER],
    value: minStake,
  })

  await client.waitForTransactionReceipt({ hash: cdnHash })
  logger.debug(`  CDN node registered: ${cdnHash}`)

  logger.success('DWS node registered on-chain')

  return {
    storageProviderId: storageHash,
    cdnNodeId: cdnHash,
  }
}

/**
 * Add the local DWS node as an endpoint for a worker
 */
export async function addWorkerEndpoint(
  config: DWSNodeConfig & { workerId: Hex },
): Promise<void> {
  const account = privateKeyToAccount(config.privateKey)

  const client = createWalletClient({
    account,
    chain: localhost,
    transport: http(config.rpcUrl),
  }).extend(publicActions)

  const hash = await client.writeContract({
    address: config.workerRegistryAddress,
    abi: WORKER_REGISTRY_ABI,
    functionName: 'addEndpoint',
    args: [
      config.workerId,
      `${config.dwsEndpoint}/workerd`,
      '0x0000000000000000000000000000000000000000000000000000000000000000' as Hex, // No attestation for local
      0, // No TEE for local
    ],
  })

  await client.waitForTransactionReceipt({ hash })
  logger.debug(`  Worker endpoint registered: ${hash}`)
}
