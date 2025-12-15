/**
 * CDN Types
 * Types used by the CDN edge node and services
 */

import type { Address } from 'viem';
import type {
  CDNRegion,
  CDNProviderType,
  CacheStatus,
  CacheRule,
  CacheTTLConfig,
  ContentMetadata,
  GeoLocation,
  CDNRequest,
  CDNResponse,
  EdgeNodeStatus,
} from '@jejunetwork/types';

// Re-export common types
export type {
  CDNRegion,
  CDNProviderType,
  CacheStatus,
  CacheRule,
  CacheTTLConfig,
  ContentMetadata,
  GeoLocation,
  CDNRequest,
  CDNResponse,
  EdgeNodeStatus,
};

// ============================================================================
// Edge Node Config
// ============================================================================

export interface EdgeNodeConfig {
  nodeId: string;
  privateKey: string;
  endpoint: string;
  port: number;
  region: CDNRegion;
  registryAddress: Address;
  billingAddress: Address;
  rpcUrl: string;
  
  // Cache settings
  maxCacheSizeMB: number;
  maxCacheEntries: number;
  defaultTTL: number;
  
  // Origin settings
  origins: OriginConfig[];
  
  // Networking
  maxConnections: number;
  requestTimeoutMs: number;
  
  // Optional
  ipfsGateway?: string;
  metricsPort?: number;
  enableCompression?: boolean;
  enableHTTP2?: boolean;
}

export interface OriginConfig {
  name: string;
  type: 'ipfs' | 's3' | 'http' | 'r2' | 'arweave' | 'vercel';
  endpoint: string;
  bucket?: string;
  region?: string;
  accessKeyId?: string;
  secretAccessKey?: string;
  accountId?: string;
  token?: string;
  timeout: number;
  retries: number;
  headers?: Record<string, string>;
}

// ============================================================================
// Cache Types
// ============================================================================

export interface CacheEntry {
  key: string;
  data: Buffer;
  metadata: CacheEntryMetadata;
  expiresAt: number;
  createdAt: number;
  accessCount: number;
  lastAccessed: number;
}

export interface CacheEntryMetadata {
  contentType: string;
  contentLength: number;
  contentHash: string;
  etag: string;
  lastModified?: number;
  cacheControl?: string;
  encoding?: 'gzip' | 'br' | 'identity';
  headers: Record<string, string>;
  origin: string;
  immutable: boolean;
}

export interface CacheStats {
  entries: number;
  sizeBytes: number;
  maxSizeBytes: number;
  hitCount: number;
  missCount: number;
  hitRate: number;
  evictionCount: number;
  avgEntrySize: number;
  oldestEntry: number;
  newestEntry: number;
}

export interface CacheKey {
  path: string;
  query?: string;
  varyHeaders?: Record<string, string>;
}

// ============================================================================
// Request/Response Types
// ============================================================================

export interface IncomingRequest {
  id: string;
  method: string;
  url: string;
  path: string;
  query: Record<string, string>;
  headers: Record<string, string>;
  body?: Buffer;
  clientIp: string;
  clientGeo?: GeoLocation;
  timestamp: number;
}

export interface OutgoingResponse {
  id: string;
  status: number;
  headers: Record<string, string>;
  body: Buffer | ReadableStream<Uint8Array>;
  cacheStatus: CacheStatus;
  servedBy: string;
  latencyMs: number;
  originLatencyMs?: number;
  bytesTransferred: number;
}

// ============================================================================
// Origin Fetch Types
// ============================================================================

export interface OriginFetchResult {
  success: boolean;
  status: number;
  headers: Record<string, string>;
  body: Buffer;
  latencyMs: number;
  origin: string;
  error?: string;
}

export interface OriginHealthCheck {
  origin: string;
  healthy: boolean;
  latencyMs: number;
  lastCheck: number;
  consecutiveFailures: number;
}

// ============================================================================
// Metrics Types
// ============================================================================

export interface EdgeNodeMetrics {
  nodeId: string;
  region: CDNRegion;
  uptime: number;
  
  // Traffic
  requestsTotal: number;
  requestsPerSecond: number;
  bytesServedTotal: number;
  bandwidthMbps: number;
  
  // Cache
  cacheHits: number;
  cacheMisses: number;
  cacheHitRate: number;
  cacheSizeBytes: number;
  cacheEntries: number;
  
  // Latency
  avgLatencyMs: number;
  p50LatencyMs: number;
  p95LatencyMs: number;
  p99LatencyMs: number;
  
  // Errors
  errorCount: number;
  errorRate: number;
  
  // System
  currentLoad: number;
  cpuUsage: number;
  memoryUsage: number;
  activeConnections: number;
  
  // Status
  status: EdgeNodeStatus;
  lastUpdated: number;
}

export interface RequestMetrics {
  requestId: string;
  path: string;
  method: string;
  status: number;
  cacheStatus: CacheStatus;
  latencyMs: number;
  originLatencyMs?: number;
  bytesServed: number;
  clientIp: string;
  clientCountry?: string;
  timestamp: number;
}

// ============================================================================
// Provider Types
// ============================================================================

export interface CDNProviderAdapter {
  name: string;
  type: CDNProviderType;
  
  fetch(url: string, options?: FetchOptions): Promise<OriginFetchResult>;
  purge(paths: string[]): Promise<PurgeResult>;
  warmup(urls: string[]): Promise<WarmupResult>;
  
  isHealthy(): Promise<boolean>;
  getMetrics(): Promise<ProviderMetrics>;
  
  getRegions?(): CDNRegion[];
  estimateCost?(bytesEgress: number, requests: number): number;
}

export interface FetchOptions {
  method?: string;
  headers?: Record<string, string>;
  body?: Buffer;
  timeout?: number;
  followRedirects?: boolean;
  decompress?: boolean;
}

export interface PurgeResult {
  success: boolean;
  pathsPurged: number;
  error?: string;
}

export interface WarmupResult {
  success: boolean;
  urlsWarmed: number;
  bytesWarmed: number;
  errors?: Array<{ url: string; error: string }>;
}

export interface ProviderMetrics {
  totalRequests: number;
  totalBytes: number;
  avgLatency: number;
  errorRate: number;
  cacheHitRate: number;
}

// ============================================================================
// Routing Types
// ============================================================================

export interface RoutingDecision {
  nodeId: string;
  endpoint: string;
  region: CDNRegion;
  score: number;
  latencyEstimate: number;
  loadScore: number;
  healthScore: number;
}

export interface RouteRequest {
  clientIp: string;
  clientGeo?: GeoLocation;
  path: string;
  preferredRegion?: CDNRegion;
}

// ============================================================================
// Coordinator Types
// ============================================================================

export interface CoordinatorConfig {
  port: number;
  registryAddress: Address;
  billingAddress: Address;
  rpcUrl: string;
  
  healthCheckInterval: number;
  maxNodesPerRegion: number;
  
  settlementInterval: number;
  minSettlementAmount: number;
}

export interface ConnectedEdgeNode {
  nodeId: string;
  address: Address;
  endpoint: string;
  region: CDNRegion;
  metrics: EdgeNodeMetrics;
  lastSeen: number;
  connectionId: string;
}

// ============================================================================
// Invalidation Types
// ============================================================================

export interface InvalidationRequest {
  requestId: string;
  siteId?: string;
  paths: string[];
  regions?: CDNRegion[];
  priority: 'low' | 'normal' | 'high' | 'urgent';
  requestedBy: Address;
  timestamp: number;
}

export interface InvalidationProgress {
  requestId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  nodesTotal: number;
  nodesProcessed: number;
  pathsInvalidated: number;
  startedAt: number;
  completedAt?: number;
  errors: Array<{ nodeId: string; error: string }>;
}

// ============================================================================
// Usage/Billing Types
// ============================================================================

export interface UsageReport {
  nodeId: string;
  periodStart: number;
  periodEnd: number;
  bytesEgress: number;
  bytesIngress: number;
  requests: number;
  cacheHits: number;
  cacheMisses: number;
  uniqueIps: number;
  bandwidth95th: number;
}

export interface BillingEstimate {
  bytesEgress: number;
  requests: number;
  storage: number;
  egressCost: bigint;
  requestsCost: bigint;
  storageCost: bigint;
  totalCost: bigint;
  currency: 'ETH' | 'USDC';
}

