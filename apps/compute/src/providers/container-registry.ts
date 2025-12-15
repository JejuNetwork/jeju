/**
 * Container Registry Integration
 *
 * Integrates the network's decentralized container registry with compute providers.
 * Supports JNS (Network Name Service) resolution for human-readable container names.
 */

import type { Address, Hex } from 'viem';
import { keccak256, toHex } from 'viem';
import { Contract, JsonRpcProvider } from 'ethers';

// ============================================================================
// Configuration
// ============================================================================

export interface ContainerRegistryConfig {
  /** Network RPC URL */
  rpcUrl: string;
  /** JNS Registry contract address */
  jnsRegistryAddress: Address;
  /** Storage registry gateway URL */
  storageGatewayUrl: string;
  /** IPFS gateway URL */
  ipfsGatewayUrl: string;
  /** Arweave gateway URL */
  arweaveGatewayUrl: string;
}

// JNS Registry ABI
const JNS_REGISTRY_ABI = [
  'function resolve(bytes32 node) view returns (address)',
  'function getText(bytes32 node, string key) view returns (string)',
  'function getContentHash(bytes32 node) view returns (bytes)',
  'function owner(bytes32 node) view returns (address)',
  'function addr(bytes32 node) view returns (address)',
];

// ============================================================================
// Types
// ============================================================================

export interface ContainerReference {
  /** Original reference (JNS name, CID, or registry URL) */
  original: string;
  /** Resolved container image URL */
  resolvedUrl: string;
  /** Content ID (CID for IPFS, transaction ID for Arweave) */
  cid?: string;
  /** Storage backend used */
  backend: 'ipfs' | 'arweave' | 'docker-hub' | 'jeju-registry';
  /** Whether reference was resolved via JNS */
  jnsResolved: boolean;
  /** JNS name if applicable */
  jnsName?: string;
  /** Image digest */
  digest?: string;
  /** Image size in bytes */
  sizeBytes?: number;
  /** Resolution timestamp */
  resolvedAt: number;
}

export interface RegistryImage {
  repository: string;
  tag: string;
  digest: string;
  manifestCid: string;
  layerCids: string[];
  sizeBytes: bigint;
  uploadedBy: Address;
  uploadedAt: number;
  pullCount: number;
  storageBackend: 'ipfs' | 'arweave' | 'hybrid';
}

// ============================================================================
// Container Registry Client
// ============================================================================

export class ContainerRegistryClient {
  private config: ContainerRegistryConfig;
  private provider: JsonRpcProvider;
  private jnsRegistry: Contract | null;
  private cache = new Map<string, ContainerReference>();
  private cacheTimeout = 300000; // 5 minutes

  constructor(config: ContainerRegistryConfig) {
    this.config = config;
    this.provider = new JsonRpcProvider(config.rpcUrl);

    if (config.jnsRegistryAddress !== '0x0000000000000000000000000000000000000000') {
      this.jnsRegistry = new Contract(
        config.jnsRegistryAddress,
        JNS_REGISTRY_ABI,
        this.provider
      );
    } else {
      this.jnsRegistry = null;
    }
  }

  /**
   * Resolve a container reference to a pullable URL
   *
   * Supports:
   * - JNS names: myapp.jeju → resolved to CID
   * - IPFS CIDs: ipfs://Qm... or just Qm...
   * - Arweave: ar://...
   * - Docker Hub: library/nginx:latest
   * - Network Registry: registry.network/user/app:tag
   */
  async resolve(reference: string): Promise<ContainerReference> {
    // Check cache
    const cached = this.cache.get(reference);
    if (cached && Date.now() - cached.resolvedAt < this.cacheTimeout) {
      return cached;
    }

    let result: ContainerReference;

    if (this.isJnsName(reference)) {
      result = await this.resolveJns(reference);
    } else if (this.isIpfsCid(reference)) {
      result = await this.resolveIpfs(reference);
    } else if (this.isArweaveRef(reference)) {
      result = await this.resolveArweave(reference);
    } else if (this.isDockerHubRef(reference)) {
      result = await this.resolveDockerHub(reference);
    } else if (this.isChainRegistryRef(reference)) {
      result = await this.resolveChainRegistry(reference);
    } else {
      // Assume Docker Hub format
      result = await this.resolveDockerHub(reference);
    }

    this.cache.set(reference, result);
    return result;
  }

  /**
   * Resolve JNS name to container reference
   */
  private async resolveJns(name: string): Promise<ContainerReference> {
    if (!this.jnsRegistry) {
      throw new Error('JNS registry not configured');
    }

    // Normalize name (remove .jeju suffix if present)
    const normalizedName = name.replace(/\.jeju$/, '');
    const node = this.namehash(`${normalizedName}.jeju`);

    // Get content hash from JNS
    const contentHash = await this.jnsRegistry.getContentHash(node).catch(() => null);

    if (!contentHash || contentHash === '0x') {
      // Try to get as text record
      const ipfsCid = await this.jnsRegistry.getText(node, 'ipfs').catch(() => null);
      const arweaveId = await this.jnsRegistry.getText(node, 'arweave').catch(() => null);

      if (ipfsCid) {
        const resolved = await this.resolveIpfs(ipfsCid);
        return {
          ...resolved,
          jnsResolved: true,
          jnsName: name,
        };
      }

      if (arweaveId) {
        const resolved = await this.resolveArweave(arweaveId);
        return {
          ...resolved,
          jnsResolved: true,
          jnsName: name,
        };
      }

      throw new Error(`No container found for JNS name: ${name}`);
    }

    // Parse content hash (EIP-1577 format)
    const { cid, backend } = this.parseContentHash(contentHash);

    if (backend === 'ipfs') {
      return {
        original: name,
        resolvedUrl: `${this.config.ipfsGatewayUrl}/ipfs/${cid}`,
        cid,
        backend: 'ipfs',
        jnsResolved: true,
        jnsName: name,
        resolvedAt: Date.now(),
      };
    } else {
      return {
        original: name,
        resolvedUrl: `${this.config.arweaveGatewayUrl}/${cid}`,
        cid,
        backend: 'arweave',
        jnsResolved: true,
        jnsName: name,
        resolvedAt: Date.now(),
      };
    }
  }

  /**
   * Resolve IPFS CID
   */
  private async resolveIpfs(reference: string): Promise<ContainerReference> {
    // Extract CID from various formats
    let cid = reference;
    if (reference.startsWith('ipfs://')) {
      cid = reference.slice(7);
    } else if (reference.startsWith('/ipfs/')) {
      cid = reference.slice(6);
    }

    // Verify CID exists by checking manifest
    const manifestUrl = `${this.config.storageGatewayUrl}/registry/v2/_registry/images/${cid}`;
    const manifestResponse = await fetch(manifestUrl).catch(() => null);

    let sizeBytes: number | undefined;
    if (manifestResponse?.ok) {
      const manifest = (await manifestResponse.json()) as { sizeBytes?: string };
      sizeBytes = manifest.sizeBytes ? parseInt(manifest.sizeBytes, 10) : undefined;
    }

    return {
      original: reference,
      resolvedUrl: `${this.config.ipfsGatewayUrl}/ipfs/${cid}`,
      cid,
      backend: 'ipfs',
      jnsResolved: false,
      sizeBytes,
      resolvedAt: Date.now(),
    };
  }

  /**
   * Resolve Arweave reference
   */
  private async resolveArweave(reference: string): Promise<ContainerReference> {
    let txId = reference;
    if (reference.startsWith('ar://')) {
      txId = reference.slice(5);
    }

    return {
      original: reference,
      resolvedUrl: `${this.config.arweaveGatewayUrl}/${txId}`,
      cid: txId,
      backend: 'arweave',
      jnsResolved: false,
      resolvedAt: Date.now(),
    };
  }

  /**
   * Resolve Docker Hub reference
   */
  private async resolveDockerHub(reference: string): Promise<ContainerReference> {
    // Parse Docker Hub reference
    let image = reference;
    let tag = 'latest';

    if (reference.includes(':')) {
      [image, tag] = reference.split(':');
    }

    // Add library prefix if no namespace
    if (!image.includes('/')) {
      image = `library/${image}`;
    }

    return {
      original: reference,
      resolvedUrl: `docker.io/${image}:${tag}`,
      backend: 'docker-hub',
      jnsResolved: false,
      resolvedAt: Date.now(),
    };
  }

  /**
   * Resolve Network Registry reference
   */
  private async resolveChainRegistry(reference: string): Promise<ContainerReference> {
    // Parse network registry reference
    // Format: registry.network/namespace/image:tag or jeju.network/namespace/image:tag
    const url = reference.replace(/^https?:\/\//, '');
    const parts = url.split('/');

    // Remove registry hostname
    const pathParts = parts.slice(1);
    const imagePath = pathParts.join('/');

    // Query registry API
    const apiUrl = `${this.config.storageGatewayUrl}/registry/v2/${imagePath}/manifests/latest`;
    const response = await fetch(apiUrl, {
      headers: {
        Accept: 'application/vnd.docker.distribution.manifest.v2+json',
      },
    });

    if (!response.ok) {
      throw new Error(`Failed to resolve network registry image: ${reference}`);
    }

    const digest = response.headers.get('Docker-Content-Digest');
    const contentLength = response.headers.get('Content-Length');

    // Get the underlying CID from our registry
    const imageInfoUrl = `${this.config.storageGatewayUrl}/registry/v2/_registry/images/${digest}`;
    const imageInfo = await fetch(imageInfoUrl)
      .then((r) => r.json() as Promise<RegistryImage>)
      .catch(() => null);

    return {
      original: reference,
      resolvedUrl: `${this.config.storageGatewayUrl}/registry/v2/${imagePath}`,
      cid: imageInfo?.manifestCid,
      backend: 'jeju-registry',
      jnsResolved: false,
      digest: digest ?? undefined,
      sizeBytes: contentLength ? parseInt(contentLength, 10) : undefined,
      resolvedAt: Date.now(),
    };
  }

  /**
   * Get image metadata from the network registry
   */
  async getImageInfo(repository: string, tag = 'latest'): Promise<RegistryImage | null> {
    const apiUrl = `${this.config.storageGatewayUrl}/registry/v2/${repository}/manifests/${tag}`;
    const response = await fetch(apiUrl, {
      method: 'HEAD',
      headers: {
        Accept: 'application/vnd.docker.distribution.manifest.v2+json',
      },
    });

    if (!response.ok) return null;

    const digest = response.headers.get('Docker-Content-Digest');
    if (!digest) return null;

    const imageInfoUrl = `${this.config.storageGatewayUrl}/registry/v2/_registry/images/${digest}`;
    const imageInfo = await fetch(imageInfoUrl)
      .then((r) => r.json() as Promise<RegistryImage>)
      .catch(() => null);

    return imageInfo;
  }

  /**
   * List images in a repository
   */
  async listTags(repository: string): Promise<string[]> {
    const apiUrl = `${this.config.storageGatewayUrl}/registry/v2/${repository}/tags/list`;
    const response = await fetch(apiUrl);

    if (!response.ok) return [];

    const data = (await response.json()) as { tags?: string[] };
    return data.tags ?? [];
  }

  /**
   * Search for images by name
   */
  async searchImages(query: string): Promise<Array<{ name: string; tags: string[] }>> {
    const catalogUrl = `${this.config.storageGatewayUrl}/registry/v2/_catalog`;
    const response = await fetch(catalogUrl);

    if (!response.ok) return [];

    const data = (await response.json()) as { repositories?: string[] };
    const repositories = data.repositories ?? [];

    const matches = repositories.filter((r) =>
      r.toLowerCase().includes(query.toLowerCase())
    );

    const results: Array<{ name: string; tags: string[] }> = [];
    for (const repo of matches.slice(0, 10)) {
      const tags = await this.listTags(repo);
      results.push({ name: repo, tags });
    }

    return results;
  }

  /**
   * Convert container reference to format suitable for external provider
   */
  async toExternalFormat(
    reference: string,
    provider: 'akash' | 'native'
  ): Promise<string> {
    const resolved = await this.resolve(reference);

    switch (provider) {
      case 'akash':
        // Akash supports Docker Hub and direct URLs
        if (resolved.backend === 'docker-hub') {
          return resolved.resolvedUrl;
        }
        // For IPFS/Arweave, return the gateway URL
        // Akash providers will pull from this URL
        return resolved.resolvedUrl;

      case 'native':
        // Native providers can use CIDs directly
        if (resolved.cid) {
          return `${this.config.ipfsGatewayUrl}/ipfs/${resolved.cid}`;
        }
        return resolved.resolvedUrl;

      default:
        return resolved.resolvedUrl;
    }
  }

  // ============================================================================
  // Helper Methods
  // ============================================================================

  private isJnsName(reference: string): boolean {
    // JNS names end with .jeju or are simple names without / or :
    if (reference.endsWith('.jeju')) return true;
    if (reference.includes('/') || reference.includes(':') || reference.includes('.')) return false;
    // Simple name without dots could be JNS
    return reference.length > 0 && reference.length < 64;
  }

  private isIpfsCid(reference: string): boolean {
    return (
      reference.startsWith('ipfs://') ||
      reference.startsWith('/ipfs/') ||
      reference.startsWith('Qm') ||
      reference.startsWith('bafy')
    );
  }

  private isArweaveRef(reference: string): boolean {
    return reference.startsWith('ar://');
  }

  private isDockerHubRef(reference: string): boolean {
    // Docker Hub refs don't have protocol and have / separator
    return (
      !reference.includes('://') &&
      reference.includes('/') &&
      !reference.includes('jeju')
    );
  }

  private isChainRegistryRef(reference: string): boolean {
    return (
      reference.includes('registry.jeju') ||
      reference.includes('jeju.network') ||
      reference.startsWith('jeju/')
    );
  }

  private namehash(name: string): Hex {
    let node = new Uint8Array(32);
    if (name === '') return toHex(node);

    const labels = name.split('.');
    for (let i = labels.length - 1; i >= 0; i--) {
      const labelHash = keccak256(new TextEncoder().encode(labels[i]));
      const combined = new Uint8Array(64);
      combined.set(node, 0);
      combined.set(
        Uint8Array.from(
          labelHash
            .slice(2)
            .match(/.{2}/g)!
            .map((b) => parseInt(b, 16))
        ),
        32
      );
      node = Uint8Array.from(
        keccak256(combined)
          .slice(2)
          .match(/.{2}/g)!
          .map((b) => parseInt(b, 16))
      );
    }
    return toHex(node);
  }

  private parseContentHash(contentHash: string): { cid: string; backend: 'ipfs' | 'arweave' } {
    // EIP-1577 content hash format
    // First byte: 0xe3 for IPFS, 0xe4 for Swarm, 0x01 for Arweave (custom)
    const bytes = contentHash.slice(2);
    const codec = parseInt(bytes.slice(0, 2), 16);

    if (codec === 0xe3) {
      // IPFS - remove codec byte and decode
      const cidBytes = bytes.slice(2);
      // Simplified: assume CIDv1 base32
      return { cid: cidBytes, backend: 'ipfs' };
    } else if (codec === 0x01) {
      // Arweave (custom codec)
      return { cid: bytes.slice(2), backend: 'arweave' };
    }

    // Default to IPFS
    return { cid: bytes, backend: 'ipfs' };
  }
}

/**
 * Create container registry client from environment
 */
export function createContainerRegistryFromEnv(): ContainerRegistryClient {
  const rpcUrl = process.env.JEJU_RPC_URL ?? 'http://127.0.0.1:9545';
  const jnsRegistryAddress = (process.env.JNS_REGISTRY_ADDRESS ??
    '0x0000000000000000000000000000000000000000') as Address;
  const storageGatewayUrl = process.env.STORAGE_GATEWAY_URL ?? 'http://localhost:4010';
  const ipfsGatewayUrl = process.env.IPFS_GATEWAY_URL ?? 'https://ipfs.io';
  const arweaveGatewayUrl = process.env.ARWEAVE_GATEWAY_URL ?? 'https://arweave.net';

  return new ContainerRegistryClient({
    rpcUrl,
    jnsRegistryAddress,
    storageGatewayUrl,
    ipfsGatewayUrl,
    arweaveGatewayUrl,
  });
}

// Singleton
let containerRegistryInstance: ContainerRegistryClient | null = null;

export function getContainerRegistry(): ContainerRegistryClient {
  if (!containerRegistryInstance) {
    containerRegistryInstance = createContainerRegistryFromEnv();
  }
  return containerRegistryInstance;
}

export function resetContainerRegistry(): void {
  containerRegistryInstance = null;
}

