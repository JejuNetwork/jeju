/**
 * Browser-compatible implementations for Bazaar
 *
 * These provide self-contained implementations that work in browser builds
 * without requiring server-side packages.
 */

import { useCallback, useEffect, useState } from 'react'
import {
  type Address,
  createPublicClient,
  type Hex,
  http,
  parseAbiItem,
} from 'viem'
import { base, baseSepolia } from 'viem/chains'

// ============================================================================
// Ban Types and Status
// ============================================================================

export const BanType = {
  NONE: 0,
  ON_NOTICE: 1,
  CHALLENGED: 2,
  PERMANENT: 3,
} as const

export type BanType = (typeof BanType)[keyof typeof BanType]

export interface BanStatus {
  isBanned: boolean
  isOnNotice: boolean
  banType: BanType
  reason: string | null
  caseId: Hex | null
  loading: boolean
  canAppeal: boolean
  error: string | null
}

// ============================================================================
// Contract Configuration
// ============================================================================

function getNetworkConfig(): {
  chain: typeof base | typeof baseSepolia
  rpcUrl: string
  banManager: Address | null
  moderationMarketplace: Address | null
} {
  const network =
    typeof window !== 'undefined'
      ? (import.meta.env?.VITE_NETWORK as string) || 'testnet'
      : 'testnet'

  const isMainnet = network === 'mainnet'

  return {
    chain: isMainnet ? base : baseSepolia,
    rpcUrl: isMainnet
      ? (import.meta.env?.VITE_RPC_URL as string) || 'https://mainnet.base.org'
      : (import.meta.env?.VITE_RPC_URL as string) || 'https://sepolia.base.org',
    banManager: (import.meta.env?.VITE_BAN_MANAGER_ADDRESS as Address) || null,
    moderationMarketplace:
      (import.meta.env?.VITE_MODERATION_MARKETPLACE_ADDRESS as Address) || null,
  }
}

const BAN_MANAGER_FRAGMENT = parseAbiItem(
  'function isAddressBanned(address) view returns (bool)',
)
const ON_NOTICE_FRAGMENT = parseAbiItem(
  'function isOnNotice(address) view returns (bool)',
)
const GET_BAN_FRAGMENT = parseAbiItem(
  'function getAddressBan(address) view returns (bool isBanned, uint8 banType, string reason, bytes32 caseId)',
)

// ============================================================================
// Ban Status Hook
// ============================================================================

/**
 * Hook to check user's ban status from on-chain contracts
 */
export function useBanStatus(address: Address | undefined): BanStatus {
  const [status, setStatus] = useState<BanStatus>({
    isBanned: false,
    isOnNotice: false,
    banType: BanType.NONE,
    reason: null,
    caseId: null,
    loading: true,
    canAppeal: false,
    error: null,
  })

  const checkBanStatus = useCallback(async () => {
    if (!address) {
      setStatus((prev) => ({ ...prev, loading: false }))
      return
    }

    const config = getNetworkConfig()

    // If no ban manager configured, user is not banned
    if (!config.banManager) {
      setStatus({
        isBanned: false,
        isOnNotice: false,
        banType: BanType.NONE,
        reason: null,
        caseId: null,
        loading: false,
        canAppeal: false,
        error: null,
      })
      return
    }

    const client = createPublicClient({
      chain: config.chain,
      transport: http(config.rpcUrl),
    })

    const [isAddressBanned, isOnNotice] = await Promise.all([
      client.readContract({
        address: config.banManager,
        abi: [BAN_MANAGER_FRAGMENT],
        functionName: 'isAddressBanned',
        args: [address],
      }),
      client.readContract({
        address: config.banManager,
        abi: [ON_NOTICE_FRAGMENT],
        functionName: 'isOnNotice',
        args: [address],
      }),
    ])

    if (isAddressBanned || isOnNotice) {
      const ban = (await client.readContract({
        address: config.banManager,
        abi: [GET_BAN_FRAGMENT],
        functionName: 'getAddressBan',
        args: [address],
      })) as readonly [boolean, number, string, Hex]

      const banInfo = {
        isBanned: ban[0],
        banType: ban[1],
        reason: ban[2],
        caseId: ban[3],
      }

      setStatus({
        isBanned: Boolean(isAddressBanned),
        isOnNotice: Boolean(isOnNotice),
        banType: banInfo.banType as BanType,
        reason:
          banInfo.reason ||
          (isOnNotice
            ? 'Account on notice - pending review'
            : 'Banned from network'),
        caseId: banInfo.caseId,
        loading: false,
        canAppeal: banInfo.banType === BanType.PERMANENT,
        error: null,
      })
      return
    }

    // User is not banned
    setStatus({
      isBanned: false,
      isOnNotice: false,
      banType: BanType.NONE,
      reason: null,
      caseId: null,
      loading: false,
      canAppeal: false,
      error: null,
    })
  }, [address])

  useEffect(() => {
    checkBanStatus()

    // Re-check every 30 seconds
    const interval = setInterval(checkBanStatus, 30000)
    return () => clearInterval(interval)
  }, [checkBanStatus])

  return status
}

/**
 * Get human-readable ban type label
 */
export function getBanTypeLabel(banType: BanType): string {
  switch (banType) {
    case BanType.NONE:
      return 'None'
    case BanType.ON_NOTICE:
      return 'On Notice'
    case BanType.CHALLENGED:
      return 'Challenged'
    case BanType.PERMANENT:
      return 'Permanently Banned'
    default:
      return 'Unknown'
  }
}

// ============================================================================
// OAuth3 Types (for compatibility with OAuth3Provider)
// ============================================================================

export interface OAuth3Config {
  appId: string
  redirectUri: string
  chainId: number
  rpcUrl: string
  teeAgentUrl?: string
  decentralized?: boolean
}

export interface OAuth3Session {
  identityId: string
  smartAccountAddress: string
  providers: string[]
}

export interface OAuth3ContextValue {
  session: OAuth3Session | null
  isLoading: boolean
  isAuthenticated: boolean
  error: string | null
  login: () => Promise<void>
  logout: () => Promise<void>
}

// ============================================================================
// IPFS Client
// ============================================================================

export interface IPFSClient {
  upload: (file: File, options?: { durationMonths?: number }) => Promise<string>
  uploadJSON: (
    data: Record<string, unknown>,
    filename: string,
  ) => Promise<string>
  getUrl: (hash: string) => string
}

/**
 * Create an IPFS client for browser builds
 * Uses pinata or ipfs.io gateway for uploads
 */
export function createIPFSClient(config: {
  apiUrl?: string
  gatewayUrl?: string
  pinataJwt?: string
}): IPFSClient {
  const gatewayUrl = config.gatewayUrl || 'https://ipfs.io/ipfs'
  const apiUrl = config.apiUrl || 'https://api.pinata.cloud'
  const pinataJwt =
    config.pinataJwt ||
    (typeof import.meta.env !== 'undefined'
      ? (import.meta.env.VITE_PINATA_JWT as string)
      : undefined)

  return {
    async upload(
      file: File,
      _options?: { durationMonths?: number },
    ): Promise<string> {
      if (!pinataJwt) {
        throw new Error(
          'IPFS upload requires VITE_PINATA_JWT environment variable',
        )
      }

      const formData = new FormData()
      formData.append('file', file)

      const response = await fetch(`${apiUrl}/pinning/pinFileToIPFS`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pinataJwt}`,
        },
        body: formData,
      })

      if (!response.ok) {
        throw new Error(`IPFS upload failed: ${response.statusText}`)
      }

      const result = (await response.json()) as { IpfsHash: string }
      return `ipfs://${result.IpfsHash}`
    },

    async uploadJSON(
      data: Record<string, unknown>,
      filename: string,
    ): Promise<string> {
      if (!pinataJwt) {
        throw new Error(
          'IPFS upload requires VITE_PINATA_JWT environment variable',
        )
      }

      const response = await fetch(`${apiUrl}/pinning/pinJSONToIPFS`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${pinataJwt}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          pinataContent: data,
          pinataMetadata: { name: filename },
        }),
      })

      if (!response.ok) {
        throw new Error(`IPFS JSON upload failed: ${response.statusText}`)
      }

      const result = (await response.json()) as { IpfsHash: string }
      return `ipfs://${result.IpfsHash}`
    },

    getUrl(hash: string): string {
      const cid = hash.replace(/^ipfs:\/\//, '')
      return `${gatewayUrl}/${cid}`
    },
  }
}

// ============================================================================
// CID Utilities
// ============================================================================

/**
 * Convert CID to bytes32 for on-chain storage
 * Supports both CIDv0 (Qm...) and CIDv1 (bafy...) formats
 */
export function cidToBytes32(cid: string): Hex {
  // Remove ipfs:// prefix if present
  const cleanCid = cid.replace(/^ipfs:\/\//, '')

  // For CIDv0 (Qm...), we hash the CID string
  // For CIDv1, we could decode the multihash, but hashing is simpler
  const encoder = new TextEncoder()
  const data = encoder.encode(cleanCid)

  // Simple hash using built-in crypto (sync version for compatibility)
  let hash = 0
  for (let i = 0; i < data.length; i++) {
    hash = ((hash << 5) - hash + data[i]) | 0
  }

  // Create a deterministic 32-byte value from the CID
  const bytes = new Uint8Array(32)
  const view = new DataView(bytes.buffer)

  // Fill with hash-derived values
  for (let i = 0; i < 8; i++) {
    view.setUint32(i * 4, (hash * (i + 1)) | 0)
  }

  // Encode as hex
  const hex = Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('')

  return `0x${hex}` as Hex
}
