/**
 * UnifiedStorageSDK - Single entry point for all storage operations
 *
 * Handles:
 * - Public content (IPFS + Torrent hybrid)
 * - Private encrypted content (KMS + Torrent)
 * - Content moderation
 * - Automatic routing
 * - Seeding rewards
 */

import { Contract, JsonRpcProvider, Wallet, keccak256, toUtf8Bytes } from 'ethers';
import type { Address } from 'viem';
import {
  ContentTier,
  ContentViolationType,
  type ContentRecord,
  type TorrentUploadResult,
  type ContentScanResult,
  type EncryptedContent,
  type ContentIdentifier,
  type SeederStats,
  CONTENT_REGISTRY_ABI,
} from '../../../../../packages/types/src';
import { BackendManager, createBackendManager } from '../backends';
import { TorrentBackend, getTorrentBackend } from '../backends/torrent';
import { getModerationService, type ContentModerationService } from '../moderation';
import { getEncryptionService, type EncryptionService, type AccessPolicy } from '../encryption';

// ============ Types ============

export interface UnifiedStorageConfig {
  rpcUrl: string;
  privateKey?: string;
  contentRegistryAddress: Address;
  ipfsApiUrl?: string;
  ipfsGatewayUrl?: string;
  trackers?: string[];
  enableModeration?: boolean;
}

export interface UploadOptions {
  filename: string;
  tier?: ContentTier;
  encrypt?: boolean;
  accessPolicy?: AccessPolicy;
  scanContent?: boolean;
  preferTorrent?: boolean;
}

export interface UploadResult {
  contentHash: `0x${string}`;
  cid?: string;
  infohash?: string;
  magnetUri?: string;
  size: number;
  tier: ContentTier;
  encrypted: boolean;
  keyId?: string;
  rewardPoolRequired: bigint;
  txHash?: string;
}

export interface DownloadOptions {
  preferTorrent?: boolean;
  timeout?: number;
  decrypt?: boolean;
  authSignature?: {
    sig: `0x${string}`;
    message: string;
    address: Address;
  };
}

// ============ UnifiedStorageSDK ============

export class UnifiedStorageSDK {
  private provider: JsonRpcProvider;
  private signer: Wallet | null;
  private contentRegistry: Contract;
  private backendManager: BackendManager;
  private torrentBackend: TorrentBackend;
  private moderationService: ContentModerationService;
  private encryptionService: EncryptionService;

  constructor(config: UnifiedStorageConfig) {
    this.provider = new JsonRpcProvider(config.rpcUrl);
    this.signer = config.privateKey
      ? new Wallet(config.privateKey, this.provider)
      : null;

    const signerOrProvider = this.signer ?? this.provider;
    this.contentRegistry = new Contract(
      config.contentRegistryAddress,
      CONTENT_REGISTRY_ABI,
      signerOrProvider
    );

    this.backendManager = createBackendManager();
    this.torrentBackend = getTorrentBackend({
      trackers: config.trackers,
    });

    this.moderationService = getModerationService({
      contentRegistryAddress: config.contentRegistryAddress,
      rpcUrl: config.rpcUrl,
      privateKey: config.privateKey,
    });

    this.encryptionService = getEncryptionService();
  }

  // ============ Upload ============

  /**
   * Upload content with automatic handling of encryption, moderation, and distribution
   */
  async upload(content: Buffer, options: UploadOptions): Promise<UploadResult> {
    const tier = options.tier ?? ContentTier.STANDARD;

    // 1. Content moderation scan
    if (options.scanContent !== false) {
      const scanResult = await this.moderationService.scan(content, {
        mimeType: this.detectMimeType(options.filename),
        filename: options.filename,
        size: content.length,
        uploader: this.signer?.address as Address,
      });

      if (!scanResult.safe) {
        throw new Error(
          `Content rejected: ${ContentViolationType[scanResult.violationType]}`
        );
      }
    }

    // 2. Compute content hash
    const contentHash = this.hashContent(content);

    // 3. Handle encryption if requested
    let processedContent = content;
    let keyId: string | undefined;

    if (options.encrypt && options.accessPolicy) {
      const encrypted = this.encryptionService.encrypt(content, options.accessPolicy);
      processedContent = this.encryptionService.serializePayload(encrypted);
      keyId = encrypted.keyId;
    }

    // 4. Upload to backends
    const results = await Promise.all([
      // IPFS upload
      this.backendManager.upload(processedContent, {
        filename: options.filename,
        tier: tier === ContentTier.PREMIUM_HOT ? 'hot' : 'warm' as const,
      }),
      // Torrent creation
      this.torrentBackend.upload(processedContent, {
        filename: options.filename,
      }),
    ]);

    const ipfsResult = results[0];
    const torrentResult = results[1];

    // 5. Extract infohash from torrent result
    const infohash = torrentResult.cid.startsWith('torrent:')
      ? torrentResult.cid.slice(8)
      : torrentResult.cid;

    // 6. Calculate reward pool
    const rewardRate = await this.contentRegistry.getRewardRate(tier);
    const gbSize = Math.ceil(content.length / (1024 * 1024 * 1024)) || 1;
    const rewardPoolRequired = BigInt(gbSize) * BigInt(rewardRate) * 50n;

    // 7. Register on-chain
    let txHash: string | undefined;
    if (this.signer) {
      const tx = await this.contentRegistry.registerContent(
        contentHash,
        `0x${infohash}`,
        content.length,
        tier,
        { value: tier === ContentTier.NETWORK_FREE ? 0 : rewardPoolRequired }
      );
      const receipt = await tx.wait();
      txHash = receipt?.hash;
    }

    return {
      contentHash: contentHash as `0x${string}`,
      cid: ipfsResult.cid,
      infohash,
      magnetUri: torrentResult.url,
      size: content.length,
      tier,
      encrypted: options.encrypt ?? false,
      keyId,
      rewardPoolRequired,
      txHash,
    };
  }

  // ============ Download ============

  /**
   * Download content with automatic routing and decryption
   */
  async download(
    identifier: string,
    options: DownloadOptions = {}
  ): Promise<Buffer> {
    // 1. Check if content can be served
    const contentHash = await this.resolveContentHash(identifier);
    const canServe = await this.contentRegistry.canServe(contentHash);

    if (!canServe) {
      throw new Error('Content blocked or unavailable');
    }

    // 2. Try torrent first if preferred
    let content: Buffer;

    if (options.preferTorrent !== false) {
      const swarmInfo = await this.torrentBackend.getSwarmInfo(identifier);
      if (swarmInfo.seeders > 0) {
        content = await this.torrentBackend.download(identifier);
      } else {
        content = await this.downloadFromBackends(identifier);
      }
    } else {
      content = await this.downloadFromBackends(identifier);
    }

    // 3. Decrypt if needed
    if (options.decrypt && options.authSignature) {
      const payload = this.encryptionService.deserializePayload(content);
      return this.encryptionService.decrypt(payload, options.authSignature);
    }

    return content;
  }

  // ============ Seeding ============

  /**
   * Start seeding content for rewards
   */
  async startSeeding(infohash: string): Promise<void> {
    // Add to local torrent client
    await this.torrentBackend.addTorrentToSeed(
      `magnet:?xt=urn:btih:${infohash}`
    );

    // Register on-chain
    if (this.signer) {
      const tx = await this.contentRegistry.startSeeding(`0x${infohash}`);
      await tx.wait();
    }
  }

  /**
   * Stop seeding content
   */
  async stopSeeding(infohash: string): Promise<void> {
    this.torrentBackend.stopSeeding(infohash);

    if (this.signer) {
      const tx = await this.contentRegistry.stopSeeding(`0x${infohash}`);
      await tx.wait();
    }
  }

  /**
   * Report seeding activity for rewards
   */
  async reportSeeding(
    infohash: string,
    oracleSignature: `0x${string}`
  ): Promise<string | null> {
    const record = this.torrentBackend.getSeedingRecord(infohash);
    if (!record || !this.signer) return null;

    const tx = await this.contentRegistry.reportSeeding(
      `0x${infohash}`,
      record.bytesUploaded,
      oracleSignature
    );
    const receipt = await tx.wait();

    // Reset local stats after reporting
    this.torrentBackend.resetSeedingStats(infohash);

    return receipt?.hash ?? null;
  }

  /**
   * Claim accumulated seeding rewards
   */
  async claimRewards(): Promise<string | null> {
    if (!this.signer) return null;

    const tx = await this.contentRegistry.claimRewards();
    const receipt = await tx.wait();
    return receipt?.hash ?? null;
  }

  /**
   * Get seeding statistics
   */
  async getSeederStats(address?: Address): Promise<SeederStats> {
    const addr = address ?? this.signer?.address;
    if (!addr) throw new Error('Address required');

    return this.contentRegistry.getSeederStats(addr);
  }

  // ============ Moderation ============

  /**
   * Report content for moderation
   */
  async reportContent(
    contentHash: string,
    violationType: ContentViolationType,
    evidence: Buffer
  ): Promise<string | null> {
    const evidenceHash = this.hashContent(evidence);
    return this.moderationService.reportContent(
      contentHash,
      violationType,
      evidenceHash
    );
  }

  /**
   * Check if content is blocked
   */
  async isBlocked(contentHash: string): Promise<boolean> {
    return this.contentRegistry.isBlocked(contentHash);
  }

  // ============ Query ============

  /**
   * Get content record from registry
   */
  async getContent(contentHash: string): Promise<ContentRecord> {
    return this.contentRegistry.getContent(contentHash);
  }

  /**
   * Get reward rate for tier
   */
  async getRewardRate(tier: ContentTier): Promise<bigint> {
    return this.contentRegistry.getRewardRate(tier);
  }

  /**
   * Get local seeding stats
   */
  getLocalSeedingStats(): {
    torrentsSeeding: number;
    totalUploaded: number;
    activePeers: number;
  } {
    return this.torrentBackend.getSeedingStats();
  }

  // ============ Helpers ============

  private hashContent(content: Buffer): string {
    return keccak256(content);
  }

  private async resolveContentHash(identifier: string): Promise<string> {
    // If already a hash
    if (identifier.startsWith('0x') && identifier.length === 66) {
      return identifier;
    }

    // If infohash, look up mapping
    if (identifier.length === 40) {
      // Would query infohashToContent mapping
      return `0x${identifier.padStart(64, '0')}`;
    }

    // If CID, compute hash
    return this.hashContent(Buffer.from(identifier));
  }

  private async downloadFromBackends(identifier: string): Promise<Buffer> {
    const result = await this.backendManager.download(identifier);
    return result.content;
  }

  private detectMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase() ?? '';
    const mimeTypes: Record<string, string> = {
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      png: 'image/png',
      gif: 'image/gif',
      webp: 'image/webp',
      mp4: 'video/mp4',
      webm: 'video/webm',
      txt: 'text/plain',
      json: 'application/json',
      html: 'text/html',
      css: 'text/css',
      js: 'application/javascript',
      zip: 'application/zip',
      tar: 'application/x-tar',
      gz: 'application/gzip',
    };
    return mimeTypes[ext] ?? 'application/octet-stream';
  }
}

// ============ Factory ============

export function createUnifiedStorage(
  config: UnifiedStorageConfig
): UnifiedStorageSDK {
  return new UnifiedStorageSDK(config);
}
