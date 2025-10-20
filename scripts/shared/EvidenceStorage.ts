/**
 * Evidence Storage Service
 * Uploads evidence to IPFS with automatic pinning
 * Supports multiple IPFS providers with fallback
 */

import { create, IPFSHTTPClient } from 'ipfs-http-client';
import { Logger } from './logger';

const logger = new Logger({ prefix: 'EVIDENCE' });

export interface EvidenceUploadResult {
  hash: string; // IPFS CID
  url: string; // Gateway URL
  size: number; // File size in bytes
  mimeType: string;
  uploadedAt: number;
}

export interface EvidenceStorageConfig {
  providers: {
    pinata?: {
      apiKey: string;
      apiSecret: string;
    };
    infura?: {
      projectId: string;
      projectSecret: string;
    };
    local?: {
      host: string;
      port: number;
    };
  };
  defaultGateway?: string;
  maxFileSize?: number; // in bytes
}

/**
 * IPFS evidence storage with multi-provider support
 */
export class EvidenceStorage {
  private clients: IPFSHTTPClient[] = [];
  private gateway: string;
  private maxFileSize: number;

  constructor(config: EvidenceStorageConfig) {
    this.gateway = config.defaultGateway || 'https://ipfs.io/ipfs';
    this.maxFileSize = config.maxFileSize || 50 * 1024 * 1024; // 50MB default

    // Initialize Pinata client
    if (config.providers.pinata) {
      try {
        // Pinata uses their own API, not standard IPFS client
        // This is a simplified implementation
        logger.info('Pinata provider configured');
      } catch (error) {
        logger.error('Failed to initialize Pinata:', error);
      }
    }

    // Initialize Infura client
    if (config.providers.infura) {
      try {
        const auth =
          'Basic ' +
          Buffer.from(
            config.providers.infura.projectId + ':' + config.providers.infura.projectSecret
          ).toString('base64');

        const client = create({
          host: 'ipfs.infura.io',
          port: 5001,
          protocol: 'https',
          headers: {
            authorization: auth,
          },
        });

        this.clients.push(client);
        logger.info('Infura IPFS provider configured');
      } catch (error) {
        logger.error('Failed to initialize Infura:', error);
      }
    }

    // Initialize local client
    if (config.providers.local) {
      try {
        const client = create({
          host: config.providers.local.host,
          port: config.providers.local.port,
          protocol: 'http',
        });

        this.clients.push(client);
        logger.info('Local IPFS provider configured');
      } catch (error) {
        logger.error('Failed to initialize local IPFS:', error);
      }
    }

    if (this.clients.length === 0) {
      logger.warn('No IPFS providers configured! Evidence uploads will fail.');
    }
  }

  /**
   * Upload file to IPFS with automatic pinning
   */
  async upload(file: Buffer | Uint8Array, mimeType: string): Promise<EvidenceUploadResult> {
    // Validate file size
    if (file.length > this.maxFileSize) {
      throw new Error(`File too large: ${file.length} bytes (max ${this.maxFileSize})`);
    }

    logger.info(`Uploading evidence: ${file.length} bytes (${mimeType})`);

    // Try each provider in order
    for (let i = 0; i < this.clients.length; i++) {
      const client = this.clients[i];

      try {
        // Upload to IPFS
        const result = await client.add(file, {
          pin: true, // Pin to prevent garbage collection
          progress: (bytes: number) => {
            if (bytes % 100000 === 0) {
              logger.debug(`Upload progress: ${bytes} bytes`);
            }
          },
        });

        const hash = result.cid.toString();
        const url = `${this.gateway}/${hash}`;

        logger.success(`Evidence uploaded: ${hash} (${file.length} bytes)`);

        return {
          hash,
          url,
          size: file.length,
          mimeType,
          uploadedAt: Date.now(),
        };
      } catch (error) {
        logger.error(`Provider ${i + 1} failed:`, error);

        // Try next provider
        if (i < this.clients.length - 1) {
          logger.info(`Trying fallback provider ${i + 2}...`);
          continue;
        }

        // All providers failed
        throw new Error(`All IPFS providers failed: ${error}`);
      }
    }

    throw new Error('No IPFS providers available');
  }

  /**
   * Upload file from path
   */
  async uploadFile(filePath: string, mimeType: string): Promise<EvidenceUploadResult> {
    const fs = await import('fs/promises');
    const buffer = await fs.readFile(filePath);
    return this.upload(buffer, mimeType);
  }

  /**
   * Retrieve evidence from IPFS
   */
  async retrieve(hash: string): Promise<Buffer> {
    logger.info(`Retrieving evidence: ${hash}`);

    for (const client of this.clients) {
      try {
        const chunks: Uint8Array[] = [];

        for await (const chunk of client.cat(hash)) {
          chunks.push(chunk);
        }

        const buffer = Buffer.concat(chunks);
        logger.success(`Evidence retrieved: ${buffer.length} bytes`);
        return buffer;
      } catch (error) {
        logger.error('Failed to retrieve from provider:', error);
        continue;
      }
    }

    throw new Error(`Failed to retrieve evidence: ${hash}`);
  }

  /**
   * Get gateway URL for evidence
   */
  getUrl(hash: string): string {
    return `${this.gateway}/${hash}`;
  }

  /**
   * Verify evidence exists
   */
  async verify(hash: string): Promise<boolean> {
    try {
      // Try to get just the metadata (no data transfer)
      for (const client of this.clients) {
        try {
          // Try to stat the file
          await client.files.stat(`/ipfs/${hash}`);
          return true;
        } catch (error) {
          continue;
        }
      }
      return false;
    } catch (error) {
      logger.error('Verification failed:', error);
      return false;
    }
  }

  /**
   * Pin evidence to ensure availability
   */
  async pin(hash: string): Promise<void> {
    logger.info(`Pinning evidence: ${hash}`);

    for (const client of this.clients) {
      try {
        await client.pin.add(hash);
        logger.success(`Evidence pinned: ${hash}`);
        return;
      } catch (error) {
        logger.error('Failed to pin:', error);
        continue;
      }
    }

    throw new Error(`Failed to pin evidence: ${hash}`);
  }

  /**
   * Unpin evidence (for cleanup)
   */
  async unpin(hash: string): Promise<void> {
    logger.info(`Unpinning evidence: ${hash}`);

    for (const client of this.clients) {
      try {
        await client.pin.rm(hash);
        logger.info(`Evidence unpinned: ${hash}`);
        return;
      } catch (error) {
        logger.error('Failed to unpin:', error);
        continue;
      }
    }
  }

  /**
   * Compress large files before upload
   */
  async compressIfNeeded(file: Buffer, mimeType: string): Promise<Buffer> {
    // Only compress if > 1MB
    if (file.length < 1024 * 1024) {
      return file;
    }

    // For images, use image compression
    if (mimeType.startsWith('image/')) {
      logger.info('Compressing image...');
      // TODO: Implement image compression (sharp, imagemin, etc.)
      return file;
    }

    // For other files, use gzip
    const zlib = await import('zlib');
    const compressed = await new Promise<Buffer>((resolve, reject) => {
      zlib.gzip(file, (err, result) => {
        if (err) reject(err);
        else resolve(result);
      });
    });

    logger.info(`Compressed: ${file.length} → ${compressed.length} bytes`);
    return compressed;
  }
}

/**
 * Create evidence storage instance from environment
 */
export function createEvidenceStorage(): EvidenceStorage {
  const config: EvidenceStorageConfig = {
    providers: {},
  };

  // Load from environment
  if (process.env.PINATA_API_KEY && process.env.PINATA_API_SECRET) {
    config.providers.pinata = {
      apiKey: process.env.PINATA_API_KEY,
      apiSecret: process.env.PINATA_API_SECRET,
    };
  }

  if (process.env.INFURA_PROJECT_ID && process.env.INFURA_PROJECT_SECRET) {
    config.providers.infura = {
      projectId: process.env.INFURA_PROJECT_ID,
      projectSecret: process.env.INFURA_PROJECT_SECRET,
    };
  }

  if (process.env.IPFS_HOST && process.env.IPFS_PORT) {
    config.providers.local = {
      host: process.env.IPFS_HOST,
      port: parseInt(process.env.IPFS_PORT),
    };
  }

  if (process.env.IPFS_GATEWAY) {
    config.defaultGateway = process.env.IPFS_GATEWAY;
  }

  return new EvidenceStorage(config);
}

