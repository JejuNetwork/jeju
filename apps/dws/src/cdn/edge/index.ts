/**
 * Edge Module Exports
 */

export { EdgeNodeServer } from './server';

import type { EdgeNodeConfig } from '../types';
import { EdgeNodeServer } from './server';

/**
 * Start edge node from environment variables
 */
export async function startEdgeNode(): Promise<EdgeNodeServer> {
  const privateKey = process.env.PRIVATE_KEY;
  if (!privateKey) {
    throw new Error('PRIVATE_KEY environment variable required');
  }

  const config: EdgeNodeConfig = {
    nodeId: process.env.CDN_NODE_ID ?? crypto.randomUUID(),
    privateKey,
    endpoint: process.env.CDN_ENDPOINT ?? `http://localhost:${process.env.CDN_PORT ?? '4020'}`,
    port: parseInt(process.env.CDN_PORT ?? '4020', 10),
    region: (process.env.CDN_REGION ?? 'us-east-1') as EdgeNodeConfig['region'],
    registryAddress: (process.env.CDN_REGISTRY_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
    billingAddress: (process.env.CDN_BILLING_ADDRESS ?? '0x0000000000000000000000000000000000000000') as `0x${string}`,
    rpcUrl: process.env.RPC_URL ?? 'http://localhost:9545',
    
    maxCacheSizeMB: parseInt(process.env.CDN_CACHE_SIZE_MB ?? '512', 10),
    maxCacheEntries: parseInt(process.env.CDN_CACHE_MAX_ENTRIES ?? '100000', 10),
    defaultTTL: parseInt(process.env.CDN_DEFAULT_TTL ?? '3600', 10),
    
    origins: parseOrigins(),
    
    maxConnections: parseInt(process.env.CDN_MAX_CONNECTIONS ?? '10000', 10),
    requestTimeoutMs: parseInt(process.env.CDN_REQUEST_TIMEOUT_MS ?? '30000', 10),
    
    ipfsGateway: process.env.IPFS_GATEWAY_URL,
    enableCompression: process.env.CDN_ENABLE_COMPRESSION !== 'false',
    enableHTTP2: process.env.CDN_ENABLE_HTTP2 !== 'false',
  };

  const server = new EdgeNodeServer(config);
  server.start();
  return server;
}

/**
 * Parse origins from environment
 */
function parseOrigins(): EdgeNodeConfig['origins'] {
  const origins: EdgeNodeConfig['origins'] = [];

  // IPFS origin
  if (process.env.IPFS_GATEWAY_URL) {
    origins.push({
      name: 'ipfs',
      type: 'ipfs',
      endpoint: process.env.IPFS_GATEWAY_URL,
      timeout: 30000,
      retries: 2,
    });
  }

  // S3 origin
  if (process.env.S3_BUCKET && process.env.AWS_ACCESS_KEY_ID) {
    origins.push({
      name: 's3',
      type: 's3',
      endpoint: process.env.S3_ENDPOINT ?? '',
      bucket: process.env.S3_BUCKET,
      region: process.env.AWS_REGION ?? 'us-east-1',
      accessKeyId: process.env.AWS_ACCESS_KEY_ID,
      secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
      timeout: 10000,
      retries: 2,
    });
  }

  // R2 origin
  if (process.env.R2_BUCKET && process.env.R2_ACCESS_KEY_ID) {
    origins.push({
      name: 'r2',
      type: 'r2',
      endpoint: '',
      bucket: process.env.R2_BUCKET,
      accountId: process.env.R2_ACCOUNT_ID,
      accessKeyId: process.env.R2_ACCESS_KEY_ID,
      secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      timeout: 10000,
      retries: 2,
    });
  }

  // HTTP origin
  if (process.env.CDN_HTTP_ORIGIN) {
    origins.push({
      name: 'http',
      type: 'http',
      endpoint: process.env.CDN_HTTP_ORIGIN,
      timeout: 10000,
      retries: 2,
    });
  }

  // Vercel origin
  if (process.env.BLOB_READ_WRITE_TOKEN) {
    origins.push({
      name: 'vercel',
      type: 'vercel',
      endpoint: 'https://blob.vercel-storage.com',
      token: process.env.BLOB_READ_WRITE_TOKEN,
      timeout: 10000,
      retries: 2,
    });
  }

  return origins;
}

// CLI entry point
if (import.meta.main) {
  startEdgeNode().catch(console.error);
}

