/**
 * NPM Registry Manager
 * Manages npm packages with on-chain registry integration
 */

import { createHash } from 'crypto';
import {
  createPublicClient,
  createWalletClient,
  http,
  type Address,
  type Hex,
  type PublicClient,
  type WalletClient,
  keccak256,
  toBytes,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { foundry } from 'viem/chains';
import type { BackendManager } from '../storage/backends';
import type {
  Package,
  PackageVersion,
  Maintainer,
  NpmPackageMetadata,
  NpmVersionMetadata,
  PackageManifest,
  StoredTarball,
} from './types';

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
] as const;

export interface RegistryManagerConfig {
  rpcUrl: string;
  packageRegistryAddress: Address;
  privateKey?: Hex;
}

export class NpmRegistryManager {
  private publicClient: PublicClient;
  private walletClient: WalletClient | null = null;
  private packageRegistryAddress: Address;
  private backend: BackendManager;
  private manifestCache: Map<string, PackageManifest> = new Map();

  constructor(config: RegistryManagerConfig, backend: BackendManager) {
    this.backend = backend;
    this.packageRegistryAddress = config.packageRegistryAddress;

    const chain = {
      ...foundry,
      rpcUrls: {
        default: { http: [config.rpcUrl] },
      },
    };

    this.publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    });

    if (config.privateKey) {
      const account = privateKeyToAccount(config.privateKey);
      this.walletClient = createWalletClient({
        account,
        chain,
        transport: http(config.rpcUrl),
      });
    }
  }

  /**
   * Parse a package name into scope and name
   */
  parsePackageName(fullName: string): { name: string; scope: string } {
    if (fullName.startsWith('@')) {
      const parts = fullName.split('/');
      return { scope: parts[0], name: parts.slice(1).join('/') };
    }
    return { name: fullName, scope: '' };
  }

  /**
   * Get full package name from scope and name
   */
  getFullName(name: string, scope: string): string {
    return scope ? `${scope}/${name}` : name;
  }

  /**
   * Generate package ID
   */
  generatePackageId(name: string, scope: string): Hex {
    return keccak256(toBytes(`${scope}/${name}`));
  }

  /**
   * Get package by ID
   */
  async getPackage(packageId: Hex): Promise<Package | null> {
    const result = await this.publicClient.readContract({
      address: this.packageRegistryAddress,
      abi: PACKAGE_REGISTRY_ABI,
      functionName: 'getPackage',
      args: [packageId],
    });

    if (!result || result.createdAt === 0n) {
      return null;
    }

    return this.mapContractPackage(result);
  }

  /**
   * Get package by name
   */
  async getPackageByName(fullName: string): Promise<Package | null> {
    const { name, scope } = this.parsePackageName(fullName);

    const result = await this.publicClient.readContract({
      address: this.packageRegistryAddress,
      abi: PACKAGE_REGISTRY_ABI,
      functionName: 'getPackageByName',
      args: [name, scope],
    });

    if (!result || result.createdAt === 0n) {
      return null;
    }

    return this.mapContractPackage(result);
  }

  /**
   * Get package metadata in NPM format
   */
  async getNpmMetadata(fullName: string): Promise<NpmPackageMetadata | null> {
    const pkg = await this.getPackageByName(fullName);
    if (!pkg) return null;

    const versions = await this.getVersions(pkg.packageId);
    const latestVersion = versions.find((v) => v.versionId === pkg.latestVersion);

    const versionRecords: Record<string, NpmVersionMetadata> = {};
    const timeRecords: Record<string, string> = {
      created: new Date(Number(pkg.createdAt) * 1000).toISOString(),
      modified: new Date(Number(pkg.updatedAt) * 1000).toISOString(),
    };

    for (const ver of versions) {
      const manifest = await this.getManifest(ver.manifestCid);
      const tarballUrl = await this.getTarballUrl(ver.tarballCid);

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
          shasum: ver.integrityHash.slice(2, 42), // First 40 chars as shasum
          tarball: tarballUrl,
          integrity: `sha512-${Buffer.from(ver.integrityHash.slice(2), 'hex').toString('base64')}`,
          unpackedSize: Number(ver.size),
        },
        deprecated: ver.deprecated ? ver.deprecationMessage : undefined,
        _id: `${this.getFullName(pkg.name, pkg.scope)}@${ver.version}`,
        _npmUser: { name: ver.publisher },
      };

      timeRecords[ver.version] = new Date(Number(ver.publishedAt) * 1000).toISOString();
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
      repository: pkg.repository ? { type: 'git', url: pkg.repository } : undefined,
    };
  }

  /**
   * Get all versions of a package
   */
  async getVersions(packageId: Hex): Promise<PackageVersion[]> {
    const result = await this.publicClient.readContract({
      address: this.packageRegistryAddress,
      abi: PACKAGE_REGISTRY_ABI,
      functionName: 'getVersions',
      args: [packageId],
    });

    return result.map((v) => this.mapContractVersion(v));
  }

  /**
   * Get a specific version
   */
  async getVersion(packageId: Hex, version: string): Promise<PackageVersion | null> {
    const result = await this.publicClient.readContract({
      address: this.packageRegistryAddress,
      abi: PACKAGE_REGISTRY_ABI,
      functionName: 'getVersion',
      args: [packageId, version],
    });

    if (!result || result.publishedAt === 0n) {
      return null;
    }

    return this.mapContractVersion(result);
  }

  /**
   * Publish a new package or version
   */
  async publish(
    fullName: string,
    manifest: PackageManifest,
    tarball: Buffer,
    publisher: Address
  ): Promise<{ packageId: Hex; versionId: Hex }> {
    if (!this.walletClient) {
      throw new Error('Wallet not configured for write operations');
    }

    const { name, scope } = this.parsePackageName(fullName);
    let pkg = await this.getPackageByName(fullName);

    // Create package if it doesn't exist
    if (!pkg) {
      const { request: createRequest } = await this.publicClient.simulateContract({
        address: this.packageRegistryAddress,
        abi: PACKAGE_REGISTRY_ABI,
        functionName: 'createPackage',
        args: [name, scope, manifest.description || '', manifest.license || '', 0n],
        account: publisher,
      });

      const createHash = await this.walletClient.writeContract(createRequest);
      await this.publicClient.waitForTransactionReceipt({ hash: createHash });

      pkg = await this.getPackageByName(fullName);
      if (!pkg) {
        throw new Error('Failed to create package');
      }
    }

    // Store tarball
    const tarballResult = await this.backend.upload(tarball, {
      filename: `${name}-${manifest.version}.tgz`,
    });

    // Calculate integrity hash (SHA-512)
    const integrityHash = createHash('sha512').update(tarball).digest('hex');
    const integrityBytes32 = `0x${integrityHash.slice(0, 64)}` as Hex;

    // Store manifest
    const manifestBuffer = Buffer.from(JSON.stringify(manifest));
    const manifestResult = await this.backend.upload(manifestBuffer, {
      filename: `${name}-${manifest.version}-package.json`,
    });

    // Convert CIDs to bytes32
    const tarballCid = `0x${Buffer.from(tarballResult.cid).toString('hex').padEnd(64, '0')}` as Hex;
    const manifestCid = `0x${Buffer.from(manifestResult.cid).toString('hex').padEnd(64, '0')}` as Hex;

    // Publish version on-chain
    const { request: publishRequest } = await this.publicClient.simulateContract({
      address: this.packageRegistryAddress,
      abi: PACKAGE_REGISTRY_ABI,
      functionName: 'publishVersion',
      args: [pkg.packageId, manifest.version, tarballCid, integrityBytes32, manifestCid, BigInt(tarball.length)],
      account: publisher,
    });

    const publishHash = await this.walletClient.writeContract(publishRequest);
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash: publishHash });

    // Extract versionId from logs
    const versionId = receipt.logs[0]?.topics[2] as Hex;

    return { packageId: pkg.packageId, versionId };
  }

  /**
   * Get manifest from storage
   */
  async getManifest(manifestCid: Hex): Promise<PackageManifest | null> {
    const cidString = this.hexToCid(manifestCid);
    if (!cidString) return null;

    const cached = this.manifestCache.get(cidString);
    if (cached) return cached;

    const result = await this.backend.download(cidString).catch(() => null);
    if (!result) return null;

    const manifest = JSON.parse(result.content.toString()) as PackageManifest;
    this.manifestCache.set(cidString, manifest);
    return manifest;
  }

  /**
   * Get tarball download URL
   */
  async getTarballUrl(tarballCid: Hex): Promise<string> {
    const cidString = this.hexToCid(tarballCid);
    const baseUrl = process.env.DWS_BASE_URL || 'http://localhost:4030';
    return `${baseUrl}/storage/download/${cidString}`;
  }

  /**
   * Download tarball
   */
  async downloadTarball(tarballCid: Hex): Promise<Buffer | null> {
    const cidString = this.hexToCid(tarballCid);
    if (!cidString) return null;

    const result = await this.backend.download(cidString).catch(() => null);
    return result?.content || null;
  }

  /**
   * Record a download (for analytics)
   */
  async recordDownload(packageId: Hex, versionId: Hex): Promise<void> {
    if (!this.walletClient) return;

    await this.walletClient.writeContract({
      address: this.packageRegistryAddress,
      abi: PACKAGE_REGISTRY_ABI,
      functionName: 'recordDownload',
      args: [packageId, versionId],
    });
  }

  /**
   * Search packages
   */
  async searchPackages(query: string, offset: number, limit: number): Promise<Package[]> {
    const allPackages = await this.publicClient.readContract({
      address: this.packageRegistryAddress,
      abi: PACKAGE_REGISTRY_ABI,
      functionName: 'getAllPackages',
      args: [BigInt(offset), BigInt(limit * 10)], // Fetch more for filtering
    });

    const packages = allPackages.map((p) => this.mapContractPackage(p));

    // Simple text search
    const queryLower = query.toLowerCase();
    const filtered = packages.filter(
      (p) =>
        p.name.toLowerCase().includes(queryLower) ||
        p.description.toLowerCase().includes(queryLower) ||
        p.scope.toLowerCase().includes(queryLower)
    );

    return filtered.slice(0, limit);
  }

  /**
   * Get package count
   */
  async getPackageCount(): Promise<number> {
    const count = await this.publicClient.readContract({
      address: this.packageRegistryAddress,
      abi: PACKAGE_REGISTRY_ABI,
      functionName: 'getPackageCount',
    });

    return Number(count);
  }

  // ============ Private Helpers ============

  private hexToCid(hex: Hex): string {
    // Remove 0x prefix and trailing zeros
    const cleaned = hex.slice(2).replace(/0+$/, '');
    return Buffer.from(cleaned, 'hex').toString();
  }

  private mapContractPackage(result: {
    packageId: Hex;
    name: string;
    scope: string;
    owner: Address;
    agentId: bigint;
    jnsNode: Hex;
    description: string;
    license: string;
    homepage: string;
    repository: string;
    latestVersion: Hex;
    createdAt: bigint;
    updatedAt: bigint;
    deprecated: boolean;
    downloadCount: bigint;
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
    };
  }

  private mapContractVersion(result: {
    versionId: Hex;
    packageId: Hex;
    version: string;
    tarballCid: Hex;
    integrityHash: Hex;
    manifestCid: Hex;
    size: bigint;
    publisher: Address;
    publishedAt: bigint;
    deprecated: boolean;
    deprecationMessage: string;
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
    };
  }
}

