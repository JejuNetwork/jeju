/**
 * Farcaster Signer Registration
 *
 * Handles on-chain signer registration on Optimism.
 * Interacts with Farcaster Key Registry contract.
 */

import { ed25519 } from '@noble/curves/ed25519'
import {
  type Address,
  createPublicClient,
  encodeAbiParameters,
  encodeFunctionData,
  type Hex,
  http,
  type PublicClient,
} from 'viem'
import { optimism } from 'viem/chains'

/**
 * EIP-712 domain for Farcaster Signed Key Request
 */
export const SIGNED_KEY_REQUEST_DOMAIN = {
  name: 'Farcaster SignedKeyRequestValidator',
  version: '1',
  chainId: 10, // Optimism
  verifyingContract: '0x00000000Fc1237824fb747aBDE0FF18990E59b7e' as Address,
} as const

/**
 * EIP-712 type for Signed Key Request
 */
export const SIGNED_KEY_REQUEST_TYPE = {
  SignedKeyRequest: [
    { name: 'requestFid', type: 'uint256' },
    { name: 'key', type: 'bytes' },
    { name: 'deadline', type: 'uint256' },
  ],
} as const
export const FARCASTER_CONTRACTS = {
  ID_GATEWAY: '0x00000000Fc25870C6eD6b6c7E41Fb078b7656f69' as Address,
  ID_REGISTRY: '0x00000000Fc6c5F01Fc30151999387Bb99A9f489b' as Address,
  STORAGE_REGISTRY: '0x00000000fcce7f938e7ae6d3c335bd6a1a7c593d' as Address,
  KEY_REGISTRY: '0x00000000Fc1237824fb747aBDE0FF18990E59b7e' as Address,
  BUNDLER: '0x00000000FC04c910A0b5feA33b03E5320622718e' as Address,
  SIGNED_KEY_REQUEST_VALIDATOR:
    '0x00000000Fc1237824fb747aBDE0FF18990E59b7e' as Address,
} as const
const KEY_REGISTRY_ABI = [
  {
    name: 'add',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'keyType', type: 'uint32' },
      { name: 'key', type: 'bytes' },
      { name: 'metadataType', type: 'uint8' },
      { name: 'metadata', type: 'bytes' },
    ],
    outputs: [],
  },
  {
    name: 'remove',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [{ name: 'key', type: 'bytes' }],
    outputs: [],
  },
  {
    name: 'keyDataOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'fid', type: 'uint256' },
      { name: 'key', type: 'bytes' },
    ],
    outputs: [
      { name: 'state', type: 'uint8' },
      { name: 'keyType', type: 'uint32' },
    ],
  },
  {
    name: 'keys',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'fid', type: 'uint256' },
      { name: 'key', type: 'bytes' },
    ],
    outputs: [
      { name: 'state', type: 'uint8' },
      { name: 'keyType', type: 'uint32' },
    ],
  },
] as const

const ID_REGISTRY_ABI = [
  {
    name: 'idOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'owner', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    name: 'custodyOf',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'fid', type: 'uint256' }],
    outputs: [{ type: 'address' }],
  },
] as const
export interface SignerRegistrationConfig {
  rpcUrl?: string
}

export const KeyState = {
  NULL: 0,
  ADDED: 1,
  REMOVED: 2,
} as const
export type KeyState = (typeof KeyState)[keyof typeof KeyState]

export interface KeyData {
  state: KeyState
  keyType: number
}
export class SignerRegistration {
  private publicClient: PublicClient

  constructor(config?: SignerRegistrationConfig) {
    this.publicClient = createPublicClient({
      chain: optimism,
      transport: http(config?.rpcUrl ?? 'https://mainnet.optimism.io'),
    }) as PublicClient
  }

  /**
   * Generate the add signer transaction data
   */
  buildAddSignerTx(params: {
    publicKey: Hex
    metadataType?: number
    metadata?: Hex
  }): { to: Address; data: Hex } {
    const data = encodeFunctionData({
      abi: KEY_REGISTRY_ABI,
      functionName: 'add',
      args: [
        1, // keyType = 1 (Ed25519 signer)
        params.publicKey,
        params.metadataType ?? 0, // metadataType = 0 (none) or 1 (signed key request)
        params.metadata ?? ('0x' as Hex),
      ],
    })

    return { to: FARCASTER_CONTRACTS.KEY_REGISTRY, data }
  }

  /**
   * Build add signer with signed key request metadata
   */
  buildAddSignerWithRequestTx(params: {
    publicKey: Hex
    requestFid: number
    deadline: number
    signature: Hex
  }): { to: Address; data: Hex } {
    // Encode signed key request metadata
    // Format: abi.encode(requestFid, requestSigner, signature, deadline)
    const metadata = this.encodeSignedKeyRequestMetadata(params)

    return this.buildAddSignerTx({
      publicKey: params.publicKey,
      metadataType: 1, // Signed key request
      metadata,
    })
  }

  /**
   * Generate Warpcast deep link for signer approval
   */
  generateWarpcastApprovalLink(params: {
    publicKey: Hex
    deadline: number
    signature: Hex
    requestFid: number
  }): string {
    const base = 'https://warpcast.com/~/signer'
    const searchParams = new URLSearchParams({
      publicKey: params.publicKey,
      deadline: params.deadline.toString(),
      signature: params.signature,
      requestFid: params.requestFid.toString(),
    })

    return `${base}?${searchParams.toString()}`
  }

  /**
   * Generate simple add-key link (user signs in Warpcast)
   */
  generateSimpleApprovalLink(publicKey: Hex): string {
    return `https://warpcast.com/~/add-key?publicKey=${publicKey}`
  }

  /**
   * Check if signer is registered for FID
   */
  async isSignerRegistered(fid: number, publicKey: Hex): Promise<boolean> {
    const [state] = await this.publicClient.readContract({
      address: FARCASTER_CONTRACTS.KEY_REGISTRY,
      abi: KEY_REGISTRY_ABI,
      functionName: 'keyDataOf',
      args: [BigInt(fid), publicKey],
    })

    return state === KeyState.ADDED
  }

  /**
   * Get key data for a signer
   */
  async getKeyData(fid: number, publicKey: Hex): Promise<KeyData> {
    const [state, keyType] = await this.publicClient.readContract({
      address: FARCASTER_CONTRACTS.KEY_REGISTRY,
      abi: KEY_REGISTRY_ABI,
      functionName: 'keyDataOf',
      args: [BigInt(fid), publicKey],
    })

    return { state: state as KeyState, keyType }
  }

  /**
   * Build remove signer transaction
   */
  buildRemoveSignerTx(publicKey: Hex): { to: Address; data: Hex } {
    const data = encodeFunctionData({
      abi: KEY_REGISTRY_ABI,
      functionName: 'remove',
      args: [publicKey],
    })

    return { to: FARCASTER_CONTRACTS.KEY_REGISTRY, data }
  }

  /**
   * Get FID for an address
   */
  async getFidForAddress(address: Address): Promise<number | null> {
    const fid = await this.publicClient.readContract({
      address: FARCASTER_CONTRACTS.ID_REGISTRY,
      abi: ID_REGISTRY_ABI,
      functionName: 'idOf',
      args: [address],
    })

    return fid > 0n ? Number(fid) : null
  }

  /**
   * Get custody address for FID
   */
  async getCustodyAddress(fid: number): Promise<Address | null> {
    const address = await this.publicClient.readContract({
      address: FARCASTER_CONTRACTS.ID_REGISTRY,
      abi: ID_REGISTRY_ABI,
      functionName: 'custodyOf',
      args: [BigInt(fid)],
    })

    const zeroAddress = '0x0000000000000000000000000000000000000000'
    return address === zeroAddress ? null : address
  }

  /**
   * Build EIP-712 typed data for signed key request.
   * This returns the struct hash that should be signed using wallet.signTypedData().
   */
  buildSignedKeyRequestTypedData(params: {
    publicKey: Hex
    requestFid: number
    deadline: number
  }): {
    domain: typeof SIGNED_KEY_REQUEST_DOMAIN
    types: typeof SIGNED_KEY_REQUEST_TYPE
    primaryType: 'SignedKeyRequest'
    message: { requestFid: bigint; key: Hex; deadline: bigint }
  } {
    return {
      domain: SIGNED_KEY_REQUEST_DOMAIN,
      types: SIGNED_KEY_REQUEST_TYPE,
      primaryType: 'SignedKeyRequest',
      message: {
        requestFid: BigInt(params.requestFid),
        key: params.publicKey,
        deadline: BigInt(params.deadline),
      },
    }
  }

  /**
   * Encode signed key request metadata for on-chain submission using proper ABI encoding
   */
  private encodeSignedKeyRequestMetadata(params: {
    requestFid: number
    deadline: number
    signature: Hex
  }): Hex {
    // ABI encode per Farcaster spec: (uint256 requestFid, address requestSigner, bytes signature, uint256 deadline)
    // requestSigner is derived from signature in the contract, so we pass zero address
    return encodeAbiParameters(
      [
        { type: 'uint256' }, // requestFid
        { type: 'address' }, // requestSigner (will be recovered from sig)
        { type: 'bytes' }, // signature
        { type: 'uint256' }, // deadline
      ],
      [
        BigInt(params.requestFid),
        '0x0000000000000000000000000000000000000000' as Address,
        params.signature,
        BigInt(params.deadline),
      ],
    )
  }
}
/**
 * Verify an Ed25519 signature
 */
export function verifySignerSignature(
  message: Uint8Array,
  signature: Uint8Array,
  publicKey: Uint8Array,
): boolean {
  return ed25519.verify(signature, message, publicKey)
}

/**
 * Generate a random deadline (24 hours from now)
 */
export function generateDeadline(hoursFromNow: number = 24): number {
  return Math.floor(Date.now() / 1000) + hoursFromNow * 60 * 60
}
