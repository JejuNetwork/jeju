/**
 * Edge Module Exports
 */

export { EdgeNodeServer } from './server'

import {
  getEnvBool,
  getEnvNumber,
  getEnvVar,
  getIpfsGatewayEnv,
  getRpcUrl,
} from '@jejunetwork/config'
import type { EdgeNodeConfig } from '../types'
import { EdgeNodeServer } from './server'

// Config injection for workerd compatibility
export interface EdgeNodeStartConfig {
  privateKey?: string
  nodeId?: string
  endpoint?: string
  port?: number
  region?: EdgeNodeConfig['region']
  registryAddress?: `0x${string}`
  billingAddress?: `0x${string}`
  maxCacheSizeMB?: number
  maxCacheEntries?: number
  defaultTTL?: number
  maxConnections?: number
  requestTimeoutMs?: number
  enableCompression?: boolean
  enableHTTP2?: boolean
  s3Bucket?: string
  s3Endpoint?: string
  s3Region?: string
  s3AccessKeyId?: string
  s3SecretAccessKey?: string
  r2Bucket?: string
  r2AccountId?: string
  r2AccessKeyId?: string
  r2SecretAccessKey?: string
  cdnHttpOrigin?: string
  blobReadWriteToken?: string
}

let edgeNodeConfig: EdgeNodeStartConfig = {}

export function configureEdgeNode(config: Partial<EdgeNodeStartConfig>): void {
  edgeNodeConfig = { ...edgeNodeConfig, ...config }
}

/**
 * Start edge node from environment variables
 */
export async function startEdgeNode(): Promise<EdgeNodeServer> {
  const privateKey =
    edgeNodeConfig.privateKey ??
    getEnvVar('PRIVATE_KEY') ??
    (typeof process !== 'undefined' ? process.env.PRIVATE_KEY : undefined)
  if (!privateKey) {
    throw new Error('PRIVATE_KEY environment variable required')
  }

  const config: EdgeNodeConfig = {
    nodeId:
      edgeNodeConfig.nodeId ??
      getEnvVar('CDN_NODE_ID') ??
      (typeof process !== 'undefined' ? process.env.CDN_NODE_ID : undefined) ??
      crypto.randomUUID(),
    privateKey,
    endpoint:
      edgeNodeConfig.endpoint ??
      getEnvVar('CDN_ENDPOINT') ??
      (typeof process !== 'undefined' ? process.env.CDN_ENDPOINT : undefined) ??
      `http://localhost:${
        edgeNodeConfig.port ??
        getEnvNumber('CDN_PORT') ??
        (
          typeof process !== 'undefined'
            ? parseInt(process.env.CDN_PORT ?? '4020', 10)
            : undefined
        ) ??
        4020
      }`,
    port:
      edgeNodeConfig.port ??
      getEnvNumber('CDN_PORT') ??
      (typeof process !== 'undefined'
        ? parseInt(process.env.CDN_PORT ?? '4020', 10)
        : undefined) ??
      4020,
    region: (edgeNodeConfig.region ??
      getEnvVar('CDN_REGION') ??
      (typeof process !== 'undefined' ? process.env.CDN_REGION : undefined) ??
      'us-east-1') as EdgeNodeConfig['region'],
    registryAddress: (edgeNodeConfig.registryAddress ??
      getEnvVar('CDN_REGISTRY_ADDRESS') ??
      (typeof process !== 'undefined'
        ? process.env.CDN_REGISTRY_ADDRESS
        : undefined) ??
      '0x0000000000000000000000000000000000000000') as `0x${string}`,
    billingAddress: (edgeNodeConfig.billingAddress ??
      getEnvVar('CDN_BILLING_ADDRESS') ??
      (typeof process !== 'undefined'
        ? process.env.CDN_BILLING_ADDRESS
        : undefined) ??
      '0x0000000000000000000000000000000000000000') as `0x${string}`,
    rpcUrl: getRpcUrl(),

    maxCacheSizeMB:
      edgeNodeConfig.maxCacheSizeMB ??
      getEnvNumber('CDN_CACHE_SIZE_MB') ??
      (typeof process !== 'undefined'
        ? parseInt(process.env.CDN_CACHE_SIZE_MB ?? '512', 10)
        : undefined) ??
      512,
    maxCacheEntries:
      edgeNodeConfig.maxCacheEntries ??
      getEnvNumber('CDN_CACHE_MAX_ENTRIES') ??
      (typeof process !== 'undefined'
        ? parseInt(process.env.CDN_CACHE_MAX_ENTRIES ?? '100000', 10)
        : undefined) ??
      100000,
    defaultTTL:
      edgeNodeConfig.defaultTTL ??
      getEnvNumber('CDN_DEFAULT_TTL') ??
      (typeof process !== 'undefined'
        ? parseInt(process.env.CDN_DEFAULT_TTL ?? '3600', 10)
        : undefined) ??
      3600,

    origins: parseOrigins(),

    maxConnections:
      edgeNodeConfig.maxConnections ??
      getEnvNumber('CDN_MAX_CONNECTIONS') ??
      (typeof process !== 'undefined'
        ? parseInt(process.env.CDN_MAX_CONNECTIONS ?? '10000', 10)
        : undefined) ??
      10000,
    requestTimeoutMs:
      edgeNodeConfig.requestTimeoutMs ??
      getEnvNumber('CDN_REQUEST_TIMEOUT_MS') ??
      (typeof process !== 'undefined'
        ? parseInt(process.env.CDN_REQUEST_TIMEOUT_MS ?? '30000', 10)
        : undefined) ??
      30000,

    ipfsGateway: getIpfsGatewayEnv(),
    enableCompression:
      edgeNodeConfig.enableCompression ??
      getEnvBool('CDN_ENABLE_COMPRESSION', true) ??
      (typeof process !== 'undefined'
        ? process.env.CDN_ENABLE_COMPRESSION !== 'false'
        : true),
    enableHTTP2:
      edgeNodeConfig.enableHTTP2 ??
      getEnvBool('CDN_ENABLE_HTTP2', true) ??
      (typeof process !== 'undefined'
        ? process.env.CDN_ENABLE_HTTP2 !== 'false'
        : true),
  }

  const server = new EdgeNodeServer(config)
  server.start()
  return server
}

/**
 * Parse origins from environment
 */
function parseOrigins(): EdgeNodeConfig['origins'] {
  const origins: EdgeNodeConfig['origins'] = []

  // IPFS origin
  const ipfsGateway = getIpfsGatewayEnv()
  if (ipfsGateway) {
    origins.push({
      name: 'ipfs',
      type: 'ipfs',
      endpoint: ipfsGateway,
      timeout: 30000,
      retries: 2,
    })
  }

  // S3 origin
  const s3Bucket =
    edgeNodeConfig.s3Bucket ??
    getEnvVar('S3_BUCKET') ??
    (typeof process !== 'undefined' ? process.env.S3_BUCKET : undefined)
  const s3AccessKeyId =
    edgeNodeConfig.s3AccessKeyId ??
    getEnvVar('AWS_ACCESS_KEY_ID') ??
    (typeof process !== 'undefined' ? process.env.AWS_ACCESS_KEY_ID : undefined)
  if (s3Bucket && s3AccessKeyId) {
    origins.push({
      name: 's3',
      type: 's3',
      endpoint:
        edgeNodeConfig.s3Endpoint ??
        getEnvVar('S3_ENDPOINT') ??
        (typeof process !== 'undefined'
          ? process.env.S3_ENDPOINT
          : undefined) ??
        '',
      bucket: s3Bucket,
      region:
        edgeNodeConfig.s3Region ??
        getEnvVar('AWS_REGION') ??
        (typeof process !== 'undefined' ? process.env.AWS_REGION : undefined) ??
        'us-east-1',
      accessKeyId: s3AccessKeyId,
      secretAccessKey:
        edgeNodeConfig.s3SecretAccessKey ??
        getEnvVar('AWS_SECRET_ACCESS_KEY') ??
        (typeof process !== 'undefined'
          ? process.env.AWS_SECRET_ACCESS_KEY
          : undefined) ??
        '',
      timeout: 10000,
      retries: 2,
    })
  }

  // R2 origin
  const r2Bucket =
    edgeNodeConfig.r2Bucket ??
    getEnvVar('R2_BUCKET') ??
    (typeof process !== 'undefined' ? process.env.R2_BUCKET : undefined)
  const r2AccessKeyId =
    edgeNodeConfig.r2AccessKeyId ??
    getEnvVar('R2_ACCESS_KEY_ID') ??
    (typeof process !== 'undefined' ? process.env.R2_ACCESS_KEY_ID : undefined)
  if (r2Bucket && r2AccessKeyId) {
    origins.push({
      name: 'r2',
      type: 'r2',
      endpoint: '',
      bucket: r2Bucket,
      accountId:
        edgeNodeConfig.r2AccountId ??
        getEnvVar('R2_ACCOUNT_ID') ??
        (typeof process !== 'undefined'
          ? process.env.R2_ACCOUNT_ID
          : undefined),
      accessKeyId: r2AccessKeyId,
      secretAccessKey:
        edgeNodeConfig.r2SecretAccessKey ??
        getEnvVar('R2_SECRET_ACCESS_KEY') ??
        (typeof process !== 'undefined'
          ? process.env.R2_SECRET_ACCESS_KEY
          : undefined) ??
        '',
      timeout: 10000,
      retries: 2,
    })
  }

  // HTTP origin
  const cdnHttpOrigin =
    edgeNodeConfig.cdnHttpOrigin ??
    getEnvVar('CDN_HTTP_ORIGIN') ??
    (typeof process !== 'undefined' ? process.env.CDN_HTTP_ORIGIN : undefined)
  if (cdnHttpOrigin) {
    origins.push({
      name: 'http',
      type: 'http',
      endpoint: cdnHttpOrigin,
      timeout: 10000,
      retries: 2,
    })
  }

  // Vercel origin
  const blobToken =
    edgeNodeConfig.blobReadWriteToken ??
    getEnvVar('BLOB_READ_WRITE_TOKEN') ??
    (typeof process !== 'undefined'
      ? process.env.BLOB_READ_WRITE_TOKEN
      : undefined)
  if (blobToken) {
    origins.push({
      name: 'vercel',
      type: 'vercel',
      endpoint: 'https://blob.vercel-storage.com',
      token: blobToken,
      timeout: 10000,
      retries: 2,
    })
  }

  return origins
}

// CLI entry point
if (import.meta.main) {
  startEdgeNode().catch(console.error)
}
