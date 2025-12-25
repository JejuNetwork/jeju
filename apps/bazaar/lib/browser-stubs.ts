/**
 * Browser-compatible implementations for Bazaar
 *
 * Uses @jejunetwork/config for defaults with PUBLIC_ env overrides.
 */

import {
  getContractsConfig,
  getCurrentNetwork,
  getRpcUrl,
} from '@jejunetwork/config'
import { asTuple, BanType, isHexString } from '@jejunetwork/types'
import { useCallback, useEffect, useState } from 'react'
import {
  type Address,
  createPublicClient,
  type Hex,
  http,
  parseAbiItem,
} from 'viem'
import { base, baseSepolia } from 'viem/chains'

export { BanType }
export type { BanType as BanTypeValue }

/** Get env var from import.meta.env (browser) */
function getEnv(key: string): string | undefined {
  if (typeof import.meta?.env === 'object') {
    return import.meta.env[key] as string | undefined
  }
  return undefined
}

/** Parse env var as Address or return null */
function parseEnvAsAddress(value: string | undefined): Address | null {
  if (!value || !isHexString(value)) {
    return null
  }
  return value
}

function toBanType(value: number): BanType {
  if (value < 0 || value > 3) throw new Error(`Invalid BanType: ${value}`)
  return value as BanType
}

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

// Contract Configuration using config package

function getNetworkConfig(): {
  chain: typeof base | typeof baseSepolia
  rpcUrl: string
  banManager: Address | null
  moderationMarketplace: Address | null
} {
  const networkEnv = getEnv('PUBLIC_NETWORK')
  const network =
    networkEnv === 'mainnet' ||
    networkEnv === 'testnet' ||
    networkEnv === 'localnet'
      ? networkEnv
      : getCurrentNetwork()

  const isMainnet = network === 'mainnet'
  const contracts = getContractsConfig(network)

  const rpcUrl =
    getEnv('PUBLIC_RPC_URL') ||
    getRpcUrl(network) ||
    (isMainnet ? 'https://mainnet.base.org' : 'https://sepolia.base.org')

  return {
    chain: isMainnet ? base : baseSepolia,
    rpcUrl,
    banManager:
      parseEnvAsAddress(getEnv('PUBLIC_BAN_MANAGER_ADDRESS')) ||
      (contracts.moderation?.BanManager as Address | undefined) ||
      null,
    moderationMarketplace:
      parseEnvAsAddress(getEnv('PUBLIC_MODERATION_MARKETPLACE_ADDRESS')) ||
      (contracts.moderation?.ModerationMarketplace as Address | undefined) ||
      null,
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

// Ban Status Hook

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
      const ban = await client.readContract({
        address: config.banManager,
        abi: [GET_BAN_FRAGMENT],
        functionName: 'getAddressBan',
        args: [address],
      })

      // Result is tuple: [isBanned, banType, reason, caseId]
      const result = asTuple<readonly [boolean, number, string, Hex]>(ban, 4)
      const banTypeNum = result[1]
      const reason = result[2]
      const caseId = result[3]
      const banType = toBanType(banTypeNum)

      setStatus({
        isBanned: Boolean(isAddressBanned),
        isOnNotice: Boolean(isOnNotice),
        banType,
        reason:
          reason ||
          (isOnNotice
            ? 'Account on notice - pending review'
            : 'Banned from network'),
        caseId,
        loading: false,
        canAppeal: banTypeNum === BanType.PERMANENT,
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

// OAuth3 Types

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

// IPFS Client

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
  const gatewayUrl = config.gatewayUrl ?? 'https://ipfs.io/ipfs'
  const apiUrl = config.apiUrl ?? 'https://api.pinata.cloud'
  const envJwt = getEnv('PUBLIC_PINATA_JWT')
  const pinataJwt = config.pinataJwt || envJwt

  return {
    async upload(
      file: File,
      _options?: { durationMonths?: number },
    ): Promise<string> {
      if (!pinataJwt) {
        throw new Error(
          'IPFS upload requires PUBLIC_PINATA_JWT environment variable',
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

      const result: { IpfsHash: string } = await response.json()
      return `ipfs://${result.IpfsHash}`
    },

    async uploadJSON(
      data: Record<string, unknown>,
      filename: string,
    ): Promise<string> {
      if (!pinataJwt) {
        throw new Error(
          'IPFS upload requires PUBLIC_PINATA_JWT environment variable',
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

      const result: { IpfsHash: string } = await response.json()
      return `ipfs://${result.IpfsHash}`
    },

    getUrl(hash: string): string {
      const cid = hash.replace(/^ipfs:\/\//, '')
      return `${gatewayUrl}/${cid}`
    },
  }
}

// CID Utilities

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

  // Simple hash using built-in crypto
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

  const result: Hex = `0x${hex}`
  return result
}
