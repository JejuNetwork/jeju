/**
 * DID utilities - format: did:jeju:{network}:{0x identifier}
 */

import type { Address } from 'viem'
import { type Hex, keccak256, toHex } from 'viem'

export type DID = `did:jeju:${string}:0x${string}`

export const DIDNetwork = {
  MAINNET: 'mainnet',
  TESTNET: 'testnet',
  LOCALNET: 'localnet',
} as const
export type DIDNetwork = (typeof DIDNetwork)[keyof typeof DIDNetwork]

export interface ParsedDID {
  method: 'jeju'
  network: DIDNetwork
  identifier: Address
}

function isHexAddress(value: string): value is Address {
  return /^0x[a-fA-F0-9]{40}$/.test(value)
}

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

export function createDIDFromAddress(
  address: Address,
  network: DIDNetwork = 'mainnet',
): DID {
  const did = `did:jeju:${network}:${address.toLowerCase()}`
  if (!validateDID(did)) throw new Error(`Invalid DID from address: ${address}`)
  return did as DID
}

export function parseDID(did: string): ParsedDID {
  if (!validateDID(did)) throw new Error(`Invalid DID: ${did}`)
  const parts = did.split(':')
  return {
    method: 'jeju',
    network: parts[2] as DIDNetwork,
    identifier: parts[3] as Address,
  }
}

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

export function generateRandomDID(network: DIDNetwork = 'localnet'): DID {
  return createDID(toHex(crypto.getRandomValues(new Uint8Array(32))), network)
}

export function didEquals(a: DID | string, b: DID | string): boolean {
  return a?.toLowerCase() === b?.toLowerCase()
}

export function getNetwork(did: DID): DIDNetwork {
  return parseDID(did).network
}

export function isMainnet(did: DID): boolean {
  return getNetwork(did) === 'mainnet'
}

export function isTestnet(did: DID): boolean {
  return getNetwork(did) === 'testnet'
}

export function isLocalnet(did: DID): boolean {
  return getNetwork(did) === 'localnet'
}

export function extractAddressFromDID(did: string): Address | null {
  if (!did?.startsWith('did:')) return null
  const parts = did.split(':')
  const part3 = parts[3]
  const part4 = parts[4]
  if (parts[1] === 'jeju' && parts.length >= 4 && part3 && isHexAddress(part3))
    return part3 as Address
  if (parts[1] === 'pkh' && parts.length >= 5 && part4 && isHexAddress(part4))
    return part4 as Address
  return null
}

export interface DIDManagerConfig {
  network: DIDNetwork
  mpcEndpoints?: string[]
  mpcThreshold?: number
}

export interface CreateIdentityResult {
  did: DID
  publicKey: Hex
  address: Address
}

export interface DIDDocument {
  id: DID
  network: DIDNetwork
  identifier: Address
  controller?: Address
  verificationMethod?: VerificationMethod[]
  created?: number
  updated?: number
}

export interface VerificationMethod {
  id: string
  type: string
  controller: string
  publicKeyHex?: Hex
}

export interface AuthMethod {
  type: 'wallet' | 'email' | 'twitter' | 'discord' | 'farcaster' | 'github'
  address?: Address
  signature?: Hex
  message?: string
  timestamp?: number
  token?: string
  providerId?: string
}

/**
 * DID Manager - creates and manages decentralized identities.
 *
 * NOTE: Non-wallet auth uses local hash (no MPC). resolve() only parses, doesn't query registry.
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

  async createIdentity(authMethod: AuthMethod): Promise<CreateIdentityResult> {
    if (authMethod.type === 'wallet' && authMethod.address) {
      const address = authMethod.address
      return {
        did: createDIDFromAddress(address, this.network),
        publicKey: address as Hex,
        address,
      }
    }

    if (this.mpcEndpoints.length > 0) {
      console.warn(
        '[DIDManager] mpcEndpoints configured but not used for non-wallet auth',
      )
    }

    const seed = JSON.stringify({
      type: authMethod.type,
      providerId: authMethod.providerId,
      timestamp: authMethod.timestamp ?? Date.now(),
      network: this.network,
    })
    const hash = keccak256(toHex(new TextEncoder().encode(seed)))
    return {
      did: createDID(hash, this.network),
      publicKey: hash,
      address: hash.slice(0, 42) as Address,
    }
  }

  /** Parses DID format only - does NOT query on-chain registry */
  async resolve(did: DID): Promise<DIDDocument | null> {
    if (!validateDID(did)) return null
    const parsed = parseDID(did)
    return { id: did, network: parsed.network, identifier: parsed.identifier }
  }

  /** Validates DID format only - does NOT check on-chain registration */
  async exists(did: DID): Promise<boolean> {
    return (await this.resolve(did)) !== null
  }

  getNetwork(): DIDNetwork {
    return this.network
  }

  getMPCConfig(): { endpoints: string[]; threshold: number } {
    return { endpoints: this.mpcEndpoints, threshold: this.mpcThreshold }
  }
}
