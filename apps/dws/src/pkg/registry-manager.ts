/**
 * Package Registry Manager (JejuPkg)
 * Manages packages with on-chain registry integration
 */

import { createHash } from 'node:crypto'
import { expectJson } from '@jejunetwork/types'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  decodeEventLog,
  type Hex,
  http,
  keccak256,
  type PublicClient,
  toBytes,
  type WalletClient,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { foundry } from 'viem/chains'
import { PackageManifestSchema } from '../shared/schemas/internal-storage'
import type { BackendManager } from '../storage/backends'
import { decodeBytes32ToCidKey, encodeCidToBytes32 } from './cid-utils'
import type {
  Package,
  PackageManifest,
  PackageVersion,
  PkgPackageMetadata,
  PkgVersionMetadata,
} from './types'

// Type for package data returned from contract
interface ContractPackageData {
  packageId: `0x${string}`
  name: string
  scope: string
  owner: `0x${string}`
  agentId: bigint
  jnsNode: `0x${string}`
  description: string
  license: string
  homepage: string
  repository: string
  latestVersion: `0x${string}`
  createdAt: bigint
  updatedAt: bigint
  deprecated: boolean
  downloadCount: bigint
}

// Type for version data returned from contract
interface ContractVersionData {
  versionId: `0x${string}`
  packageId: `0x${string}`
  version: string
  tarballCid: `0x${string}`
  integrityHash: `0x${string}`
  manifestCid: `0x${string}`
  size: bigint
  publisher: `0x${string}`
  publishedAt: bigint
  deprecated: boolean
  deprecationMessage: string
}

// PackageRegistry ABI (subset for our needs)
const PACKAGE_REGISTRY_ABI = [
  {
    name: 'createPackage',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'scope', type: 'string' },
      { name: 'description', type: 'string' },
      { name: 'license', type: 'string' },
      { name: 'agentId', type: 'uint256' },
    ],
    outputs: [{ name: 'packageId', type: 'bytes32' }],
  },
  {
    name: 'publishVersion',
    type: 'function',
    inputs: [
      { name: 'packageId', type: 'bytes32' },
      { name: 'version', type: 'string' },
      { name: 'tarballCid', type: 'bytes32' },
      { name: 'integrityHash', type: 'bytes32' },
      { name: 'manifestCid', type: 'bytes32' },
      { name: 'size', type: 'uint256' },
    ],
    outputs: [{ name: 'versionId', type: 'bytes32' }],
  },
  {
    name: 'getPackage',
    type: 'function',
    inputs: [{ name: 'packageId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'packageId', type: 'bytes32' },
          { name: 'name', type: 'string' },
          { name: 'scope', type: 'string' },
          { name: 'owner', type: 'address' },
          { name: 'agentId', type: 'uint256' },
          { name: 'jnsNode', type: 'bytes32' },
          { name: 'description', type: 'string' },
          { name: 'license', type: 'string' },
          { name: 'homepage', type: 'string' },
          { name: 'repository', type: 'string' },
          { name: 'latestVersion', type: 'bytes32' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'updatedAt', type: 'uint256' },
          { name: 'deprecated', type: 'bool' },
          { name: 'downloadCount', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'getPackageByName',
    type: 'function',
    inputs: [
      { name: 'name', type: 'string' },
      { name: 'scope', type: 'string' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'packageId', type: 'bytes32' },
          { name: 'name', type: 'string' },
          { name: 'scope', type: 'string' },
          { name: 'owner', type: 'address' },
          { name: 'agentId', type: 'uint256' },
          { name: 'jnsNode', type: 'bytes32' },
          { name: 'description', type: 'string' },
          { name: 'license', type: 'string' },
          { name: 'homepage', type: 'string' },
          { name: 'repository', type: 'string' },
          { name: 'latestVersion', type: 'bytes32' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'updatedAt', type: 'uint256' },
          { name: 'deprecated', type: 'bool' },
          { name: 'downloadCount', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'getVersion',
    type: 'function',
    inputs: [
      { name: 'packageId', type: 'bytes32' },
      { name: 'version', type: 'string' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'versionId', type: 'bytes32' },
          { name: 'packageId', type: 'bytes32' },
          { name: 'version', type: 'string' },
          { name: 'tarballCid', type: 'bytes32' },
          { name: 'integrityHash', type: 'bytes32' },
          { name: 'manifestCid', type: 'bytes32' },
          { name: 'size', type: 'uint256' },
          { name: 'publisher', type: 'address' },
          { name: 'publishedAt', type: 'uint256' },
          { name: 'deprecated', type: 'bool' },
          { name: 'deprecationMessage', type: 'string' },
        ],
      },
    ],
  },
  {
    name: 'getVersions',
    type: 'function',
    inputs: [{ name: 'packageId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        components: [
          { name: 'versionId', type: 'bytes32' },
          { name: 'packageId', type: 'bytes32' },
          { name: 'version', type: 'string' },
          { name: 'tarballCid', type: 'bytes32' },
          { name: 'integrityHash', type: 'bytes32' },
          { name: 'manifestCid', type: 'bytes32' },
          { name: 'size', type: 'uint256' },
          { name: 'publisher', type: 'address' },
          { name: 'publishedAt', type: 'uint256' },
          { name: 'deprecated', type: 'bool' },
          { name: 'deprecationMessage', type: 'string' },
        ],
      },
    ],
  },
  {
    name: 'getLatestVersion',
    type: 'function',
    inputs: [{ name: 'packageId', type: 'bytes32' }],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'versionId', type: 'bytes32' },
          { name: 'packageId', type: 'bytes32' },
          { name: 'version', type: 'string' },
          { name: 'tarballCid', type: 'bytes32' },
          { name: 'integrityHash', type: 'bytes32' },
          { name: 'manifestCid', type: 'bytes32' },
          { name: 'size', type: 'uint256' },
          { name: 'publisher', type: 'address' },
          { name: 'publishedAt', type: 'uint256' },
          { name: 'deprecated', type: 'bool' },
          { name: 'deprecationMessage', type: 'string' },
        ],
      },
    ],
  },
  {
    name: 'canPublish',
    type: 'function',
    inputs: [
      { name: 'packageId', type: 'bytes32' },
      { name: 'user', type: 'address' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  {
    name: 'getAllPackages',
    type: 'function',
    inputs: [
      { name: 'offset', type: 'uint256' },
      { name: 'limit', type: 'uint256' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple[]',
        components: [
          { name: 'packageId', type: 'bytes32' },
          { name: 'name', type: 'string' },
          { name: 'scope', type: 'string' },
          { name: 'owner', type: 'address' },
          { name: 'agentId', type: 'uint256' },
          { name: 'jnsNode', type: 'bytes32' },
          { name: 'description', type: 'string' },
          { name: 'license', type: 'string' },
          { name: 'homepage', type: 'string' },
          { name: 'repository', type: 'string' },
          { name: 'latestVersion', type: 'bytes32' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'updatedAt', type: 'uint256' },
          { name: 'deprecated', type: 'bool' },
          { name: 'downloadCount', type: 'uint256' },
        ],
      },
    ],
  },
  {
    name: 'getPackageCount',
    type: 'function',
    inputs: [],
    outputs: [{ name: '', type: 'uint256' }],
  },
  {
    name: 'recordDownload',
    type: 'function',
    inputs: [
      { name: 'packageId', type: 'bytes32' },
      { name: 'versionId', type: 'bytes32' },
    ],
    outputs: [],
  },
  // Events
  {
    name: 'VersionPublished',
    type: 'event',
    inputs: [
      { name: 'packageId', type: 'bytes32', indexed: true },
      { name: 'versionId', type: 'bytes32', indexed: false },
      { name: 'version', type: 'string', indexed: false },
      { name: 'publisher', type: 'address', indexed: true },
    ],
  },
] as const

export interface PkgRegistryManagerConfig {
  rpcUrl: string
  packageRegistryAddress: Address
  privateKey?: Hex
}

export class PkgRegistryManager {
  private publicClient: PublicClient
  private walletClient: WalletClient | null = null
  private packageRegistryAddress: Address
  private backend: BackendManager
  private manifestCache: Map<string, PackageManifest> = new Map()
  private cidMap: Map<Hex, string> = new Map() // bytes32 hash -> original CID string

  constructor(config: PkgRegistryManagerConfig, backend: BackendManager) {
    this.backend = backend
    this.packageRegistryAddress = config.packageRegistryAddress

    const chain = {
      ...foundry,
      rpcUrls: {
        default: { http: [config.rpcUrl] },
      },
    }

    this.publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    })

    if (config.privateKey) {
      const account = privateKeyToAccount(config.privateKey)
      this.walletClient = createWalletClient({
        account,
        chain,
        transport: http(config.rpcUrl),
      })
    }
  }

  /**
   * Parse a package name into scope and name
   */
  parsePackageName(fullName: string): { name: string; scope: string } {
    if (!fullName || typeof fullName !== 'string') {
      throw new Error('Package name must be a non-empty string')
    }

    if (fullName.length > 214) {
      throw new Error('Package name exceeds maximum length of 214 characters')
    }

    // Validate package name format (npm spec)
    if (
      !/^(@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*$/i.test(fullName)
    ) {
      throw new Error(`Invalid package name format: ${fullName}`)
    }

    if (fullName.startsWith('@')) {
      const parts = fullName.split('/')
      if (parts.length < 2) {
        throw new Error(`Invalid scoped package name: ${fullName}`)
      }
      return { scope: parts[0], name: parts.slice(1).join('/') }
    }
    return { name: fullName, scope: '' }
  }

  /**
   * Get full package name from scope and name
   */
  getFullName(name: string, scope: string): string {
    return scope ? `${scope}/${name}` : name
  }

  /**
   * Generate package ID
   */
  generatePackageId(name: string, scope: string): Hex {
    return keccak256(toBytes(`${scope}/${name}`))
  }

  /**
   * Get package by ID
   */
  async getPackage(packageId: Hex): Promise<Package | null> {
    const result = (await this.publicClient.readContract({
      address: this.packageRegistryAddress,
      abi: PACKAGE_REGISTRY_ABI,
      functionName: 'getPackage',
      args: [packageId],
    })) as ContractPackageData

    if (!result || result.createdAt === 0n) {
      return null
    }

    return this.mapContractPackage(result)
  }

  /**
   * Get package by name
   */
  async getPackageByName(fullName: string): Promise<Package | null> {
    const { name, scope } = this.parsePackageName(fullName)

    const result = (await this.publicClient.readContract({
      address: this.packageRegistryAddress,
      abi: PACKAGE_REGISTRY_ABI,
      functionName: 'getPackageByName',
      args: [name, scope],
    })) as ContractPackageData

    if (!result || result.createdAt === 0n) {
      return null
    }

    return this.mapContractPackage(result)
  }

  /**
   * Get package metadata in npm CLI compatible format (for compatibility)
   */
  async getPkgMetadata(fullName: string): Promise<PkgPackageMetadata | null> {
    const pkg = await this.getPackageByName(fullName)
    if (!pkg) return null

    const versions = await this.getVersions(pkg.packageId)
    const latestVersion = versions.find(
      (v) => v.versionId === pkg.latestVersion,
    )

    const versionRecords: Record<string, PkgVersionMetadata> = {}
    const timeRecords: Record<string, string> = {
      created: new Date(Number(pkg.createdAt) * 1000).toISOString(),
      modified: new Date(Number(pkg.updatedAt) * 1000).toISOString(),
    }

    for (const ver of versions) {
      const manifest = await this.getManifest(ver.manifestCid)
      const tarballUrl = await this.getTarballUrl(ver.tarballCid)

      versionRecords[ver.version] = {
        name: this.getFullName(pkg.name, pkg.scope),
        version: ver.version,
        description: manifest?.description || pkg.description,
        main: manifest?.main,
        scripts: manifest?.scripts,
        dependencies: manifest?.dependencies,
        devDependencies: manifest?.devDependencies,
        peerDependencies: manifest?.peerDependencies,
        engines: manifest?.engines,
        keywords: manifest?.keywords,
        license: manifest?.license || pkg.license,
        dist: {
          shasum: ver.integrityHash.slice(2, 42),
          tarball: tarballUrl,
          integrity: `sha512-${Buffer.from(ver.integrityHash.slice(2), 'hex').toString('base64')}`,
          unpackedSize: Number(ver.size),
        },
        deprecated: ver.deprecated ? ver.deprecationMessage : undefined,
        _id: `${this.getFullName(pkg.name, pkg.scope)}@${ver.version}`,
        _npmUser: { name: ver.publisher },
      }

      timeRecords[ver.version] = new Date(
        Number(ver.publishedAt) * 1000,
      ).toISOString()
    }

    return {
      _id: this.getFullName(pkg.name, pkg.scope),
      name: this.getFullName(pkg.name, pkg.scope),
      description: pkg.description,
      'dist-tags': {
        latest: latestVersion?.version || versions[0]?.version || '0.0.0',
      },
      versions: versionRecords,
      time: timeRecords,
      maintainers: [{ name: pkg.owner }],
      license: pkg.license,
      homepage: pkg.homepage,
      repository: pkg.repository
        ? { type: 'git', url: pkg.repository }
        : undefined,
    }
  }

  /**
   * Get all versions of a package
   */
  async getVersions(packageId: Hex): Promise<PackageVersion[]> {
    const result = (await this.publicClient.readContract({
      address: this.packageRegistryAddress,
      abi: PACKAGE_REGISTRY_ABI,
      functionName: 'getVersions',
      args: [packageId],
    })) as ContractVersionData[]

    return result.map((v: ContractVersionData) => this.mapContractVersion(v))
  }

  /**
   * Get a specific version
   */
  async getVersion(
    packageId: Hex,
    version: string,
  ): Promise<PackageVersion | null> {
    const result = (await this.publicClient.readContract({
      address: this.packageRegistryAddress,
      abi: PACKAGE_REGISTRY_ABI,
      functionName: 'getVersion',
      args: [packageId, version],
    })) as ContractVersionData

    if (!result || result.publishedAt === 0n) {
      return null
    }

    return this.mapContractVersion(result)
  }

  /**
   * Publish a new package or version
   */
  async publish(
    fullName: string,
    manifest: PackageManifest,
    tarball: Buffer,
    publisher: Address,
  ): Promise<{ packageId: Hex; versionId: Hex }> {
    // Input validation
    if (!this.walletClient) {
      throw new Error('Wallet not configured for write operations')
    }

    if (
      !publisher ||
      typeof publisher !== 'string' ||
      !/^0x[a-fA-F0-9]{40}$/.test(publisher)
    ) {
      throw new Error('Invalid publisher address')
    }

    if (!manifest || !manifest.name || !manifest.version) {
      throw new Error('Manifest must include name and version')
    }

    // Validate version format (semver)
    if (
      !/^\d+\.\d+\.\d+(-[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*)?(\+[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*)?$/.test(
        manifest.version,
      )
    ) {
      throw new Error(
        `Invalid version format: ${manifest.version}. Expected semver format.`,
      )
    }

    if (fullName !== manifest.name) {
      throw new Error(`Package name mismatch: ${fullName} !== ${manifest.name}`)
    }

    if (tarball.length === 0) {
      throw new Error('Tarball cannot be empty')
    }

    if (tarball.length > 100 * 1024 * 1024) {
      throw new Error('Tarball exceeds maximum size of 100MB')
    }

    const { name, scope } = this.parsePackageName(fullName)
    let pkg = await this.getPackageByName(fullName)

    // Create package if it doesn't exist
    if (!pkg) {
      let createHash: Hex
      try {
        const { request: createRequest } =
          await this.publicClient.simulateContract({
            address: this.packageRegistryAddress,
            abi: PACKAGE_REGISTRY_ABI,
            functionName: 'createPackage',
            args: [
              name,
              scope,
              manifest.description || '',
              manifest.license || '',
              0n,
            ],
            account: publisher,
          })

        createHash = await this.walletClient.writeContract(createRequest)
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        throw new Error(`Failed to create package ${fullName}: ${errorMessage}`)
      }

      try {
        await this.publicClient.waitForTransactionReceipt({ hash: createHash })
      } catch (error) {
        const errorMessage =
          error instanceof Error ? error.message : String(error)
        throw new Error(
          `Failed to wait for package creation transaction ${createHash}: ${errorMessage}`,
        )
      }

      pkg = await this.getPackageByName(fullName)
      if (!pkg) {
        throw new Error(
          `Package ${fullName} was not found after creation. Transaction: ${createHash}`,
        )
      }
    }

    // Store tarball
    let tarballResult: { cid: string; url: string }
    try {
      tarballResult = await this.backend.upload(tarball, {
        filename: `${name}-${manifest.version}.tgz`,
      })
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      throw new Error(
        `Failed to upload tarball for ${fullName}@${manifest.version}: ${errorMessage}`,
      )
    }

    // Calculate integrity hash (SHA-512)
    const integrityHash = createHash('sha512').update(tarball).digest('hex')
    const integrityBytes32 = `0x${integrityHash.slice(0, 64)}` as Hex

    // Store manifest
    let manifestResult: { cid: string; url: string }
    try {
      const manifestBuffer = Buffer.from(JSON.stringify(manifest))
      manifestResult = await this.backend.upload(manifestBuffer, {
        filename: `${name}-${manifest.version}-package.json`,
      })
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      throw new Error(
        `Failed to upload manifest for ${fullName}@${manifest.version}: ${errorMessage}`,
      )
    }

    // Convert CIDs to bytes32 using proper encoding
    const tarballCidBytes32 = encodeCidToBytes32(tarballResult.cid)
    const manifestCidBytes32 = encodeCidToBytes32(manifestResult.cid)

    // Store mapping for later retrieval
    this.cidMap.set(tarballCidBytes32, tarballResult.cid)
    this.cidMap.set(manifestCidBytes32, manifestResult.cid)

    // Publish version on-chain
    let publishHash: Hex
    try {
      const { request: publishRequest } =
        await this.publicClient.simulateContract({
          address: this.packageRegistryAddress,
          abi: PACKAGE_REGISTRY_ABI,
          functionName: 'publishVersion',
          args: [
            pkg.packageId,
            manifest.version,
            tarballCidBytes32,
            integrityBytes32,
            manifestCidBytes32,
            BigInt(tarball.length),
          ],
          account: publisher,
        })

      publishHash = await this.walletClient.writeContract(publishRequest)
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      throw new Error(
        `Failed to publish version ${manifest.version} of ${fullName}: ${errorMessage}`,
      )
    }

    let receipt: Awaited<
      ReturnType<typeof this.publicClient.waitForTransactionReceipt>
    >
    try {
      receipt = await this.publicClient.waitForTransactionReceipt({
        hash: publishHash,
      })
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error)
      throw new Error(
        `Failed to wait for publish transaction ${publishHash}: ${errorMessage}`,
      )
    }

    // Extract versionId from logs using event signature
    const versionPublishedEvent = receipt.logs.find((log) => {
      try {
        const decoded = decodeEventLog({
          abi: PACKAGE_REGISTRY_ABI,
          data: log.data,
          topics: log.topics,
        })
        return decoded.eventName === 'VersionPublished'
      } catch {
        return false
      }
    })

    if (!versionPublishedEvent) {
      throw new Error(
        `VersionPublished event not found in transaction receipt ${publishHash}. Logs: ${receipt.logs.length}`,
      )
    }

    const decoded = decodeEventLog({
      abi: PACKAGE_REGISTRY_ABI,
      data: versionPublishedEvent.data,
      topics: versionPublishedEvent.topics,
    })

    if (decoded.eventName !== 'VersionPublished') {
      throw new Error(
        `Expected VersionPublished event, got ${decoded.eventName}`,
      )
    }

    const versionId = decoded.args.versionId

    return { packageId: pkg.packageId, versionId }
  }

  /**
   * Get manifest from storage
   */
  async getManifest(manifestCid: Hex): Promise<PackageManifest | null> {
    // Look up original CID from bytes32 hash
    const cidString = this.cidMap.get(manifestCid)
    if (!cidString) {
      // Fallback: try using the hex directly (for backwards compatibility)
      void decodeBytes32ToCidKey(manifestCid) // For potential future use
      // Try to find CID by iterating through known CIDs
      for (const [hash, cid] of this.cidMap) {
        if (hash === manifestCid) {
          const result = await this.backend
            .download(cid)
            .catch((err: Error) => {
              console.error(
                `[Pkg Registry] Failed to download manifest ${cid}: ${err.message}`,
              )
              return null
            })
          if (result) {
            const manifest = expectJson(
              result.content.toString(),
              PackageManifestSchema,
              'package manifest',
            )
            this.manifestCache.set(cid, manifest)
            return manifest
          }
        }
      }
      console.error(`[Pkg Registry] CID not found for bytes32: ${manifestCid}`)
      return null
    }

    const cached = this.manifestCache.get(cidString)
    if (cached) return cached

    const result = await this.backend
      .download(cidString)
      .catch((err: Error) => {
        console.error(
          `[Pkg Registry] Failed to download manifest ${cidString}: ${err.message}`,
        )
        return null
      })
    if (!result) return null

    const manifest = expectJson(
      result.content.toString(),
      PackageManifestSchema,
      'package manifest',
    )
    this.manifestCache.set(cidString, manifest)
    return manifest
  }

  /**
   * Get tarball download URL
   */
  async getTarballUrl(tarballCid: Hex): Promise<string> {
    const cidString = this.cidMap.get(tarballCid)
    if (!cidString) {
      throw new Error(`CID not found for bytes32: ${tarballCid}`)
    }
    const baseUrl = process.env.DWS_BASE_URL || 'http://localhost:4030'
    return `${baseUrl}/storage/download/${cidString}`
  }

  /**
   * Download tarball
   */
  async downloadTarball(tarballCid: Hex): Promise<Buffer | null> {
    const cidString = this.cidMap.get(tarballCid)
    if (!cidString) {
      console.error(`[Pkg Registry] CID not found for bytes32: ${tarballCid}`)
      return null
    }

    const result = await this.backend
      .download(cidString)
      .catch((err: Error) => {
        console.error(
          `[Pkg Registry] Failed to download tarball ${cidString}: ${err.message}`,
        )
        return null
      })
    return result?.content || null
  }

  /**
   * Record a download (for analytics)
   */
  async recordDownload(packageId: Hex, versionId: Hex): Promise<void> {
    if (!this.walletClient?.account) return

    const { request } = await this.publicClient.simulateContract({
      address: this.packageRegistryAddress,
      abi: PACKAGE_REGISTRY_ABI,
      functionName: 'recordDownload',
      args: [packageId, versionId],
      account: this.walletClient.account,
    })

    await this.walletClient.writeContract(request)
  }

  /**
   * Search packages
   */
  async searchPackages(
    query: string,
    offset: number,
    limit: number,
  ): Promise<Package[]> {
    const allPackages = (await this.publicClient.readContract({
      address: this.packageRegistryAddress,
      abi: PACKAGE_REGISTRY_ABI,
      functionName: 'getAllPackages',
      args: [BigInt(offset), BigInt(limit * 10)],
    })) as ContractPackageData[]

    const packages = allPackages.map((p: ContractPackageData) =>
      this.mapContractPackage(p),
    )

    // Simple text search
    const queryLower = query.toLowerCase()
    const filtered = packages.filter(
      (p) =>
        p.name.toLowerCase().includes(queryLower) ||
        p.description.toLowerCase().includes(queryLower) ||
        p.scope.toLowerCase().includes(queryLower),
    )

    return filtered.slice(0, limit)
  }

  /**
   * Get package count
   */
  async getPackageCount(): Promise<number> {
    const count = await this.publicClient.readContract({
      address: this.packageRegistryAddress,
      abi: PACKAGE_REGISTRY_ABI,
      functionName: 'getPackageCount',
    })

    return Number(count)
  }

  // ============ Private Helpers ============

  private mapContractPackage(result: {
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
  }): Package {
    return {
      packageId: result.packageId,
      name: result.name,
      scope: result.scope,
      owner: result.owner,
      agentId: result.agentId,
      jnsNode: result.jnsNode,
      description: result.description,
      license: result.license,
      homepage: result.homepage,
      repository: result.repository,
      latestVersion: result.latestVersion,
      createdAt: result.createdAt,
      updatedAt: result.updatedAt,
      deprecated: result.deprecated,
      downloadCount: result.downloadCount,
    }
  }

  private mapContractVersion(result: {
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
  }): PackageVersion {
    return {
      versionId: result.versionId,
      packageId: result.packageId,
      version: result.version,
      tarballCid: result.tarballCid,
      integrityHash: result.integrityHash,
      manifestCid: result.manifestCid,
      size: result.size,
      publisher: result.publisher,
      publishedAt: result.publishedAt,
      deprecated: result.deprecated,
      deprecationMessage: result.deprecationMessage,
    }
  }
}

// Export type alias for backwards compatibility
export type { PkgRegistryManagerConfig as NpmRegistryManagerConfig }
export { PkgRegistryManager as NpmRegistryManager }
