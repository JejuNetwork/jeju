/**
 * Decentralized Identity (DID) Module
 *
 * Provides DID creation, parsing, and validation utilities.
 * Browser-safe implementation without server-side dependencies.
 *
 * DID format: did:jeju:{network}:{identifier}
 * - network: mainnet | testnet | localnet
 * - identifier: 0x{40 hex chars} derived from public key
 */

import type { Address } from 'viem'
import { type Hex, keccak256, toHex } from 'viem'

/**
 * Branded type for Jeju DIDs
 * Format: did:jeju:{network}:0x{40 hex chars}
 */
export type DID = `did:jeju:${string}:0x${string}`

/**
 * Valid networks for Jeju DIDs
 */
export const DIDNetwork = {
  MAINNET: 'mainnet',
  TESTNET: 'testnet',
  LOCALNET: 'localnet',
} as const
export type DIDNetwork = (typeof DIDNetwork)[keyof typeof DIDNetwork]

/**
 * Parsed DID components
 */
export interface ParsedDID {
  method: 'jeju'
  network: DIDNetwork
  identifier: Address
}

/**
 * Check if a string is a valid hex address (0x + 40 hex chars)
 */
function isHexAddress(value: string): value is Address {
  return /^0x[a-fA-F0-9]{40}$/.test(value)
}

/**
 * Create a DID from a public key.
 * The returned string is validated to ensure it matches the DID format.
 */
export function createDID(
  publicKey: Hex,
  network: DIDNetwork = 'mainnet',
): DID {
  const hash = keccak256(publicKey)
  const shortHash = hash.slice(0, 42) as Address // 0x + 40 hex chars
  const did = `did:jeju:${network}:${shortHash}`

  if (!validateDID(did)) {
    throw new Error(`Failed to create valid DID from publicKey: ${publicKey}`)
  }
  return did as DID
}

/**
 * Create DID from wallet address
 */
export function createDIDFromAddress(
  address: Address,
  network: DIDNetwork = 'mainnet',
): DID {
  const cleanAddress = address.toLowerCase() as Address
  const did = `did:jeju:${network}:${cleanAddress}`

  if (!validateDID(did)) {
    throw new Error(`Failed to create valid DID from address: ${address}`)
  }
  return did as DID
}

/**
 * Parse a DID string into components
 */
export function parseDID(did: string): ParsedDID {
  if (!validateDID(did)) {
    throw new Error(`Invalid DID format: ${did}`)
  }

  const parts = did.split(':')
  const network = parts[2] as DIDNetwork
  const identifier = parts[3] as Address

  return {
    method: 'jeju',
    network,
    identifier,
  }
}

/**
 * Validate a DID string
 */
export function validateDID(did: string): did is DID {
  if (typeof did !== 'string' || !did.startsWith('did:jeju:')) {
    return false
  }

  if (did.trim() !== did) {
    return false
  }

  const parts = did.split(':')
  if (parts.length !== 4) {
    return false
  }

  const network = parts[2]
  const identifier = parts[3]

  if (!network || !['mainnet', 'testnet', 'localnet'].includes(network)) {
    return false
  }

  if (!identifier || !isHexAddress(identifier)) {
    return false
  }

  return true
}

/**
 * Generate a random DID (for testing)
 */
export function generateRandomDID(network: DIDNetwork = 'localnet'): DID {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32))
  const publicKey = toHex(randomBytes)
  return createDID(publicKey, network)
}

/**
 * Check if two DIDs are equal (case-insensitive)
 */
export function didEquals(a: DID | string, b: DID | string): boolean {
  if (!a || !b) return false
  return a.toLowerCase() === b.toLowerCase()
}

/**
 * Get the network from a DID
 */
export function getNetwork(did: DID): DIDNetwork {
  const { network } = parseDID(did)
  return network
}

/**
 * Check if a DID is on mainnet
 */
export function isMainnet(did: DID): boolean {
  return getNetwork(did) === 'mainnet'
}

/**
 * Check if a DID is on testnet
 */
export function isTestnet(did: DID): boolean {
  return getNetwork(did) === 'testnet'
}

/**
 * Check if a DID is on localnet
 */
export function isLocalnet(did: DID): boolean {
  return getNetwork(did) === 'localnet'
}

/**
 * Extract address from DID
 * Supports both did:jeju and did:pkh formats
 */
export function extractAddressFromDID(did: string): Address | null {
  if (!did || !did.startsWith('did:')) {
    return null
  }

  const parts = did.split(':')

  // Handle did:jeju format: did:jeju:network:0xaddress
  if (parts[1] === 'jeju' && parts.length >= 4) {
    const identifier = parts[3]
    if (identifier && isHexAddress(identifier)) {
      return identifier
    }
  }

  // Handle did:pkh format: did:pkh:eip155:chainId:address
  if (parts[1] === 'pkh' && parts.length >= 5) {
    const address = parts[4]
    if (address && isHexAddress(address)) {
      return address
    }
  }

  return null
}

/**
 * DID Manager Configuration
 */
export interface DIDManagerConfig {
  network: DIDNetwork
  /** Optional MPC endpoints for key generation */
  mpcEndpoints?: string[]
  /** MPC threshold (default: 2) */
  mpcThreshold?: number
}

/**
 * Result from creating an identity
 */
export interface CreateIdentityResult {
  did: DID
  publicKey: Hex
  address: Address
}

/**
 * DID Document for resolution
 */
export interface DIDDocument {
  id: DID
  network: DIDNetwork
  identifier: Address
  controller?: Address
  verificationMethod?: VerificationMethod[]
  created?: number
  updated?: number
}

/**
 * Verification method in DID document
 */
export interface VerificationMethod {
  id: string
  type: string
  controller: string
  publicKeyHex?: Hex
}

/**
 * Auth method for identity creation
 */
export interface AuthMethod {
  type: 'wallet' | 'email' | 'twitter' | 'discord' | 'farcaster' | 'github'
  /** Wallet address (for wallet auth) */
  address?: Address
  /** Signature proving ownership */
  signature?: Hex
  /** Message that was signed */
  message?: string
  /** Timestamp of auth request */
  timestamp?: number
  /** OAuth token (for social auth) */
  token?: string
  /** Provider-specific ID */
  providerId?: string
}

/**
 * DID Manager for creating and managing decentralized identities.
 *
 * In production, identity creation uses MPC key generation.
 * In dev mode, uses deterministic key derivation from auth method.
 */
export class DIDManager {
  private readonly network: DIDNetwork
  private readonly mpcEndpoints: string[]
  private readonly mpcThreshold: number

  constructor(config: DIDManagerConfig) {
    this.network = config.network
    this.mpcEndpoints = config.mpcEndpoints ?? []
    this.mpcThreshold = config.mpcThreshold ?? 2
  }

  /**
   * Create a new identity from an auth method.
   * For wallet auth, derives DID from address.
   * For other auth types, generates deterministic DID.
   */
  async createIdentity(authMethod: AuthMethod): Promise<CreateIdentityResult> {
    // For wallet auth, derive DID from address
    if (authMethod.type === 'wallet' && authMethod.address) {
      const address = authMethod.address
      const did = createDIDFromAddress(address, this.network)
      return {
        did,
        publicKey: address as Hex,
        address,
      }
    }

    // For other auth types, generate a deterministic DID
    // In production with MPC endpoints, this would involve distributed key gen
    const seed = JSON.stringify({
      type: authMethod.type,
      providerId: authMethod.providerId,
      timestamp: authMethod.timestamp ?? Date.now(),
      network: this.network,
    })

    const seedBytes = new TextEncoder().encode(seed)
    const hash = keccak256(toHex(seedBytes))
    const did = createDID(hash, this.network)
    const address = hash.slice(0, 42) as Address

    return {
      did,
      publicKey: hash,
      address,
    }
  }

  /**
   * Resolve a DID to its document
   * In production, queries the DID registry on-chain
   */
  async resolve(did: DID): Promise<DIDDocument | null> {
    if (!validateDID(did)) {
      return null
    }

    const parsed = parseDID(did)
    return {
      id: did,
      network: parsed.network,
      identifier: parsed.identifier,
    }
  }

  /**
   * Check if a DID exists (is registered)
   */
  async exists(did: DID): Promise<boolean> {
    const doc = await this.resolve(did)
    return doc !== null
  }

  /**
   * Get the configured network
   */
  getNetwork(): DIDNetwork {
    return this.network
  }

  /**
   * Get MPC configuration
   */
  getMPCConfig(): { endpoints: string[]; threshold: number } {
    return {
      endpoints: this.mpcEndpoints,
      threshold: this.mpcThreshold,
    }
  }
}
