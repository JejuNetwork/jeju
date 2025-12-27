/**
 * JejuPkg SDK - Client for decentralized NPM package operations
 *
 * Provides TypeScript interface for:
 * - Package management
 * - Version publishing
 * - On-chain registry interaction
 */

import { getEnv, getEnvOrDefault } from '@jejunetwork/shared'
import type { JsonValue } from '@jejunetwork/types'
import type { Address, Hex, WalletClient } from 'viem'
import { createWalletClient, http } from 'viem'
import { type LocalAccount, privateKeyToAccount } from 'viem/accounts'
import {
  HealthCheckResponseSchema,
  LoginResponseSchema,
  PackageErrorResponseSchema,
  PackageManifestResponseSchema,
  PackagePublishResponseSchema,
  PackageSearchResponseSchema,
  PackageVersionInfoSchema,
  PublisherInfoSchema,
  SyncResponseSchema,
  WhoamiResponseSchema,
} from '../shared/schemas'

export interface PackageSDKConfig {
  rpcUrl: string
  registryUrl: string
  registryAddress?: Address
  privateKey?: Hex
}

export interface Package {
  name: string
  scope?: string
  fullName: string
  description?: string
  latestVersion: string
  versions: string[]
  distTags: Record<string, string>
  maintainers: string[]
  license?: string
  repository?: { type: string; url: string }
  keywords?: string[]
  downloadCount: number
  reputationScore?: number
  councilProposalId?: string
  verified: boolean
  deprecated: boolean
  createdAt: string
  updatedAt: string
}

export interface PackageVersion {
  name: string
  version: string
  description?: string
  main?: string
  types?: string
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  dist: {
    shasum: string
    tarball: string
    integrity?: string
    fileCount?: number
    unpackedSize?: number
  }
  publishedAt: string
  publishedBy: string
}

export interface Publisher {
  address: string
  username?: string
  jnsName?: string
  packages: string[]
  totalDownloads: number
  totalPublishes: number
  reputationScore: number
  verified: boolean
  createdAt: string
}

export interface SearchResult {
  package: {
    name: string
    version: string
    description?: string
    links: { npm: string }
  }
  score: {
    final: number
    detail: {
      quality: number
      popularity: number
      maintenance: number
    }
  }
}

/**
 * Package manifest for publishing - extends standard npm package.json fields
 */
export interface PackageManifest {
  name: string
  version: string
  description?: string
  main?: string
  types?: string
  module?: string
  exports?: Record<string, string | Record<string, string>>
  bin?: Record<string, string>
  scripts?: Record<string, string>
  dependencies?: Record<string, string>
  devDependencies?: Record<string, string>
  peerDependencies?: Record<string, string>
  optionalDependencies?: Record<string, string>
  keywords?: string[]
  author?: string | { name: string; email?: string; url?: string }
  license?: string
  repository?: { type: string; url: string }
  bugs?: { url: string }
  homepage?: string
  engines?: Record<string, string>
  files?: string[]
  publishConfig?: { access?: string; registry?: string }
  /** Additional manifest fields */
  [key: string]: JsonValue | undefined
}

const PACKAGE_REGISTRY_ABI = [
  {
    type: 'function',
    name: 'registerScope',
    inputs: [{ name: 'scope', type: 'string' }],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'createPackage',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'scope', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'visibility', type: 'uint8' },
      { name: 'manifestCid', type: 'string' },
    ],
    outputs: [{ type: 'bytes32' }],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'publishVersion',
    inputs: [
      { name: 'packageId', type: 'bytes32' },
      { name: 'version', type: 'string' },
      { name: 'tarballCid', type: 'string' },
      { name: 'integrity', type: 'string' },
      { name: 'size', type: 'uint256' },
      { name: 'manifestCid', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'updateDistTag',
    inputs: [
      { name: 'packageId', type: 'bytes32' },
      { name: 'tag', type: 'string' },
      { name: 'version', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'yankVersion',
    inputs: [
      { name: 'packageId', type: 'bytes32' },
      { name: 'version', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'deprecatePackage',
    inputs: [
      { name: 'packageId', type: 'bytes32' },
      { name: 'message', type: 'string' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'addMaintainer',
    inputs: [
      { name: 'packageId', type: 'bytes32' },
      { name: 'maintainer', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'removeMaintainer',
    inputs: [
      { name: 'packageId', type: 'bytes32' },
      { name: 'maintainer', type: 'address' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'linkCouncilProposal',
    inputs: [
      { name: 'packageId', type: 'bytes32' },
      { name: 'proposalId', type: 'uint256' },
    ],
    outputs: [],
    stateMutability: 'nonpayable',
  },
  {
    type: 'function',
    name: 'getPackage',
    inputs: [{ name: 'packageId', type: 'bytes32' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'name', type: 'string' },
          { name: 'scope', type: 'string' },
          { name: 'owner', type: 'address' },
          { name: 'description', type: 'string' },
          { name: 'visibility', type: 'uint8' },
          { name: 'manifestCid', type: 'string' },
          { name: 'latestVersion', type: 'string' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'updatedAt', type: 'uint256' },
          { name: 'downloadCount', type: 'uint256' },
          { name: 'publishCount', type: 'uint256' },
          { name: 'reputationScore', type: 'uint256' },
          { name: 'councilProposalId', type: 'uint256' },
          { name: 'verified', type: 'bool' },
          { name: 'deprecated', type: 'bool' },
          { name: 'deprecationMessage', type: 'string' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getPackageByName',
    inputs: [{ name: 'fullName', type: 'string' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'name', type: 'string' },
          { name: 'scope', type: 'string' },
          { name: 'owner', type: 'address' },
          { name: 'description', type: 'string' },
          { name: 'visibility', type: 'uint8' },
          { name: 'manifestCid', type: 'string' },
          { name: 'latestVersion', type: 'string' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'updatedAt', type: 'uint256' },
          { name: 'downloadCount', type: 'uint256' },
          { name: 'publishCount', type: 'uint256' },
          { name: 'reputationScore', type: 'uint256' },
          { name: 'councilProposalId', type: 'uint256' },
          { name: 'verified', type: 'bool' },
          { name: 'deprecated', type: 'bool' },
          { name: 'deprecationMessage', type: 'string' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getVersion',
    inputs: [
      { name: 'packageId', type: 'bytes32' },
      { name: 'version', type: 'string' },
    ],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'version', type: 'string' },
          { name: 'tarballCid', type: 'string' },
          { name: 'integrity', type: 'string' },
          { name: 'size', type: 'uint256' },
          { name: 'publishedAt', type: 'uint256' },
          { name: 'publishedBy', type: 'address' },
          { name: 'yanked', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getVersions',
    inputs: [{ name: 'packageId', type: 'bytes32' }],
    outputs: [{ type: 'string[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'isMaintainer',
    inputs: [
      { name: 'packageId', type: 'bytes32' },
      { name: 'addr', type: 'address' },
    ],
    outputs: [{ type: 'bool' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getPublisher',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [
      {
        type: 'tuple',
        components: [
          { name: 'addr', type: 'address' },
          { name: 'username', type: 'string' },
          { name: 'jnsName', type: 'string' },
          { name: 'totalPackages', type: 'uint256' },
          { name: 'totalDownloads', type: 'uint256' },
          { name: 'totalPublishes', type: 'uint256' },
          { name: 'reputationScore', type: 'uint256' },
          { name: 'stakedAmount', type: 'uint256' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'verified', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getPublisherPackages',
    inputs: [{ name: 'addr', type: 'address' }],
    outputs: [{ type: 'bytes32[]' }],
    stateMutability: 'view',
  },
  {
    type: 'function',
    name: 'getScopeOwner',
    inputs: [{ name: 'scope', type: 'string' }],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
] as const

export class JejuPkgSDK {
  private config: PackageSDKConfig
  private walletClient?: WalletClient
  private account?: LocalAccount

  constructor(config: PackageSDKConfig) {
    this.config = config

    if (config.privateKey) {
      this.account = privateKeyToAccount(config.privateKey)
      this.walletClient = createWalletClient({
        account: this.account,
        transport: http(config.rpcUrl),
      })
    }
  }

  // Package Operations

  async getPackage(name: string): Promise<Package> {
    const response = await fetch(
      `${this.config.registryUrl}/${encodeURIComponent(name)}`,
    )
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Package not found: ${name}`)
      }
      throw new Error(`Failed to get package: ${response.statusText}`)
    }

    const rawData: unknown = await response.json()
    const manifest = PackageManifestResponseSchema.parse(rawData)

    // Fetch download count from npm-stat or registry API
    let downloadCount = 0
    try {
      const downloadsResponse = await fetch(
        `https://api.npmjs.org/downloads/point/last-week/${encodeURIComponent(name)}`,
      )
      if (downloadsResponse.ok) {
        const downloadsData: unknown = await downloadsResponse.json()
        if (
          typeof downloadsData === 'object' &&
          downloadsData !== null &&
          'downloads' in downloadsData &&
          typeof downloadsData.downloads === 'number'
        ) {
          downloadCount = downloadsData.downloads
        }
      }
    } catch {
      // Download count is optional, continue with 0
    }

    return {
      name: manifest.name,
      scope: manifest.name.startsWith('@')
        ? manifest.name.split('/')[0]
        : undefined,
      fullName: manifest.name,
      description: manifest.description,
      latestVersion: manifest['dist-tags'].latest,
      versions: Object.keys(manifest.versions),
      distTags: manifest['dist-tags'],
      maintainers: manifest.maintainers?.map((m) => m.name) ?? [],
      license: manifest.license,
      repository: manifest.repository,
      keywords: manifest.keywords,
      downloadCount,
      verified: false,
      deprecated: false,
      createdAt: manifest.time?.created ?? new Date().toISOString(),
      updatedAt: manifest.time?.modified ?? new Date().toISOString(),
    }
  }

  async getPackageVersion(
    name: string,
    version: string,
  ): Promise<PackageVersion> {
    const response = await fetch(
      `${this.config.registryUrl}/${encodeURIComponent(name)}/${version}`,
    )
    if (!response.ok) {
      throw new Error(`Failed to get package version: ${response.statusText}`)
    }
    const rawData: unknown = await response.json()
    const parsed = PackageVersionInfoSchema.parse(rawData)
    return {
      ...parsed,
      publishedAt: parsed.publishedAt ?? new Date().toISOString(),
      publishedBy: parsed.publishedBy ?? 'unknown',
    }
  }

  async searchPackages(
    query: string,
    options?: {
      size?: number
      from?: number
    },
  ): Promise<{ total: number; items: SearchResult[] }> {
    const params = new URLSearchParams()
    params.set('text', query)
    if (options?.size) params.set('size', options.size.toString())
    if (options?.from) params.set('from', options.from.toString())

    const response = await fetch(
      `${this.config.registryUrl}/-/v1/search?${params}`,
    )
    if (!response.ok) {
      throw new Error(`Failed to search packages: ${response.statusText}`)
    }

    const rawData: unknown = await response.json()
    const data = PackageSearchResponseSchema.parse(rawData)
    return { total: data.total, items: data.objects }
  }

  // Publishing

  async publish(
    manifest: PackageManifest,
    tarball: Buffer,
    authToken: string,
  ): Promise<{ ok: boolean; id: string; rev: string }> {
    const tarballBase64 = tarball.toString('base64')
    const filename = `${manifest.name.replace(/\//g, '-')}-${manifest.version}.tgz`

    const body = {
      _id: manifest.name,
      name: manifest.name,
      description: manifest.description,
      'dist-tags': { latest: manifest.version },
      versions: {
        [manifest.version]: {
          ...manifest,
          _id: `${manifest.name}@${manifest.version}`,
          dist: {
            shasum: '',
            tarball: '',
          },
        },
      },
      _attachments: {
        [filename]: {
          content_type: 'application/octet-stream',
          data: tarballBase64,
          length: tarball.length,
        },
      },
    }

    const response = await fetch(
      `${this.config.registryUrl}/${encodeURIComponent(manifest.name)}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(body),
      },
    )

    if (!response.ok) {
      let errorMessage = response.statusText
      // Attempt to get error details from JSON response
      const contentType = response.headers.get('content-type')
      if (contentType?.includes('application/json')) {
        const rawError: unknown = await response.json()
        const errorResult = PackageErrorResponseSchema.safeParse(rawError)
        if (errorResult.success && errorResult.data.error) {
          errorMessage = errorResult.data.error
        }
      }
      throw new Error(`Failed to publish package: ${errorMessage}`)
    }

    const rawData: unknown = await response.json()
    return PackagePublishResponseSchema.parse(rawData)
  }

  async unpublish(
    name: string,
    _version: string,
    authToken: string,
  ): Promise<void> {
    const response = await fetch(
      `${this.config.registryUrl}/${encodeURIComponent(name)}/-rev/1`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      },
    )

    if (!response.ok) {
      throw new Error(`Failed to unpublish package: ${response.statusText}`)
    }
  }

  async deprecate(
    name: string,
    message: string,
    authToken: string,
  ): Promise<void> {
    // Get current package
    const pkg = await this.getPackage(name)

    // Update all versions with deprecation message
    const body = {
      name,
      versions: Object.fromEntries(
        pkg.versions.map((v) => [v, { deprecated: message }]),
      ),
    }

    const response = await fetch(
      `${this.config.registryUrl}/${encodeURIComponent(name)}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(body),
      },
    )

    if (!response.ok) {
      throw new Error(`Failed to deprecate package: ${response.statusText}`)
    }
  }

  // Dist Tags

  async addDistTag(
    name: string,
    version: string,
    tag: string,
    authToken: string,
  ): Promise<void> {
    const response = await fetch(
      `${this.config.registryUrl}/-/package/${encodeURIComponent(name)}/dist-tags/${tag}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${authToken}`,
        },
        body: JSON.stringify(version),
      },
    )

    if (!response.ok) {
      throw new Error(`Failed to add dist-tag: ${response.statusText}`)
    }
  }

  async removeDistTag(
    name: string,
    tag: string,
    authToken: string,
  ): Promise<void> {
    const response = await fetch(
      `${this.config.registryUrl}/-/package/${encodeURIComponent(name)}/dist-tags/${tag}`,
      {
        method: 'DELETE',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      },
    )

    if (!response.ok) {
      throw new Error(`Failed to remove dist-tag: ${response.statusText}`)
    }
  }

  // Download Tarball

  async downloadTarball(name: string, version: string): Promise<Buffer> {
    const pkg = await this.getPackageVersion(name, version)
    const response = await fetch(pkg.dist.tarball)

    if (!response.ok) {
      throw new Error(`Failed to download tarball: ${response.statusText}`)
    }

    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  }

  // Sync from upstream (npmjs.org - for compatibility)

  async syncFromUpstream(
    name: string,
    authToken: string,
  ): Promise<{ synced: number }> {
    const response = await fetch(
      `${this.config.registryUrl}/-/registry/sync/${encodeURIComponent(name)}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${authToken}`,
        },
      },
    )

    if (!response.ok) {
      throw new Error(`Failed to sync package: ${response.statusText}`)
    }

    const rawData: unknown = await response.json()
    return SyncResponseSchema.parse(rawData)
  }

  // Publisher Operations

  async getPublisher(address: string): Promise<Publisher> {
    const response = await fetch(
      `${this.config.registryUrl}/-/registry/accounts/${address}`,
    )
    if (!response.ok) {
      throw new Error(`Failed to get publisher: ${response.statusText}`)
    }
    const rawData: unknown = await response.json()
    return PublisherInfoSchema.parse(rawData)
  }

  async login(username: string, password: string): Promise<string> {
    const response = await fetch(
      `${this.config.registryUrl}/-/user/org.couchdb.user:${username}`,
      {
        method: 'PUT',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ name: username, password }),
      },
    )

    if (!response.ok) {
      throw new Error(`Failed to login: ${response.statusText}`)
    }

    const rawData: unknown = await response.json()
    const data = LoginResponseSchema.parse(rawData)
    return data.token
  }

  async whoami(authToken: string): Promise<string> {
    const response = await fetch(`${this.config.registryUrl}/-/whoami`, {
      headers: {
        Authorization: `Bearer ${authToken}`,
      },
    })

    if (!response.ok) {
      throw new Error(`Failed to get user: ${response.statusText}`)
    }

    const rawData: unknown = await response.json()
    const data = WhoamiResponseSchema.parse(rawData)
    return data.username
  }

  // On-chain operations (requires wallet)

  async registerScope(scope: string): Promise<Hex> {
    if (!this.walletClient || !this.account || !this.config.registryAddress) {
      throw new Error(
        'Wallet client and registry address required for on-chain operations',
      )
    }

    const hash = await this.walletClient.writeContract({
      account: this.account,
      address: this.config.registryAddress,
      abi: PACKAGE_REGISTRY_ABI,
      functionName: 'registerScope',
      args: [scope],
      chain: null,
    })

    return hash
  }

  async createPackageOnChain(
    name: string,
    scope: string,
    description: string,
    visibility: 0 | 1 | 2,
    manifestCid: string,
  ): Promise<Hex> {
    if (!this.walletClient || !this.account || !this.config.registryAddress) {
      throw new Error(
        'Wallet client and registry address required for on-chain operations',
      )
    }

    const hash = await this.walletClient.writeContract({
      account: this.account,
      address: this.config.registryAddress,
      abi: PACKAGE_REGISTRY_ABI,
      functionName: 'createPackage',
      args: [name, scope, description, visibility, manifestCid],
      chain: null,
    })

    return hash
  }

  async linkCouncilProposal(packageId: Hex, proposalId: bigint): Promise<Hex> {
    if (!this.walletClient || !this.account || !this.config.registryAddress) {
      throw new Error(
        'Wallet client and registry address required for on-chain operations',
      )
    }

    const hash = await this.walletClient.writeContract({
      account: this.account,
      address: this.config.registryAddress,
      abi: PACKAGE_REGISTRY_ABI,
      functionName: 'linkCouncilProposal',
      args: [packageId, proposalId],
      chain: null,
    })

    return hash
  }

  // Health check

  async healthCheck(): Promise<{ status: string; service: string }> {
    // DWS pkg registry uses /pkg/health endpoint (npm CLI compatible)
    const response = await fetch(`${this.config.registryUrl}/pkg/health`)
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.statusText}`)
    }
    const rawData: unknown = await response.json()
    return HealthCheckResponseSchema.parse(rawData)
  }

  // Registry URL helper for npm/bun config (compatibility)

  getRegistryUrl(): string {
    return this.config.registryUrl
  }
}

export function createJejuPkgSDK(config: PackageSDKConfig): JejuPkgSDK {
  return new JejuPkgSDK(config)
}

// Convenience function for default config
export function createDefaultPkgSDK(): JejuPkgSDK {
  return new JejuPkgSDK({
    rpcUrl: getEnvOrDefault('JEJU_RPC_URL', 'http://127.0.0.1:6546'),
    registryUrl: getEnvOrDefault('JEJUPKG_URL', 'http://localhost:4030/pkg'),
    registryAddress: getEnv('PACKAGE_REGISTRY_ADDRESS') as Address | undefined,
  })
}

// NPM CLI integration helpers

export function generateNpmrc(registryUrl: string, authToken?: string): string {
  let content = `registry=${registryUrl}\n`
  if (authToken) {
    const url = new URL(registryUrl)
    content += `//${url.host}/:_authToken=${authToken}\n`
  }
  return content
}

export function generateBunfigToml(registryUrl: string): string {
  return `[install]
registry = "${registryUrl}"
`
}
