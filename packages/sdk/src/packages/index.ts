/**
 * JejuPkg SDK - Client for decentralized NPM package operations
 * 
 * Provides TypeScript interface for:
 * - Package management
 * - Version publishing
 * - On-chain registry interaction
 */

import type { Address, Hex } from 'viem';
import { createPublicClient, createWalletClient, http } from 'viem';
import type { PublicClient, WalletClient } from 'viem';

export interface PackageSDKConfig {
  rpcUrl: string;
  registryUrl: string;
  registryAddress?: Address;
  privateKey?: Hex;
}

export interface Package {
  name: string;
  scope?: string;
  fullName: string;
  description?: string;
  latestVersion: string;
  versions: string[];
  distTags: Record<string, string>;
  maintainers: string[];
  license?: string;
  repository?: { type: string; url: string };
  keywords?: string[];
  downloadCount: number;
  reputationScore?: number;
  councilProposalId?: string;
  verified: boolean;
  deprecated: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface PackageVersion {
  name: string;
  version: string;
  description?: string;
  main?: string;
  types?: string;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  dist: {
    shasum: string;
    tarball: string;
    integrity?: string;
    fileCount?: number;
    unpackedSize?: number;
  };
  publishedAt: string;
  publishedBy: string;
}

export interface Publisher {
  address: string;
  username?: string;
  jnsName?: string;
  packages: string[];
  totalDownloads: number;
  totalPublishes: number;
  reputationScore: number;
  verified: boolean;
  createdAt: string;
}

export interface SearchResult {
  package: {
    name: string;
    version: string;
    description?: string;
    links: { npm: string };
  };
  score: {
    final: number;
    detail: {
      quality: number;
      popularity: number;
      maintenance: number;
    };
  };
}

const PACKAGE_REGISTRY_ABI = [
  { type: 'function', name: 'registerScope', inputs: [{ name: 'scope', type: 'string' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'createPackage', inputs: [{ name: 'name', type: 'string' }, { name: 'scope', type: 'string' }, { name: 'description', type: 'string' }, { name: 'visibility', type: 'uint8' }, { name: 'manifestCid', type: 'string' }], outputs: [{ type: 'bytes32' }], stateMutability: 'nonpayable' },
  { type: 'function', name: 'publishVersion', inputs: [{ name: 'packageId', type: 'bytes32' }, { name: 'version', type: 'string' }, { name: 'tarballCid', type: 'string' }, { name: 'integrity', type: 'string' }, { name: 'size', type: 'uint256' }, { name: 'manifestCid', type: 'string' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'updateDistTag', inputs: [{ name: 'packageId', type: 'bytes32' }, { name: 'tag', type: 'string' }, { name: 'version', type: 'string' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'yankVersion', inputs: [{ name: 'packageId', type: 'bytes32' }, { name: 'version', type: 'string' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'deprecatePackage', inputs: [{ name: 'packageId', type: 'bytes32' }, { name: 'message', type: 'string' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'addMaintainer', inputs: [{ name: 'packageId', type: 'bytes32' }, { name: 'maintainer', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'removeMaintainer', inputs: [{ name: 'packageId', type: 'bytes32' }, { name: 'maintainer', type: 'address' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'linkCouncilProposal', inputs: [{ name: 'packageId', type: 'bytes32' }, { name: 'proposalId', type: 'uint256' }], outputs: [], stateMutability: 'nonpayable' },
  { type: 'function', name: 'getPackage', inputs: [{ name: 'packageId', type: 'bytes32' }], outputs: [{ type: 'tuple', components: [{ name: 'name', type: 'string' }, { name: 'scope', type: 'string' }, { name: 'owner', type: 'address' }, { name: 'description', type: 'string' }, { name: 'visibility', type: 'uint8' }, { name: 'manifestCid', type: 'string' }, { name: 'latestVersion', type: 'string' }, { name: 'createdAt', type: 'uint256' }, { name: 'updatedAt', type: 'uint256' }, { name: 'downloadCount', type: 'uint256' }, { name: 'publishCount', type: 'uint256' }, { name: 'reputationScore', type: 'uint256' }, { name: 'councilProposalId', type: 'uint256' }, { name: 'verified', type: 'bool' }, { name: 'deprecated', type: 'bool' }, { name: 'deprecationMessage', type: 'string' }] }], stateMutability: 'view' },
  { type: 'function', name: 'getPackageByName', inputs: [{ name: 'fullName', type: 'string' }], outputs: [{ type: 'tuple', components: [{ name: 'name', type: 'string' }, { name: 'scope', type: 'string' }, { name: 'owner', type: 'address' }, { name: 'description', type: 'string' }, { name: 'visibility', type: 'uint8' }, { name: 'manifestCid', type: 'string' }, { name: 'latestVersion', type: 'string' }, { name: 'createdAt', type: 'uint256' }, { name: 'updatedAt', type: 'uint256' }, { name: 'downloadCount', type: 'uint256' }, { name: 'publishCount', type: 'uint256' }, { name: 'reputationScore', type: 'uint256' }, { name: 'councilProposalId', type: 'uint256' }, { name: 'verified', type: 'bool' }, { name: 'deprecated', type: 'bool' }, { name: 'deprecationMessage', type: 'string' }] }], stateMutability: 'view' },
  { type: 'function', name: 'getVersion', inputs: [{ name: 'packageId', type: 'bytes32' }, { name: 'version', type: 'string' }], outputs: [{ type: 'tuple', components: [{ name: 'version', type: 'string' }, { name: 'tarballCid', type: 'string' }, { name: 'integrity', type: 'string' }, { name: 'size', type: 'uint256' }, { name: 'publishedAt', type: 'uint256' }, { name: 'publishedBy', type: 'address' }, { name: 'yanked', type: 'bool' }] }], stateMutability: 'view' },
  { type: 'function', name: 'getVersions', inputs: [{ name: 'packageId', type: 'bytes32' }], outputs: [{ type: 'string[]' }], stateMutability: 'view' },
  { type: 'function', name: 'isMaintainer', inputs: [{ name: 'packageId', type: 'bytes32' }, { name: 'addr', type: 'address' }], outputs: [{ type: 'bool' }], stateMutability: 'view' },
  { type: 'function', name: 'getPublisher', inputs: [{ name: 'addr', type: 'address' }], outputs: [{ type: 'tuple', components: [{ name: 'addr', type: 'address' }, { name: 'username', type: 'string' }, { name: 'jnsName', type: 'string' }, { name: 'totalPackages', type: 'uint256' }, { name: 'totalDownloads', type: 'uint256' }, { name: 'totalPublishes', type: 'uint256' }, { name: 'reputationScore', type: 'uint256' }, { name: 'stakedAmount', type: 'uint256' }, { name: 'createdAt', type: 'uint256' }, { name: 'verified', type: 'bool' }] }], stateMutability: 'view' },
  { type: 'function', name: 'getPublisherPackages', inputs: [{ name: 'addr', type: 'address' }], outputs: [{ type: 'bytes32[]' }], stateMutability: 'view' },
  { type: 'function', name: 'getScopeOwner', inputs: [{ name: 'scope', type: 'string' }], outputs: [{ type: 'address' }], stateMutability: 'view' },
] as const;

export class JejuPkgSDK {
  private config: PackageSDKConfig;
  private publicClient: PublicClient;
  private walletClient?: WalletClient;

  constructor(config: PackageSDKConfig) {
    this.config = config;
    this.publicClient = createPublicClient({
      transport: http(config.rpcUrl),
    });

    if (config.privateKey) {
      this.walletClient = createWalletClient({
        transport: http(config.rpcUrl),
      });
    }
  }

  // Package Operations

  async getPackage(name: string): Promise<Package> {
    const response = await fetch(`${this.config.registryUrl}/${encodeURIComponent(name)}`);
    if (!response.ok) {
      if (response.status === 404) {
        throw new Error(`Package not found: ${name}`);
      }
      throw new Error(`Failed to get package: ${response.statusText}`);
    }
    
    const manifest = await response.json() as {
      name: string;
      description?: string;
      'dist-tags': Record<string, string>;
      versions: Record<string, PackageVersion>;
      maintainers?: Array<{ name: string }>;
      license?: string;
      repository?: { type: string; url: string };
      keywords?: string[];
      time?: Record<string, string>;
    };

    return {
      name: manifest.name,
      scope: manifest.name.startsWith('@') ? manifest.name.split('/')[0] : undefined,
      fullName: manifest.name,
      description: manifest.description,
      latestVersion: manifest['dist-tags'].latest,
      versions: Object.keys(manifest.versions),
      distTags: manifest['dist-tags'],
      maintainers: manifest.maintainers?.map(m => m.name) ?? [],
      license: manifest.license,
      repository: manifest.repository,
      keywords: manifest.keywords,
      downloadCount: 0, // Would need to query registry API
      verified: false,
      deprecated: false,
      createdAt: manifest.time?.created ?? new Date().toISOString(),
      updatedAt: manifest.time?.modified ?? new Date().toISOString(),
    };
  }

  async getPackageVersion(name: string, version: string): Promise<PackageVersion> {
    const response = await fetch(`${this.config.registryUrl}/${encodeURIComponent(name)}/${version}`);
    if (!response.ok) {
      throw new Error(`Failed to get package version: ${response.statusText}`);
    }
    return response.json() as Promise<PackageVersion>;
  }

  async searchPackages(query: string, options?: {
    size?: number;
    from?: number;
  }): Promise<{ total: number; items: SearchResult[] }> {
    const params = new URLSearchParams();
    params.set('text', query);
    if (options?.size) params.set('size', options.size.toString());
    if (options?.from) params.set('from', options.from.toString());

    const response = await fetch(`${this.config.registryUrl}/-/v1/search?${params}`);
    if (!response.ok) {
      throw new Error(`Failed to search packages: ${response.statusText}`);
    }

    const data = await response.json() as { objects: SearchResult[]; total: number };
    return { total: data.total, items: data.objects };
  }

  // Publishing

  async publish(
    manifest: {
      name: string;
      version: string;
      description?: string;
      main?: string;
      dependencies?: Record<string, string>;
      devDependencies?: Record<string, string>;
      [key: string]: unknown;
    },
    tarball: Buffer,
    authToken: string
  ): Promise<{ ok: boolean; id: string; rev: string }> {
    const tarballBase64 = tarball.toString('base64');
    const filename = `${manifest.name.replace(/\//g, '-')}-${manifest.version}.tgz`;

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
    };

    const response = await fetch(`${this.config.registryUrl}/${encodeURIComponent(manifest.name)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: response.statusText })) as { error?: string };
      throw new Error(`Failed to publish package: ${error.error ?? response.statusText}`);
    }

    return response.json() as Promise<{ ok: boolean; id: string; rev: string }>;
  }

  async unpublish(name: string, version: string, authToken: string): Promise<void> {
    const response = await fetch(`${this.config.registryUrl}/${encodeURIComponent(name)}/-rev/1`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to unpublish package: ${response.statusText}`);
    }
  }

  async deprecate(name: string, message: string, authToken: string): Promise<void> {
    // Get current package
    const pkg = await this.getPackage(name);
    
    // Update all versions with deprecation message
    const body = {
      name,
      versions: Object.fromEntries(
        pkg.versions.map(v => [v, { deprecated: message }])
      ),
    };

    const response = await fetch(`${this.config.registryUrl}/${encodeURIComponent(name)}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`Failed to deprecate package: ${response.statusText}`);
    }
  }

  // Dist Tags

  async addDistTag(name: string, version: string, tag: string, authToken: string): Promise<void> {
    const response = await fetch(`${this.config.registryUrl}/-/package/${encodeURIComponent(name)}/dist-tags/${tag}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
      },
      body: JSON.stringify(version),
    });

    if (!response.ok) {
      throw new Error(`Failed to add dist-tag: ${response.statusText}`);
    }
  }

  async removeDistTag(name: string, tag: string, authToken: string): Promise<void> {
    const response = await fetch(`${this.config.registryUrl}/-/package/${encodeURIComponent(name)}/dist-tags/${tag}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to remove dist-tag: ${response.statusText}`);
    }
  }

  // Download Tarball

  async downloadTarball(name: string, version: string): Promise<Buffer> {
    const pkg = await this.getPackageVersion(name, version);
    const response = await fetch(pkg.dist.tarball);
    
    if (!response.ok) {
      throw new Error(`Failed to download tarball: ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  }

  // Sync from upstream (npmjs.org - for compatibility)

  async syncFromUpstream(name: string, authToken: string): Promise<{ synced: number }> {
    const response = await fetch(`${this.config.registryUrl}/-/registry/sync/${encodeURIComponent(name)}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to sync package: ${response.statusText}`);
    }

    return response.json() as Promise<{ synced: number }>;
  }

  // Publisher Operations

  async getPublisher(address: string): Promise<Publisher> {
    const response = await fetch(`${this.config.registryUrl}/-/registry/accounts/${address}`);
    if (!response.ok) {
      throw new Error(`Failed to get publisher: ${response.statusText}`);
    }
    return response.json() as Promise<Publisher>;
  }

  async login(username: string, password: string): Promise<string> {
    const response = await fetch(`${this.config.registryUrl}/-/user/org.couchdb.user:${username}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name: username, password }),
    });

    if (!response.ok) {
      throw new Error(`Failed to login: ${response.statusText}`);
    }

    const data = await response.json() as { token: string };
    return data.token;
  }

  async whoami(authToken: string): Promise<string> {
    const response = await fetch(`${this.config.registryUrl}/-/whoami`, {
      headers: {
        'Authorization': `Bearer ${authToken}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to get user: ${response.statusText}`);
    }

    const data = await response.json() as { username: string };
    return data.username;
  }

  // On-chain operations (requires wallet)

  async registerScope(scope: string): Promise<Hex> {
    if (!this.walletClient || !this.config.registryAddress) {
      throw new Error('Wallet client and registry address required for on-chain operations');
    }

    // @ts-expect-error - chain inferred at runtime from RPC
    const hash = await this.walletClient.writeContract({
      address: this.config.registryAddress,
      abi: PACKAGE_REGISTRY_ABI,
      functionName: 'registerScope',
      args: [scope],
    });

    return hash;
  }

  async createPackageOnChain(
    name: string,
    scope: string,
    description: string,
    visibility: 0 | 1 | 2,
    manifestCid: string
  ): Promise<Hex> {
    if (!this.walletClient || !this.config.registryAddress) {
      throw new Error('Wallet client and registry address required for on-chain operations');
    }

    // @ts-expect-error - chain inferred at runtime from RPC
    const hash = await this.walletClient.writeContract({
      address: this.config.registryAddress,
      abi: PACKAGE_REGISTRY_ABI,
      functionName: 'createPackage',
      args: [name, scope, description, visibility, manifestCid],
    });

    return hash;
  }

  async linkCouncilProposal(packageId: Hex, proposalId: bigint): Promise<Hex> {
    if (!this.walletClient || !this.config.registryAddress) {
      throw new Error('Wallet client and registry address required for on-chain operations');
    }

    // @ts-expect-error - chain inferred at runtime from RPC
    const hash = await this.walletClient.writeContract({
      address: this.config.registryAddress,
      abi: PACKAGE_REGISTRY_ABI,
      functionName: 'linkCouncilProposal',
      args: [packageId, proposalId],
    });

    return hash;
  }

  // Health check

  async healthCheck(): Promise<{ status: string; service: string }> {
    // DWS pkg registry uses /pkg/health endpoint (npm CLI compatible)
    const response = await fetch(`${this.config.registryUrl}/pkg/health`);
    if (!response.ok) {
      throw new Error(`Health check failed: ${response.statusText}`);
    }
    return response.json() as Promise<{ status: string; service: string }>;
  }

  // Registry URL helper for npm/bun config (compatibility)

  getRegistryUrl(): string {
    return this.config.registryUrl;
  }
}

export function createJejuPkgSDK(config: PackageSDKConfig): JejuPkgSDK {
  return new JejuPkgSDK(config);
}

// Convenience function for default config
export function createDefaultPkgSDK(): JejuPkgSDK {
  return new JejuPkgSDK({
    rpcUrl: process.env.JEJU_RPC_URL ?? 'http://127.0.0.1:9545',
    registryUrl: process.env.JEJUPKG_URL ?? 'http://localhost:4021',
    registryAddress: process.env.PACKAGE_REGISTRY_ADDRESS as Address | undefined,
  });
}

// NPM CLI integration helpers

export function generateNpmrc(registryUrl: string, authToken?: string): string {
  let content = `registry=${registryUrl}\n`;
  if (authToken) {
    const url = new URL(registryUrl);
    content += `//${url.host}/:_authToken=${authToken}\n`;
  }
  return content;
}

export function generateBunfigToml(registryUrl: string): string {
  return `[install]
registry = "${registryUrl}"
`;
}

