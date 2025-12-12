/**
 * Cloud Storage Provider Wrapper
 *
 * This file wraps cloud storage backends (Vercel, S3, R2) to implement
 * the StorageProviderInterface. This allows cloud storage to participate
 * in the decentralized marketplace alongside native IPFS/Arweave providers.
 *
 * IMPORTANT: This is the ONLY place vendor-specific code touches Jeju.
 * The compute marketplace and other Jeju components interact ONLY through
 * the StorageProviderInterface.
 *
 * Architecture:
 *
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │                    CloudStorageProvider                         │
 *   │         (implements StorageProviderInterface)                   │
 *   └─────────────────────────────────────────────────────────────────┘
 *                               │
 *                               ▼
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │                    CloudStorageBackend                          │
 *   │         (Vercel/S3/R2 implementations - vendor code)            │
 *   └─────────────────────────────────────────────────────────────────┘
 *
 * The CloudStorageProvider:
 * 1. Wraps vendor backends to implement marketplace interface
 * 2. Generates content-addressed CIDs for cloud-stored content
 * 3. Handles pricing and capability reporting
 * 4. Can register as an ERC-8004 agent on the marketplace
 */

import type { CloudStorageBackend, CloudUploadResult } from './cloud';
import { createCloudBackendFromEnv, generateCloudCID } from './cloud';
import type {
  ContentId,
  ProviderCapabilities,
  ProviderHealth,
  ProviderPricing,
  ProviderType,
  StorageProviderInterface,
  StorageUploadOptions,
  StorageUploadResult,
} from '../sdk/provider-interface';

// ============================================================================
// Cloud Storage Provider (implements StorageProviderInterface)
// ============================================================================

/**
 * Configuration for cloud storage provider
 */
export interface CloudStorageProviderConfig {
  /** Provider name for marketplace listing */
  name: string;
  /** Backend to use (auto-detected from env if not provided) */
  backend?: CloudStorageBackend;
  /** Custom pricing (defaults provided) */
  pricing?: Partial<ProviderPricing>;
  /** Geographic regions served */
  regions?: string[];
}

/**
 * Cloud Storage Provider
 *
 * Wraps cloud storage (Vercel/S3/R2) to implement the StorageProviderInterface.
 * This allows cloud storage to participate in the Jeju marketplace.
 */
export class CloudStorageProvider implements StorageProviderInterface {
  readonly type: ProviderType = 'cloud';
  private backend: CloudStorageBackend;
  private config: CloudStorageProviderConfig;
  private cidToUrl: Map<string, string> = new Map();

  constructor(config: CloudStorageProviderConfig) {
    this.config = config;

    // Use provided backend or auto-detect from environment
    const backend = config.backend ?? createCloudBackendFromEnv();
    if (!backend) {
      throw new Error(
        'No cloud storage backend available. Set BLOB_READ_WRITE_TOKEN, ' +
          'AWS credentials, or R2 credentials.'
      );
    }
    this.backend = backend;
  }

  /**
   * Get provider capabilities
   */
  getCapabilities(): ProviderCapabilities {
    return {
      tiers: ['hot', 'warm'],
      maxFileSize: 500 * 1024 * 1024, // 500MB
      maxTotalStorage: 0, // Unlimited
      supportsPermanent: false, // Cloud storage is not permanent
      supportsFolders: true,
      supportsListing: true,
      supportsDeletion: true,
      regions: this.config.regions ?? ['global'],
      supportsEncryption: true,
    };
  }

  /**
   * Get provider pricing
   */
  getPricing(): ProviderPricing {
    // Default pricing (can be overridden)
    return {
      storagePerGBMonth: this.config.pricing?.storagePerGBMonth ?? 0n, // Free tier
      bandwidthPerGB: this.config.pricing?.bandwidthPerGB ?? 0n,
      permanentPerGB: 0n, // Not supported
      minimumPayment: this.config.pricing?.minimumPayment ?? 0n,
      freeTierBytes: this.config.pricing?.freeTierBytes ?? 5 * 1024 * 1024 * 1024, // 5GB
    };
  }

  /**
   * Check provider health
   */
  async healthCheck(): Promise<ProviderHealth> {
    const startTime = Date.now();

    try {
      // Try to list (quick operation)
      await this.backend.list();

      return {
        healthy: true,
        latencyMs: Date.now() - startTime,
        lastSuccess: Date.now(),
        errorCount: 0,
        availableCapacity: Number.MAX_SAFE_INTEGER,
      };
    } catch {
      return {
        healthy: false,
        latencyMs: Date.now() - startTime,
        lastSuccess: 0,
        errorCount: 1,
        availableCapacity: 0,
      };
    }
  }

  /**
   * Upload content to cloud storage
   */
  async upload(
    content: Buffer,
    filename: string,
    options?: StorageUploadOptions
  ): Promise<StorageUploadResult> {
    const result: CloudUploadResult = await this.backend.upload(
      content,
      options?.folder ? `${options.folder}/${filename}` : filename
    );

    // Store mapping for later retrieval
    this.cidToUrl.set(result.cid, result.url);

    return {
      cid: result.cid,
      url: result.url,
      size: result.size,
      provider: 'cloud',
      tier: options?.tier ?? 'hot',
      cost: 0n, // Free tier
      expiresAt: 0, // No expiry
      metadata: {
        backend: this.backend.type,
        ...options?.metadata,
      },
    };
  }

  /**
   * Download content by CID
   */
  async download(cid: ContentId): Promise<Buffer> {
    return this.backend.download(cid);
  }

  /**
   * Check if content exists
   */
  async exists(cid: ContentId): Promise<boolean> {
    return this.backend.exists(cid);
  }

  /**
   * Delete content
   */
  async delete(cid: ContentId): Promise<void> {
    await this.backend.delete(cid);
    this.cidToUrl.delete(cid);
  }

  /**
   * Get direct URL for content
   */
  getUrl(cid: ContentId): string {
    // Try cached URL first
    const cached = this.cidToUrl.get(cid);
    if (cached) return cached;

    // Fall back to backend URL generation
    return this.backend.getUrl(cid);
  }

  /**
   * List content in folder
   */
  async list(
    folder: string
  ): Promise<Array<{ cid: ContentId; filename: string; size: number }>> {
    const items = await this.backend.list(folder);
    return items.map((item) => ({
      cid: item.cid,
      filename: item.cid, // CID is the filename for cloud storage
      size: item.size,
    }));
  }

  /**
   * Estimate cost for upload
   */
  async estimateCost(
    size: number,
    _options?: StorageUploadOptions
  ): Promise<bigint> {
    const pricing = this.getPricing();

    // Free tier
    if (size <= pricing.freeTierBytes) {
      return 0n;
    }

    // Calculate cost based on storage
    const gbSize = Math.ceil(size / (1024 * 1024 * 1024));
    return BigInt(gbSize) * pricing.storagePerGBMonth;
  }
}

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a cloud storage provider from environment variables.
 * Returns null if no cloud storage is configured.
 */
export function createCloudStorageProvider(
  config?: Partial<CloudStorageProviderConfig>
): CloudStorageProvider | null {
  try {
    return new CloudStorageProvider({
      name: config?.name ?? 'Cloud Storage Provider',
      backend: config?.backend,
      pricing: config?.pricing,
      regions: config?.regions,
    });
  } catch {
    return null;
  }
}

/**
 * Create a cloud storage provider with explicit backend type.
 */
export function createCloudStorageProviderWithBackend(
  backendType: 'vercel' | 's3' | 'r2',
  config: CloudStorageProviderConfig & {
    // Vercel
    vercelToken?: string;
    // S3
    s3Bucket?: string;
    s3Region?: string;
    s3AccessKeyId?: string;
    s3SecretAccessKey?: string;
    s3Endpoint?: string;
    // R2
    r2AccountId?: string;
    r2AccessKeyId?: string;
    r2SecretAccessKey?: string;
    r2Bucket?: string;
  }
): CloudStorageProvider {
  // Import backend creators
  const { VercelBlobBackend, S3Backend, R2Backend } = require('./cloud');

  let backend: CloudStorageBackend;

  switch (backendType) {
    case 'vercel':
      if (!config.vercelToken) {
        throw new Error('Vercel token required');
      }
      backend = new VercelBlobBackend({ token: config.vercelToken });
      break;

    case 's3':
      if (!config.s3Bucket || !config.s3AccessKeyId || !config.s3SecretAccessKey) {
        throw new Error('S3 bucket, accessKeyId, and secretAccessKey required');
      }
      backend = new S3Backend({
        bucket: config.s3Bucket,
        region: config.s3Region ?? 'us-east-1',
        accessKeyId: config.s3AccessKeyId,
        secretAccessKey: config.s3SecretAccessKey,
        endpoint: config.s3Endpoint,
      });
      break;

    case 'r2':
      if (
        !config.r2AccountId ||
        !config.r2AccessKeyId ||
        !config.r2SecretAccessKey ||
        !config.r2Bucket
      ) {
        throw new Error('R2 accountId, accessKeyId, secretAccessKey, and bucket required');
      }
      backend = new R2Backend({
        accountId: config.r2AccountId,
        accessKeyId: config.r2AccessKeyId,
        secretAccessKey: config.r2SecretAccessKey,
        bucket: config.r2Bucket,
      });
      break;

    default:
      throw new Error(`Unknown backend type: ${backendType}`);
  }

  return new CloudStorageProvider({
    name: config.name,
    backend,
    pricing: config.pricing,
    regions: config.regions,
  });
}

// ============================================================================
// CID Utilities (re-export for convenience)
// ============================================================================

export { generateCloudCID };
