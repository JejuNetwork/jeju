/**
 * Browser-compatible stubs for externalized server packages
 *
 * These provide fallback implementations when server-side packages
 * are not available in the browser build.
 */

// BanType constants (from @jejunetwork/shared)
export const BanType = {
  NONE: 0,
  ON_NOTICE: 1,
  CHALLENGED: 2,
  PERMANENT: 3,
} as const

export type BanType = (typeof BanType)[keyof typeof BanType]

// Ban status interface
export interface BanStatus {
  isBanned: boolean
  isOnNotice: boolean
  banType: BanType
  reason: string | null
  loading: boolean
  canAppeal: boolean
}

// Default ban status (not banned)
const DEFAULT_BAN_STATUS: BanStatus = {
  isBanned: false,
  isOnNotice: false,
  banType: BanType.NONE,
  reason: null,
  loading: false,
  canAppeal: false,
}

/**
 * Stub for useBanStatus hook
 * Returns a default "not banned" status
 */
export function useBanStatus(_address: string | undefined): BanStatus {
  // In a real implementation, this would check the moderation contracts
  // For now, return default (not banned) status
  return DEFAULT_BAN_STATUS
}

/**
 * Stub for getBanTypeLabel
 */
export function getBanTypeLabel(banType: BanType): string {
  const labels: Record<BanType, string> = {
    [BanType.NONE]: 'None',
    [BanType.ON_NOTICE]: 'On Notice',
    [BanType.CHALLENGED]: 'Challenged',
    [BanType.PERMANENT]: 'Permanently Banned',
  }
  return labels[banType] ?? 'Unknown'
}

// OAuth3 types
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

// IPFS stub
export interface IPFSClient {
  upload: (file: File, options?: { durationMonths?: number }) => Promise<string>
  uploadJSON: (
    data: Record<string, unknown>,
    filename: string,
  ) => Promise<string>
  getUrl: (hash: string) => string
}

export function createIPFSClient(config: {
  apiUrl?: string
  gatewayUrl?: string
}): IPFSClient {
  const gatewayUrl = config.gatewayUrl || 'https://ipfs.io/ipfs'

  return {
    async upload(
      _file: File,
      _options?: { durationMonths?: number },
    ): Promise<string> {
      // Stub - would upload to IPFS in real implementation
      throw new Error('IPFS upload not available in browser build')
    },
    async uploadJSON(
      _data: Record<string, unknown>,
      _filename: string,
    ): Promise<string> {
      throw new Error('IPFS upload not available in browser build')
    },
    getUrl(hash: string): string {
      // Remove ipfs:// prefix if present
      const cid = hash.replace(/^ipfs:\/\//, '')
      return `${gatewayUrl}/${cid}`
    },
  }
}

/**
 * Convert CID to bytes32
 */
export function cidToBytes32(cid: string): `0x${string}` {
  // Simple stub - would decode CID properly in real implementation
  const hex = Buffer.from(cid.slice(0, 32).padEnd(32, '0')).toString('hex')
  return `0x${hex}` as `0x${string}`
}
