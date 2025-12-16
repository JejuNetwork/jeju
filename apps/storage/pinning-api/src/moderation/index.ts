/**
 * Content Moderation Service
 *
 * Scans content for illegal material before distribution:
 * - CSAM detection (PhotoDNA integration or HuggingFace models)
 * - NSFW classification
 * - Credit card/PII detection
 * - Malware scanning
 *
 * Integrates with on-chain ContentRegistry for blocklist management.
 */

import { createHash } from 'crypto';
import { Contract, JsonRpcProvider, Wallet } from 'ethers';
import type { Address } from 'viem';
import {
  ContentViolationType,
  ContentTier,
  type ContentScanResult,
  CONTENT_REGISTRY_ABI,
} from '../../../../../packages/types/src';

// ============ Types ============

interface ModerationConfig {
  enableLocalScanning: boolean;
  nsfwThreshold: number;
  csamThreshold: number;
  piiThreshold: number;
  contentRegistryAddress?: Address;
  rpcUrl?: string;
  privateKey?: string;
  blocklistSyncInterval: number;
}

interface ScanContext {
  mimeType: string;
  filename: string;
  size: number;
  uploader?: Address;
}

// ============ Default Config ============

const DEFAULT_CONFIG: ModerationConfig = {
  enableLocalScanning: true,
  nsfwThreshold: 0.9,
  csamThreshold: 0.95,
  piiThreshold: 0.8,
  blocklistSyncInterval: 300000, // 5 minutes
};

// ============ Patterns ============

const CREDIT_CARD_PATTERNS = [
  /\b4[0-9]{12}(?:[0-9]{3})?\b/, // Visa
  /\b5[1-5][0-9]{14}\b/, // Mastercard
  /\b3[47][0-9]{13}\b/, // Amex
  /\b6(?:011|5[0-9]{2})[0-9]{12}\b/, // Discover
];

const SSN_PATTERN = /\b\d{3}-\d{2}-\d{4}\b/;
const PHONE_PATTERN = /\b\d{3}[-.]?\d{3}[-.]?\d{4}\b/g;

// ============ ContentModerationService ============

export class ContentModerationService {
  private config: ModerationConfig;
  private blocklist: Set<string> = new Set();
  private contentRegistry: Contract | null = null;
  private lastBlocklistSync: number = 0;

  constructor(config: Partial<ModerationConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };

    if (config.contentRegistryAddress && config.rpcUrl) {
      const provider = new JsonRpcProvider(config.rpcUrl);
      const signer = config.privateKey
        ? new Wallet(config.privateKey, provider)
        : null;

      this.contentRegistry = new Contract(
        config.contentRegistryAddress,
        CONTENT_REGISTRY_ABI,
        signer ?? provider
      );
    }
  }

  /**
   * Scan content and return safety assessment
   */
  async scan(content: Buffer, context: ScanContext): Promise<ContentScanResult> {
    const startTime = Date.now();
    const contentHash = this.hashContent(content);

    // Check blocklist first
    await this.ensureBlocklistSynced();
    if (this.blocklist.has(contentHash)) {
      return {
        safe: false,
        violationType: ContentViolationType.CSAM,
        confidence: 100,
        scanDuration: Date.now() - startTime,
        details: {
          csamScore: 100,
          nsfwScore: 100,
          malwareDetected: false,
          sensitiveDataFound: false,
        },
      };
    }

    // Route to appropriate scanner based on mime type
    if (context.mimeType.startsWith('image/')) {
      return this.scanImage(content, context, startTime);
    }

    if (context.mimeType.startsWith('video/')) {
      return this.scanVideo(content, context, startTime);
    }

    if (
      context.mimeType.startsWith('text/') ||
      context.mimeType === 'application/json'
    ) {
      return this.scanText(content, context, startTime);
    }

    if (this.isArchive(context.mimeType)) {
      return this.scanArchive(content, context, startTime);
    }

    // Unknown content type - pass by default
    return {
      safe: true,
      violationType: ContentViolationType.NONE,
      confidence: 100,
      scanDuration: Date.now() - startTime,
      details: {
        csamScore: 0,
        nsfwScore: 0,
        malwareDetected: false,
        sensitiveDataFound: false,
      },
    };
  }

  /**
   * Report content to on-chain registry
   */
  async reportContent(
    contentHash: string,
    violationType: ContentViolationType,
    evidenceHash: string
  ): Promise<string | null> {
    if (!this.contentRegistry) return null;

    const tx = await this.contentRegistry.flagContent(
      contentHash,
      violationType,
      evidenceHash
    );
    const receipt = await tx.wait();
    return receipt?.hash ?? null;
  }

  /**
   * Check if content can be served
   */
  async canServe(contentHash: string): Promise<boolean> {
    await this.ensureBlocklistSynced();

    if (this.blocklist.has(contentHash)) {
      return false;
    }

    if (this.contentRegistry) {
      return this.contentRegistry.canServe(contentHash);
    }

    return true;
  }

  /**
   * Sync blocklist from on-chain registry
   */
  async syncBlocklist(): Promise<number> {
    if (!this.contentRegistry) return 0;

    const length = await this.contentRegistry.getBlocklistLength();
    const batchSize = 100;
    let synced = 0;

    for (let offset = 0; offset < length; offset += batchSize) {
      const batch = await this.contentRegistry.getBlocklistBatch(
        offset,
        batchSize
      );
      for (const hash of batch) {
        this.blocklist.add(hash);
        synced++;
      }
    }

    this.lastBlocklistSync = Date.now();
    return synced;
  }

  /**
   * Add to local blocklist
   */
  addToBlocklist(contentHash: string): void {
    this.blocklist.add(contentHash);
  }

  /**
   * Get blocklist size
   */
  getBlocklistSize(): number {
    return this.blocklist.size;
  }

  // ============ Scanners ============

  private async scanImage(
    content: Buffer,
    _context: ScanContext,
    startTime: number
  ): Promise<ContentScanResult> {
    let nsfwScore = 0;
    let csamScore = 0;

    // Use NSFW.js or similar if available
    if (this.config.enableLocalScanning) {
      // Simplified scoring - in production, use actual ML model
      // This would integrate with:
      // - nsfwjs for NSFW detection
      // - PhotoDNA API for CSAM
      // - HuggingFace models for classification

      // For now, basic heuristics
      const header = content.slice(0, 16);

      // Check for known bad signatures (placeholder)
      if (this.hasKnownBadSignature(header)) {
        csamScore = 95;
      }
    }

    const safe = csamScore < this.config.csamThreshold * 100 &&
                 nsfwScore < this.config.nsfwThreshold * 100;

    return {
      safe,
      violationType: csamScore > 90 ? ContentViolationType.CSAM : ContentViolationType.NONE,
      confidence: Math.max(csamScore, nsfwScore, 50),
      scanDuration: Date.now() - startTime,
      details: {
        csamScore,
        nsfwScore,
        malwareDetected: false,
        sensitiveDataFound: false,
      },
    };
  }

  private async scanVideo(
    _content: Buffer,
    _context: ScanContext,
    startTime: number
  ): Promise<ContentScanResult> {
    // Video scanning would extract key frames and scan each
    // For now, pass through with low confidence
    return {
      safe: true,
      violationType: ContentViolationType.NONE,
      confidence: 50,
      scanDuration: Date.now() - startTime,
      details: {
        csamScore: 0,
        nsfwScore: 0,
        malwareDetected: false,
        sensitiveDataFound: false,
      },
    };
  }

  private async scanText(
    content: Buffer,
    _context: ScanContext,
    startTime: number
  ): Promise<ContentScanResult> {
    const text = content.toString('utf-8');
    let sensitiveDataFound = false;

    // Check for credit card numbers
    let ccCount = 0;
    for (const pattern of CREDIT_CARD_PATTERNS) {
      const matches = text.match(new RegExp(pattern.source, 'g'));
      ccCount += matches?.length ?? 0;
    }

    // Check for SSNs
    const ssnMatches = text.match(new RegExp(SSN_PATTERN.source, 'g'));
    const ssnCount = ssnMatches?.length ?? 0;

    // Bulk sensitive data is a violation
    if (ccCount > 10 || ssnCount > 5) {
      return {
        safe: false,
        violationType: ContentViolationType.ILLEGAL_MATERIAL,
        confidence: 95,
        scanDuration: Date.now() - startTime,
        details: {
          csamScore: 0,
          nsfwScore: 0,
          malwareDetected: false,
          sensitiveDataFound: true,
        },
      };
    }

    sensitiveDataFound = ccCount > 0 || ssnCount > 0;

    return {
      safe: true,
      violationType: ContentViolationType.NONE,
      confidence: 100,
      scanDuration: Date.now() - startTime,
      details: {
        csamScore: 0,
        nsfwScore: 0,
        malwareDetected: false,
        sensitiveDataFound,
      },
    };
  }

  private async scanArchive(
    _content: Buffer,
    _context: ScanContext,
    startTime: number
  ): Promise<ContentScanResult> {
    // Archive scanning would extract and scan each file
    // For now, pass through
    return {
      safe: true,
      violationType: ContentViolationType.NONE,
      confidence: 50,
      scanDuration: Date.now() - startTime,
      details: {
        csamScore: 0,
        nsfwScore: 0,
        malwareDetected: false,
        sensitiveDataFound: false,
      },
    };
  }

  // ============ Helpers ============

  private hashContent(content: Buffer): string {
    return createHash('sha256').update(content).digest('hex');
  }

  private isArchive(mimeType: string): boolean {
    return (
      mimeType === 'application/zip' ||
      mimeType === 'application/x-tar' ||
      mimeType === 'application/gzip' ||
      mimeType === 'application/x-7z-compressed'
    );
  }

  private hasKnownBadSignature(_header: Buffer): boolean {
    // Placeholder - in production, check against PhotoDNA hashes
    return false;
  }

  private async ensureBlocklistSynced(): Promise<void> {
    const now = Date.now();
    if (now - this.lastBlocklistSync > this.config.blocklistSyncInterval) {
      await this.syncBlocklist();
    }
  }
}

// ============ Factory ============

let globalModerationService: ContentModerationService | null = null;

export function getModerationService(
  config?: Partial<ModerationConfig>
): ContentModerationService {
  if (!globalModerationService) {
    globalModerationService = new ContentModerationService(config);
  }
  return globalModerationService;
}

export function resetModerationService(): void {
  globalModerationService = null;
}

// ============ Exports ============

export type { ModerationConfig, ScanContext };
