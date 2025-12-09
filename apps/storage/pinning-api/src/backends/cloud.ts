/**
 * Cloud Storage Backends
 * 
 * Full integration with cloud storage providers as Jeju storage providers:
 * - Vercel Blob
 * - AWS S3
 * - Cloudflare R2
 * 
 * Each backend implements content-addressed storage with CID generation
 * for compatibility with the IPFS ecosystem.
 */

import { createHash } from 'crypto';

// ============================================================================
// Types
// ============================================================================

export interface CloudUploadResult {
  cid: string;
  url: string;
  size: number;
  provider: 'vercel' | 's3' | 'r2';
}

export interface CloudStorageConfig {
  provider: 'vercel' | 's3' | 'r2';
  // Vercel Blob
  vercelToken?: string;
  vercelStoreId?: string;
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

export interface CloudStorageBackend {
  type: 'vercel' | 's3' | 'r2';
  upload(content: Buffer, filename: string): Promise<CloudUploadResult>;
  download(cid: string): Promise<Buffer>;
  delete(cid: string): Promise<void>;
  exists(cid: string): Promise<boolean>;
  getUrl(cid: string): string;
  list(prefix?: string): Promise<Array<{ cid: string; size: number; createdAt: Date }>>;
}

// ============================================================================
// Content-Addressed CID Generation
// ============================================================================

/**
 * Generate a CID-like identifier from content
 * Uses SHA-256 hash with a cloud- prefix to distinguish from IPFS CIDs
 */
export function generateCloudCID(content: Buffer): string {
  const hash = createHash('sha256').update(content).digest('hex');
  return `cloud-${hash.slice(0, 32)}`;
}

/**
 * Parse a cloud CID to extract the hash
 */
export function parseCloudCID(cid: string): string | null {
  if (!cid.startsWith('cloud-')) return null;
  return cid.slice(6);
}

// ============================================================================
// Vercel Blob Backend
// ============================================================================

export class VercelBlobBackend implements CloudStorageBackend {
  type = 'vercel' as const;
  private token: string;
  private storeId: string;
  private baseUrl: string;

  constructor(config: { token: string; storeId?: string }) {
    this.token = config.token;
    this.storeId = config.storeId || '';
    this.baseUrl = 'https://blob.vercel-storage.com';
  }

  async upload(content: Buffer, filename: string): Promise<CloudUploadResult> {
    const cid = generateCloudCID(content);
    const path = `jeju/${cid}/${filename}`;

    const response = await fetch(`${this.baseUrl}/${path}`, {
      method: 'PUT',
      headers: {
        'Authorization': `Bearer ${this.token}`,
        'Content-Type': 'application/octet-stream',
        'x-vercel-blob-content-type': this.getMimeType(filename),
      },
      body: content,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Vercel Blob upload failed: ${error}`);
    }

    const result = await response.json() as { url: string };

    return {
      cid,
      url: result.url,
      size: content.length,
      provider: 'vercel',
    };
  }

  async download(cid: string): Promise<Buffer> {
    // List blobs with this CID prefix
    const blobs = await this.list(cid);
    if (blobs.length === 0) {
      throw new Error(`Content not found: ${cid}`);
    }

    const url = this.getUrl(cid);
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`Vercel Blob download failed: ${response.statusText}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  async delete(cid: string): Promise<void> {
    const response = await fetch(`${this.baseUrl}?url=${encodeURIComponent(this.getUrl(cid))}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${this.token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Vercel Blob delete failed: ${response.statusText}`);
    }
  }

  async exists(cid: string): Promise<boolean> {
    const blobs = await this.list(cid);
    return blobs.length > 0;
  }

  getUrl(cid: string): string {
    // Vercel Blob URLs are returned on upload, but we can construct them
    return `${this.baseUrl}/jeju/${cid}`;
  }

  async list(prefix?: string): Promise<Array<{ cid: string; size: number; createdAt: Date }>> {
    const params = new URLSearchParams();
    if (prefix) params.set('prefix', `jeju/${prefix}`);

    const response = await fetch(`${this.baseUrl}?${params}`, {
      headers: {
        'Authorization': `Bearer ${this.token}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Vercel Blob list failed: ${response.statusText}`);
    }

    const data = await response.json() as { blobs: Array<{ pathname: string; size: number; uploadedAt: string }> };

    return data.blobs.map(blob => {
      const parts = blob.pathname.split('/');
      const cid = parts[1] || blob.pathname;
      return {
        cid,
        size: blob.size,
        createdAt: new Date(blob.uploadedAt),
      };
    });
  }

  private getMimeType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase();
    const mimeTypes: Record<string, string> = {
      'json': 'application/json',
      'txt': 'text/plain',
      'html': 'text/html',
      'css': 'text/css',
      'js': 'application/javascript',
      'png': 'image/png',
      'jpg': 'image/jpeg',
      'jpeg': 'image/jpeg',
      'gif': 'image/gif',
      'webp': 'image/webp',
      'svg': 'image/svg+xml',
      'pdf': 'application/pdf',
      'zip': 'application/zip',
    };
    return mimeTypes[ext || ''] || 'application/octet-stream';
  }
}

// ============================================================================
// S3 Backend
// ============================================================================

export class S3Backend implements CloudStorageBackend {
  type = 's3' as const;
  private bucket: string;
  private region: string;
  private accessKeyId: string;
  private secretAccessKey: string;
  private endpoint: string;

  constructor(config: {
    bucket: string;
    region: string;
    accessKeyId: string;
    secretAccessKey: string;
    endpoint?: string;
  }) {
    this.bucket = config.bucket;
    this.region = config.region;
    this.accessKeyId = config.accessKeyId;
    this.secretAccessKey = config.secretAccessKey;
    this.endpoint = config.endpoint || `https://s3.${config.region}.amazonaws.com`;
  }

  async upload(content: Buffer, filename: string): Promise<CloudUploadResult> {
    const cid = generateCloudCID(content);
    const key = `jeju/${cid}/${filename}`;

    const url = `${this.endpoint}/${this.bucket}/${key}`;
    const headers = await this.signRequest('PUT', key, content);

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        ...headers,
        'Content-Type': 'application/octet-stream',
      },
      body: content,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`S3 upload failed: ${error}`);
    }

    return {
      cid,
      url: this.getUrl(cid),
      size: content.length,
      provider: 's3',
    };
  }

  async download(cid: string): Promise<Buffer> {
    const key = `jeju/${cid}`;
    const url = `${this.endpoint}/${this.bucket}/${key}`;
    const headers = await this.signRequest('GET', key);

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`S3 download failed: ${response.statusText}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  async delete(cid: string): Promise<void> {
    const key = `jeju/${cid}`;
    const url = `${this.endpoint}/${this.bucket}/${key}`;
    const headers = await this.signRequest('DELETE', key);

    const response = await fetch(url, { method: 'DELETE', headers });
    if (!response.ok) {
      throw new Error(`S3 delete failed: ${response.statusText}`);
    }
  }

  async exists(cid: string): Promise<boolean> {
    const key = `jeju/${cid}`;
    const url = `${this.endpoint}/${this.bucket}/${key}`;
    const headers = await this.signRequest('HEAD', key);

    const response = await fetch(url, { method: 'HEAD', headers });
    return response.ok;
  }

  getUrl(cid: string): string {
    return `${this.endpoint}/${this.bucket}/jeju/${cid}`;
  }

  async list(prefix?: string): Promise<Array<{ cid: string; size: number; createdAt: Date }>> {
    const listPrefix = prefix ? `jeju/${prefix}` : 'jeju/';
    const url = `${this.endpoint}/${this.bucket}?list-type=2&prefix=${encodeURIComponent(listPrefix)}`;
    const headers = await this.signRequest('GET', '', undefined, { 'list-type': '2', prefix: listPrefix });

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`S3 list failed: ${response.statusText}`);
    }

    const text = await response.text();
    // Parse XML response (simplified)
    const contents: Array<{ cid: string; size: number; createdAt: Date }> = [];
    const keyMatches = text.matchAll(/<Key>([^<]+)<\/Key>/g);
    const sizeMatches = text.matchAll(/<Size>(\d+)<\/Size>/g);
    const dateMatches = text.matchAll(/<LastModified>([^<]+)<\/LastModified>/g);

    const keys = Array.from(keyMatches).map(m => m[1]);
    const sizes = Array.from(sizeMatches).map(m => parseInt(m[1]));
    const dates = Array.from(dateMatches).map(m => new Date(m[1]));

    for (let i = 0; i < keys.length; i++) {
      const parts = keys[i].split('/');
      if (parts[0] === 'jeju' && parts[1]) {
        contents.push({
          cid: parts[1],
          size: sizes[i] || 0,
          createdAt: dates[i] || new Date(),
        });
      }
    }

    return contents;
  }

  private async signRequest(
    method: string,
    key: string,
    body?: Buffer,
    queryParams?: Record<string, string>
  ): Promise<Record<string, string>> {
    // AWS Signature Version 4 (simplified)
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);

    const contentHash = body 
      ? createHash('sha256').update(body).digest('hex')
      : 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'; // Empty hash

    const headers: Record<string, string> = {
      'Host': new URL(this.endpoint).host,
      'X-Amz-Date': amzDate,
      'X-Amz-Content-SHA256': contentHash,
    };

    // Create canonical request
    const signedHeaders = Object.keys(headers).map(h => h.toLowerCase()).sort().join(';');
    const canonicalHeaders = Object.entries(headers)
      .map(([k, v]) => `${k.toLowerCase()}:${v}`)
      .sort()
      .join('\n') + '\n';

    const canonicalUri = `/${this.bucket}/${key}`;
    const canonicalQueryString = queryParams 
      ? Object.entries(queryParams).sort().map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
      : '';

    const canonicalRequest = [
      method,
      canonicalUri,
      canonicalQueryString,
      canonicalHeaders,
      signedHeaders,
      contentHash,
    ].join('\n');

    const algorithm = 'AWS4-HMAC-SHA256';
    const credentialScope = `${dateStamp}/${this.region}/s3/aws4_request`;

    const stringToSign = [
      algorithm,
      amzDate,
      credentialScope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    // Generate signing key
    const kDate = this.hmac(`AWS4${this.secretAccessKey}`, dateStamp);
    const kRegion = this.hmac(kDate, this.region);
    const kService = this.hmac(kRegion, 's3');
    const kSigning = this.hmac(kService, 'aws4_request');
    const signature = this.hmac(kSigning, stringToSign, 'hex');

    const authorization = `${algorithm} Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return {
      ...headers,
      'Authorization': authorization,
    };
  }

  private hmac(key: string | Buffer, data: string, encoding?: 'hex'): Buffer | string {
    const hmac = createHash('sha256');
    // Use createHmac for proper HMAC
    const crypto = require('crypto');
    const result = crypto.createHmac('sha256', key).update(data);
    return encoding ? result.digest(encoding) : result.digest();
  }
}

// ============================================================================
// Cloudflare R2 Backend
// ============================================================================

export class R2Backend implements CloudStorageBackend {
  type = 'r2' as const;
  private accountId: string;
  private accessKeyId: string;
  private secretAccessKey: string;
  private bucket: string;
  private endpoint: string;

  constructor(config: {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
  }) {
    this.accountId = config.accountId;
    this.accessKeyId = config.accessKeyId;
    this.secretAccessKey = config.secretAccessKey;
    this.bucket = config.bucket;
    this.endpoint = `https://${config.accountId}.r2.cloudflarestorage.com`;
  }

  async upload(content: Buffer, filename: string): Promise<CloudUploadResult> {
    const cid = generateCloudCID(content);
    const key = `jeju/${cid}/${filename}`;

    // R2 uses S3-compatible API
    const url = `${this.endpoint}/${this.bucket}/${key}`;
    const headers = await this.signRequest('PUT', key, content);

    const response = await fetch(url, {
      method: 'PUT',
      headers: {
        ...headers,
        'Content-Type': 'application/octet-stream',
      },
      body: content,
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`R2 upload failed: ${error}`);
    }

    return {
      cid,
      url: this.getUrl(cid),
      size: content.length,
      provider: 'r2',
    };
  }

  async download(cid: string): Promise<Buffer> {
    const key = `jeju/${cid}`;
    const url = `${this.endpoint}/${this.bucket}/${key}`;
    const headers = await this.signRequest('GET', key);

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`R2 download failed: ${response.statusText}`);
    }

    return Buffer.from(await response.arrayBuffer());
  }

  async delete(cid: string): Promise<void> {
    const key = `jeju/${cid}`;
    const url = `${this.endpoint}/${this.bucket}/${key}`;
    const headers = await this.signRequest('DELETE', key);

    const response = await fetch(url, { method: 'DELETE', headers });
    if (!response.ok) {
      throw new Error(`R2 delete failed: ${response.statusText}`);
    }
  }

  async exists(cid: string): Promise<boolean> {
    const key = `jeju/${cid}`;
    const url = `${this.endpoint}/${this.bucket}/${key}`;
    const headers = await this.signRequest('HEAD', key);

    const response = await fetch(url, { method: 'HEAD', headers });
    return response.ok;
  }

  getUrl(cid: string): string {
    // R2 public URL (if bucket has public access)
    return `https://pub-${this.accountId}.r2.dev/${this.bucket}/jeju/${cid}`;
  }

  async list(prefix?: string): Promise<Array<{ cid: string; size: number; createdAt: Date }>> {
    const listPrefix = prefix ? `jeju/${prefix}` : 'jeju/';
    const url = `${this.endpoint}/${this.bucket}?list-type=2&prefix=${encodeURIComponent(listPrefix)}`;
    const headers = await this.signRequest('GET', '');

    const response = await fetch(url, { headers });
    if (!response.ok) {
      throw new Error(`R2 list failed: ${response.statusText}`);
    }

    const text = await response.text();
    const contents: Array<{ cid: string; size: number; createdAt: Date }> = [];
    const keyMatches = text.matchAll(/<Key>([^<]+)<\/Key>/g);
    const sizeMatches = text.matchAll(/<Size>(\d+)<\/Size>/g);
    const dateMatches = text.matchAll(/<LastModified>([^<]+)<\/LastModified>/g);

    const keys = Array.from(keyMatches).map(m => m[1]);
    const sizes = Array.from(sizeMatches).map(m => parseInt(m[1]));
    const dates = Array.from(dateMatches).map(m => new Date(m[1]));

    for (let i = 0; i < keys.length; i++) {
      const parts = keys[i].split('/');
      if (parts[0] === 'jeju' && parts[1]) {
        contents.push({
          cid: parts[1],
          size: sizes[i] || 0,
          createdAt: dates[i] || new Date(),
        });
      }
    }

    return contents;
  }

  private async signRequest(
    method: string,
    key: string,
    body?: Buffer
  ): Promise<Record<string, string>> {
    // R2 uses AWS Signature Version 4 (same as S3)
    const now = new Date();
    const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
    const dateStamp = amzDate.slice(0, 8);

    const contentHash = body 
      ? createHash('sha256').update(body).digest('hex')
      : 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

    const host = `${this.accountId}.r2.cloudflarestorage.com`;

    const headers: Record<string, string> = {
      'Host': host,
      'X-Amz-Date': amzDate,
      'X-Amz-Content-SHA256': contentHash,
    };

    const signedHeaders = Object.keys(headers).map(h => h.toLowerCase()).sort().join(';');
    const canonicalHeaders = Object.entries(headers)
      .map(([k, v]) => `${k.toLowerCase()}:${v}`)
      .sort()
      .join('\n') + '\n';

    const canonicalUri = `/${this.bucket}/${key}`;
    const canonicalRequest = [
      method,
      canonicalUri,
      '',
      canonicalHeaders,
      signedHeaders,
      contentHash,
    ].join('\n');

    const algorithm = 'AWS4-HMAC-SHA256';
    const region = 'auto';
    const credentialScope = `${dateStamp}/${region}/s3/aws4_request`;

    const stringToSign = [
      algorithm,
      amzDate,
      credentialScope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');

    const crypto = require('crypto');
    const kDate = crypto.createHmac('sha256', `AWS4${this.secretAccessKey}`).update(dateStamp).digest();
    const kRegion = crypto.createHmac('sha256', kDate).update(region).digest();
    const kService = crypto.createHmac('sha256', kRegion).update('s3').digest();
    const kSigning = crypto.createHmac('sha256', kService).update('aws4_request').digest();
    const signature = crypto.createHmac('sha256', kSigning).update(stringToSign).digest('hex');

    const authorization = `${algorithm} Credential=${this.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

    return {
      ...headers,
      'Authorization': authorization,
    };
  }
}

// ============================================================================
// Factory
// ============================================================================

export function createCloudBackend(config: CloudStorageConfig): CloudStorageBackend {
  switch (config.provider) {
    case 'vercel':
      if (!config.vercelToken) throw new Error('Vercel token required');
      return new VercelBlobBackend({
        token: config.vercelToken,
        storeId: config.vercelStoreId,
      });

    case 's3':
      if (!config.s3Bucket || !config.s3AccessKeyId || !config.s3SecretAccessKey) {
        throw new Error('S3 bucket, accessKeyId, and secretAccessKey required');
      }
      return new S3Backend({
        bucket: config.s3Bucket,
        region: config.s3Region || 'us-east-1',
        accessKeyId: config.s3AccessKeyId,
        secretAccessKey: config.s3SecretAccessKey,
        endpoint: config.s3Endpoint,
      });

    case 'r2':
      if (!config.r2AccountId || !config.r2AccessKeyId || !config.r2SecretAccessKey || !config.r2Bucket) {
        throw new Error('R2 accountId, accessKeyId, secretAccessKey, and bucket required');
      }
      return new R2Backend({
        accountId: config.r2AccountId,
        accessKeyId: config.r2AccessKeyId,
        secretAccessKey: config.r2SecretAccessKey,
        bucket: config.r2Bucket,
      });

    default:
      throw new Error(`Unsupported cloud provider: ${config.provider}`);
  }
}

/**
 * Create cloud backend from environment variables
 */
export function createCloudBackendFromEnv(): CloudStorageBackend | null {
  // Try Vercel Blob first
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    return new VercelBlobBackend({
      token: process.env.BLOB_READ_WRITE_TOKEN,
      storeId: process.env.VERCEL_BLOB_STORE_ID,
    });
  }

  // Try S3
  if (process.env.S3_BUCKET && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY) {
    return new S3Backend({
      bucket: process.env.S3_BUCKET,
      region: process.env.AWS_REGION || 'us-east-1',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      endpoint: process.env.S3_ENDPOINT,
    });
  }

  // Try R2
  if (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY && process.env.R2_BUCKET) {
    return new R2Backend({
      accountId: process.env.R2_ACCOUNT_ID,
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      bucket: process.env.R2_BUCKET,
    });
  }

  return null;
}

