/**
 * Package Registry Types (JejuPkg)
 */

import type { Address, Hex } from 'viem'
export interface Package {
  packageId: Hex
  name: string
  scope: string
  owner: Address
  agentId: bigint
  jnsNode: Hex
  description: string
  license: string
  homepage: string
  repository: string
  latestVersion: Hex
  createdAt: bigint
  updatedAt: bigint
  deprecated: boolean
  downloadCount: bigint
}

export interface PackageVersion {
  versionId: Hex
  packageId: Hex
  version: string
  tarballCid: Hex
  integrityHash: Hex
  manifestCid: Hex
  size: bigint
  publisher: Address
  publishedAt: bigint
  deprecated: boolean
  deprecationMessage: string
}

export interface Maintainer {
  user: Address
  agentId: bigint
  canPublish: boolean
  canManage: boolean
  addedAt: bigint
}
export interface PkgPackageMetadata {
  _id: string
  _rev?: string
  name: string
  description: string
  'dist-tags': Record<string, string>
  versions: Record<string, PkgVersionMetadata>
  time: Record<string, string>
  maintainers: Array<{ name: string; email?: string }>
  keywords?: string[]
  repository?: { type: string; url: string }
  homepage?: string
  license?: string
  readme?: string
  readmeFilename?: string
}

export interface PkgVersionMetadata {
  name: string
  version: string
  description?: string
  main?: string
  types?: string
  module?: string
  exports?: Record<string, PkgExport>
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  bundledDependencies?: string[]
  engines?: Record<string, string>
  os?: string[]
  cpu?: string[]
  repository?: { type: string; url: string }
  keywords?: string[]
  author?: string | PkgPerson
  contributors?: Array<string | PkgPerson>
  license?: string
  homepage?: string
  bugs?: { url?: string; email?: string }
  funding?:
    | string
    | { type?: string; url: string }
    | Array<{ type?: string; url: string }>
  dist: PkgDist
  deprecated?: string
  _id: string
  _npmVersion?: string
  _nodeVersion?: string
  _npmUser?: { name: string; email?: string }
  bin?: string | Record<string, string>
  directories?: Record<string, string>
}

export type PkgExport =
  | string
  | { import?: string; require?: string; types?: string; default?: string }

export interface PkgPerson {
  name: string
  email?: string
  url?: string
}

export interface PkgDist {
  shasum: string
  tarball: string
  integrity?: string
  fileCount?: number
  unpackedSize?: number
  signatures?: Array<{
    keyid: string
    sig: string
  }>
}

export interface PkgPublishPayload {
  _id: string
  name: string
  description?: string
  'dist-tags': Record<string, string>
  versions: Record<string, PkgVersionMetadata>
  readme?: string
  _attachments: Record<string, PkgAttachment>
}

export interface PkgAttachment {
  content_type: string
  data: string // base64 encoded tarball
  length: number
}

export interface PkgSearchResult {
  objects: PkgSearchObject[]
  total: number
  time: string
}

export interface PkgSearchObject {
  package: {
    name: string
    scope?: string
    version: string
    description?: string
    keywords?: string[]
    date: string
    links?: {
      npm?: string
      homepage?: string
      repository?: string
      bugs?: string
    }
    author?: { name?: string; email?: string; username?: string }
    publisher?: { username: string; email?: string }
    maintainers?: Array<{ username: string; email?: string }>
  }
  score: {
    final: number
    detail: {
      quality: number
      popularity: number
      maintenance: number
    }
  }
  searchScore: number
}
export interface CreatePackageRequest {
  name: string
  scope?: string
  description?: string
  license?: string
  agentId?: string
}

export interface PublishVersionRequest {
  version: string
  tarball: string // base64 encoded
  manifest: PackageManifest
}

export interface PackageInfoResponse {
  packageId: Hex
  name: string
  scope: string
  fullName: string
  owner: Address
  description: string
  license: string
  homepage: string
  repository: string
  latestVersion: string
  createdAt: number
  updatedAt: number
  deprecated: boolean
  downloadCount: number
  versions: string[]
  maintainers: Array<{
    address: Address
    canPublish: boolean
    canManage: boolean
  }>
}
export interface StoredTarball {
  cid: string
  size: number
  integrity: string
}

export interface PackageManifest {
  name: string
  version: string
  description?: string
  main?: string
  types?: string
  module?: string
  exports?: Record<string, PkgExport>
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  bundledDependencies?: string[]
  engines?: Record<string, string>
  os?: string[]
  cpu?: string[]
  repository?: string | { type: string; url: string }
  keywords?: string[]
  author?: string | PkgPerson
  contributors?: Array<string | PkgPerson>
  license?: string
  homepage?: string
  bugs?: string | { url?: string; email?: string }
  funding?:
    | string
    | { type?: string; url: string }
    | Array<{ type?: string; url: string }>
  files?: string[]
  bin?: string | Record<string, string>
  directories?: Record<string, string>
  private?: boolean
  publishConfig?: {
    access?: 'public' | 'restricted'
    registry?: string
    tag?: string
  }
}
export type PublisherTier = 'free' | 'basic' | 'pro' | 'unlimited'

export interface PublisherAccount {
  address: Address
  balance: bigint
  stakedAmount: bigint
  tier: PublisherTier
  totalDownloads: number
  totalPublishes: number
  totalStorageBytes: bigint
  packages: string[]
  reputationScore: number
  createdAt: number
  lastActivity: number
}

export interface PublisherTierConfig {
  tier: PublisherTier
  monthlyPrice: bigint // In wei
  features: {
    privatePackages: number // -1 for unlimited
    storageGB: number
    downloadBandwidthGB: number
    publishesPerMonth: number
  }
}

export interface PkgPaymentRequirement {
  x402Version: number
  error: string
  accepts: Array<{
    scheme: 'exact' | 'streaming'
    network: string
    maxAmountRequired: string
    asset: Address
    payTo: Address
    resource: string
    description: string
  }>
}

export interface PkgPaymentConfig {
  paymentRecipient: Address
  tiers: PublisherTierConfig[]
  costs: {
    publishFreePackage: bigint
    publishPrivatePackage: bigint
    downloadPrivatePackage: bigint
    storagePerGB: bigint
  }
}
export interface CacheEntry<T> {
  data: T
  timestamp: number
  etag?: string
  ttl: number
}

export interface RegistryCache {
  packages: Map<string, CacheEntry<PkgPackageMetadata>>
  tarballs: Map<string, CacheEntry<Buffer>>
  searchResults: Map<string, CacheEntry<PkgSearchResult>>
}

export interface CacheConfig {
  enabled: boolean
  maxSize: number // Max entries
  defaultTTL: number // milliseconds
  tarballTTL: number // milliseconds (longer for immutable content)
  searchTTL: number // milliseconds (shorter for dynamic content)
}
export interface UpstreamRegistryConfig {
  url: string // e.g., 'https://registry.npmjs.org'
  timeout: number
  retries: number
  cacheAllPackages: boolean
  scopeWhitelist?: string[] // Only cache these scopes
  scopeBlacklist?: string[] // Never cache these scopes
}

export interface UpstreamSyncResult {
  packageName: string
  versionsAdded: string[]
  versionsCached: number
  tarballsCached: number
  totalSize: number
  duration: number
}
export interface PackageRecord {
  name: string
  scope?: string
  manifestCid: string
  latestVersion: string
  versions: string[]
  owner: Address
  createdAt: number
  updatedAt: number
  downloadCount: number
  storageBackend: 'ipfs' | 'arweave' | 'hybrid' | 'local'
  verified: boolean
  reputationScore?: number
  councilProposalId?: string
}

export interface TarballRecord {
  packageName: string
  version: string
  cid: string
  size: number
  shasum: string
  integrity: string
  backend: 'ipfs' | 'arweave' | 'hybrid' | 'local'
  uploadedAt: number
}
export type PkgActivityType =
  | 'publish'
  | 'download'
  | 'deprecate'
  | 'transfer'
  | 'star'

export interface PkgContribution {
  walletAddress: Address
  packageId: Hex
  packageName: string
  type: PkgActivityType
  timestamp: number
  metadata: {
    version?: string
    downloadCount?: number
    previousOwner?: Address
    newOwner?: Address
  }
}

export interface PkgReputationScore {
  totalScore: number
  components: {
    publishScore: number
    downloadScore: number
    qualityScore: number
    dependentScore: number
  }
  normalizedScore: number // 0-100 for ERC-8004
  lastUpdated: number
}

export interface PackageMetrics {
  downloadCount: number
  dependentCount: number
  starCount: number
  issueResolutionRate: number
  securityScore: number
  documentationScore: number
  testCoverage: number
  maintainerActivity: number
}
export interface PkgRegistryConfig {
  // Storage
  storageBackend: 'ipfs' | 'arweave' | 'hybrid' | 'local'
  ipfsUrl: string
  ipfsGatewayUrl: string
  arweaveUrl: string
  privateKey?: Hex

  // Payments
  paymentRecipient: Address
  allowPublicDownloads: boolean
  allowFreePublish: boolean
  maxPackageSize: number

  // Upstream
  upstreamRegistry: string
  upstreamEnabled: boolean

  // Caching
  cacheEnabled: boolean
  cacheTTL: number
  tarballCacheTTL: number

  // On-chain
  rpcUrl: string
  packageRegistryAddress: Address
}
