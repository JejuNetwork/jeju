/**
 * Standalone KMS Service for OAuth3
 *
 * Provides FROST threshold signing without dependency on external DWS KMS.
 * This runs in-process within the OAuth3 worker for reliable operation.
 */

import { FROSTCoordinator } from '@jejunetwork/kms'
import type { Address, Hex } from 'viem'
import { keccak256, toBytes } from 'viem'

// Determine network
const NETWORK = (process.env.NETWORK ??
  process.env.JEJU_NETWORK ??
  'localnet') as 'localnet' | 'testnet' | 'mainnet'

// In-memory key storage (per-worker instance)
interface StoredKey {
  keyId: string
  coordinator: FROSTCoordinator
  publicKey: Hex
  address: Address
  threshold: number
  totalParties: number
  createdAt: number
}

const keys = new Map<string, StoredKey>()
const serviceKeyIndex = new Map<string, string>()

let initialized = false

/**
 * Initialize or get signing key for a service
 */
export async function getOrCreateServiceKey(
  serviceId: string,
  _ownerAddress: Address,
): Promise<{
  keyId: string
  publicKey: Hex
  address: Address
  threshold: number
  totalParties: number
}> {
  // Check if we already have a key for this service
  const existingKeyId = serviceKeyIndex.get(serviceId)
  if (existingKeyId) {
    const existing = keys.get(existingKeyId)
    if (existing) {
      return {
        keyId: existing.keyId,
        publicKey: existing.publicKey,
        address: existing.address,
        threshold: existing.threshold,
        totalParties: existing.totalParties,
      }
    }
  }

  // Generate deterministic key ID from service ID
  const keyId = `${serviceId}-${keccak256(toBytes(serviceId)).slice(0, 18)}`

  // Create FROST coordinator
  const threshold = 2
  const totalParties = 3

  console.log(`[OAuth3/KMS] Creating FROST key for ${serviceId}...`)

  const coordinator = new FROSTCoordinator(keyId, threshold, totalParties, {
    network: NETWORK,
    acknowledgeInsecureCentralized: NETWORK !== 'mainnet',
  })

  const cluster = await coordinator.initializeCluster()

  // Store key
  const storedKey: StoredKey = {
    keyId,
    coordinator,
    publicKey: cluster.groupPublicKey,
    address: cluster.groupAddress,
    threshold,
    totalParties,
    createdAt: Date.now(),
  }

  keys.set(keyId, storedKey)
  serviceKeyIndex.set(serviceId, keyId)

  console.log(
    `[OAuth3/KMS] Created FROST key ${keyId} with address ${cluster.groupAddress}`,
  )

  return {
    keyId: storedKey.keyId,
    publicKey: storedKey.publicKey,
    address: storedKey.address,
    threshold: storedKey.threshold,
    totalParties: storedKey.totalParties,
  }
}

/**
 * Sign a message hash using FROST threshold signing
 */
export async function signMessage(
  keyId: string,
  messageHash: Hex,
): Promise<{
  signature: Hex
  r: Hex
  s: Hex
  v: number
}> {
  const key = keys.get(keyId)
  if (!key) {
    throw new Error(`Key ${keyId} not found`)
  }

  // Sign using FROST
  const result = await key.coordinator.sign(messageHash)

  // Combine into Ethereum signature format
  const signature =
    `${result.r}${result.s.slice(2)}${result.v.toString(16).padStart(2, '0')}` as Hex

  return {
    signature,
    r: result.r,
    s: result.s,
    v: result.v,
  }
}

/**
 * Get key information
 */
export function getKey(keyId: string): StoredKey | undefined {
  return keys.get(keyId)
}

/**
 * Check if KMS is initialized
 */
export function isInitialized(): boolean {
  return initialized
}

/**
 * Initialize the standalone KMS
 */
export async function initializeStandaloneKMS(): Promise<void> {
  if (initialized) return

  console.log(`[OAuth3/KMS] Initializing standalone KMS (network: ${NETWORK})`)
  initialized = true
}

/**
 * Get KMS health status
 */
export function getKMSHealth(): {
  healthy: boolean
  mode: string
  network: string
  keys: number
} {
  return {
    healthy: true,
    mode: 'standalone-frost',
    network: NETWORK,
    keys: keys.size,
  }
}
