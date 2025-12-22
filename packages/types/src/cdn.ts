/**
 * CDN (Content Delivery Network) Types
 *
 * Types for the decentralized CDN marketplace supporting:
 * - Edge node registration and discovery
 * - Static asset caching and delivery
 * - API response caching
 * - Geo-based routing
 * - Hybrid cloud/decentralized providers
 */

import { z } from 'zod'

// ============================================================================
// Region and Geography
// ============================================================================

export const CDNRegionSchema = z.enum([
  'us-east-1',
  'us-east-2',
  'us-west-1',
  'us-west-2',
  'eu-west-1',
  'eu-west-2',
  'eu-central-1',
  'ap-northeast-1',
  'ap-northeast-2',
  'ap-southeast-1',
  'ap-southeast-2',
  'ap-south-1',
  'sa-east-1',
  'af-south-1',
  'me-south-1',
  'global', // For anycast/global providers
])
export type CDNRegion = z.infer<typeof CDNRegionSchema>

export interface GeoLocation {
  latitude: number
  longitude: number
  city?: string
  country: string
  countryCode: string
  region?: string
  timezone?: string
}

export interface RegionMapping {
  region: CDNRegion
  countries: string[] // ISO country codes
  latencyTarget: number // Target latency in ms
}

// ============================================================================
// Provider Types
// ============================================================================

export const CDNProviderTypeSchema = z.enum([
  'decentralized', // Permissionless node operators
  'cloudfront', // AWS CloudFront
  'cloudflare', // Cloudflare CDN
  'fastly', // Fastly CDN
  'fleek', // Fleek Network (decentralized)
  'pipe', // Pipe Network (Solana-based)
  'aioz', // AIOZ W3IPFS
  'ipfs-gateway', // Direct IPFS gateway
  'residential', // Residential proxy/edge nodes
])
export type CDNProviderType = z.infer<typeof CDNProviderTypeSchema>

export interface CDNProvider {
  address: string
  name: string
  providerType: CDNProviderType
  endpoint: string
  regions: CDNRegion[]
  stake: bigint
  registeredAt: number
  agentId: number // ERC-8004 agent ID
  active: boolean
  verified: boolean
}

export interface CDNProviderCapabilities {
  maxBandwidthMbps: number
  maxStorageGB: number
  supportsSSL: boolean
  supportsHTTP2: boolean
  supportsHTTP3: boolean
  supportsBrotli: boolean
  supportsGzip: boolean
  supportsWebP: boolean
  supportsAVIF: boolean
  supportsRangeRequests: boolean
  supportsConditionalRequests: boolean
  apiCaching: boolean
  edgeCompute: boolean
  ddosProtection: boolean
  wafEnabled: boolean
}

export interface CDNProviderPricing {
  pricePerGBEgress: bigint // Price per GB transferred
  pricePerMillionRequests: bigint // Price per 1M requests
  pricePerGBStorage: bigint // Price per GB cached/stored
  minimumCommitmentUSD: number // Minimum monthly commitment
  freeEgressGB: number // Free tier egress
  freeRequestsM: number // Free tier requests (millions)
}

export interface CDNProviderMetrics {
  totalBytesServed: bigint
  totalRequests: bigint
  cacheHitRate: number // 0-100
  avgLatencyMs: number
  p99LatencyMs: number
  uptime: number // 0-100
  errorRate: number // 0-100
  activeConnections: number
  lastHealthCheck: number
}

export interface CDNProviderInfo {
  provider: CDNProvider
  capabilities: CDNProviderCapabilities
  pricing: CDNProviderPricing
  metrics: CDNProviderMetrics
  healthScore: number // 0-100 composite score
  reputationScore: number // 0-100 from reputation system
}

// ============================================================================
// Content Types
// ============================================================================

export const ContentTypeSchema = z.enum([
  'static', // HTML, JS, CSS, fonts
  'image', // Images (png, jpg, webp, avif, svg)
  'video', // Video files
  'audio', // Audio files
  'document', // PDFs, docs
  'api', // API responses
  'manifest', // App manifests, service workers
  'wasm', // WebAssembly modules
  'other', // Other binary content
])
export type ContentType = z.infer<typeof ContentTypeSchema>

export interface ContentMetadata {
  cid?: string // IPFS CID if from IPFS
  contentHash: string // SHA-256 hash for verification
  contentType: ContentType
  mimeType: string
  size: number // bytes
  encoding?: 'gzip' | 'br' | 'deflate' | 'identity'
  etag: string
  lastModified: number // timestamp
  cacheControl: string
  immutable: boolean // Content-addressed, never changes
}

// ============================================================================
// Cache Configuration (Vercel-style defaults)
// ============================================================================

export const CacheStrategySchema = z.enum([
  'immutable', // Static assets with hash in filename (1 year)
  'static', // Static HTML (5 minutes, revalidate)
  'dynamic', // API responses (vary by request)
  'streaming', // No cache, pass-through
  'stale-revalidate', // Serve stale while revalidating
])
export type CacheStrategy = z.infer<typeof CacheStrategySchema>

export interface CacheTTLConfig {
  /** Static assets with content hash (js, css, images) - immutable */
  immutableAssets: number // 31536000 (1 year)
  /** HTML files */
  html: number // 0 (must-revalidate)
  /** API responses default */
  api: number // 60 (1 minute)
  /** Fonts */
  fonts: number // 31536000 (1 year)
  /** Images without hash */
  images: number // 86400 (1 day)
  /** JSON/XML data */
  data: number // 300 (5 minutes)
  /** Service worker */
  serviceWorker: number // 0 (always check)
  /** Manifest */
  manifest: number // 86400 (1 day)
}

export const DEFAULT_TTL_CONFIG: CacheTTLConfig = {
  immutableAssets: 31536000, // 1 year
  html: 0, // must-revalidate
  api: 60, // 1 minute
  fonts: 31536000, // 1 year
  images: 86400, // 1 day
  data: 300, // 5 minutes
  serviceWorker: 0, // always check
  manifest: 86400, // 1 day
}

export interface CacheRule {
  pattern: string // glob pattern
  strategy: CacheStrategy
  ttl: number // seconds
  staleWhileRevalidate?: number // seconds
  staleIfError?: number // seconds
  varyHeaders?: string[] // Headers to vary cache by
  bypassCookie?: string // Cookie that bypasses cache
  tags?: string[] // Cache tags for invalidation
}

export interface CacheConfig {
  enabled: boolean
  defaultTTL: number
  maxAge: number
  staleWhileRevalidate: number
  staleIfError: number
  rules: CacheRule[]
  ttlConfig: CacheTTLConfig
  respectOriginHeaders: boolean
  cachePrivate: boolean // Cache responses with private directive
  cacheAuthenticated: boolean // Cache authenticated requests
}

export const DEFAULT_CACHE_RULES: CacheRule[] = [
  // Immutable assets (Vite, Elysia static, etc.)
  { pattern: '/assets/**', strategy: 'immutable', ttl: 31536000 },
  { pattern: '/**/*.{js,css}', strategy: 'immutable', ttl: 31536000 },

  // Fonts
  {
    pattern: '/**/*.{woff,woff2,ttf,otf,eot}',
    strategy: 'immutable',
    ttl: 31536000,
  },

  // Images with hash
  {
    pattern: '/**/*.[a-f0-9]{8}.{png,jpg,jpeg,gif,webp,avif,svg}',
    strategy: 'immutable',
    ttl: 31536000,
  },

  // Images without hash
  {
    pattern: '/**/*.{png,jpg,jpeg,gif,webp,avif,svg,ico}',
    strategy: 'static',
    ttl: 86400,
    staleWhileRevalidate: 3600,
  },

  // HTML
  {
    pattern: '/**/*.html',
    strategy: 'stale-revalidate',
    ttl: 0,
    staleWhileRevalidate: 60,
  },
  {
    pattern: '/',
    strategy: 'stale-revalidate',
    ttl: 0,
    staleWhileRevalidate: 60,
  },

  // API routes (default, can be overridden)
  {
    pattern: '/api/**',
    strategy: 'dynamic',
    ttl: 60,
    varyHeaders: ['Authorization', 'Accept'],
  },

  // Service worker
  { pattern: '/sw.js', strategy: 'dynamic', ttl: 0 },
  { pattern: '/service-worker.js', strategy: 'dynamic', ttl: 0 },

  // Manifest
  { pattern: '/manifest.json', strategy: 'static', ttl: 86400 },
  { pattern: '/site.webmanifest', strategy: 'static', ttl: 86400 },
]

// ============================================================================
// Edge Node Types
// ============================================================================

export interface EdgeNode {
  nodeId: string
  address: string // Ethereum address of operator
  endpoint: string // Edge node URL
  region: CDNRegion
  location: GeoLocation
  providerType: CDNProviderType
  capabilities: CDNProviderCapabilities
  status: EdgeNodeStatus
  metrics: EdgeNodeMetrics
  registeredAt: number
  lastSeen: number
  agentId: number // ERC-8004 agent ID
}

export const EdgeNodeStatusSchema = z.enum([
  'healthy',
  'degraded',
  'unhealthy',
  'maintenance',
  'offline',
])
export type EdgeNodeStatus = z.infer<typeof EdgeNodeStatusSchema>

export interface EdgeNodeMetrics {
  currentLoad: number // 0-100
  memoryUsage: number // 0-100
  diskUsage: number // 0-100
  bandwidthUsage: number // Mbps
  activeConnections: number
  requestsPerSecond: number
  bytesServedTotal: bigint
  requestsTotal: bigint
  cacheSize: number // bytes
  cacheEntries: number
  cacheHitRate: number // 0-100
  avgResponseTime: number // ms
  errorRate: number // 0-100
  lastUpdated: number
}

export interface EdgeNodeConfig {
  nodeId: string
  privateKey: string
  endpoint: string
  region: CDNRegion
  registryAddress: string
  rpcUrl: string
  port: number
  maxCacheSize: number // bytes
  maxConnections: number
  origins: OriginConfig[]
  cacheConfig: CacheConfig
  rateLimits: RateLimitConfig
}

// ============================================================================
// Origin Configuration
// ============================================================================

export interface OriginConfig {
  name: string
  type: 'ipfs' | 's3' | 'http' | 'r2' | 'arweave'
  endpoint: string
  region?: CDNRegion
  credentials?: OriginCredentials
  healthCheck: HealthCheckConfig
  timeout: number // ms
  retries: number
  retryDelay: number // ms
  headers?: Record<string, string>
}

export interface OriginCredentials {
  accessKeyId?: string
  secretAccessKey?: string
  accountId?: string // For R2
  token?: string // For Vercel Blob
}

export interface HealthCheckConfig {
  enabled: boolean
  path: string
  interval: number // ms
  timeout: number // ms
  healthyThreshold: number
  unhealthyThreshold: number
}

// ============================================================================
// Request/Response Types
// ============================================================================

export interface CDNRequest {
  requestId: string
  method: string
  url: string
  path: string
  headers: Record<string, string>
  clientIp: string
  clientGeo?: GeoLocation
  timestamp: number
  protocol: 'http' | 'https'
  host: string
}

export interface CDNResponse {
  requestId: string
  status: number
  headers: Record<string, string>
  body?: ArrayBuffer | ReadableStream<Uint8Array>
  cacheStatus: CacheStatus
  servedBy: string // Node ID
  servedFrom: CDNRegion
  latencyMs: number
  bytesTransferred: number
  originLatencyMs?: number
  compressionRatio?: number
}

export const CacheStatusSchema = z.enum([
  'HIT', // Served from edge cache
  'MISS', // Fetched from origin
  'STALE', // Served stale while revalidating
  'BYPASS', // Cache bypassed
  'EXPIRED', // Cache expired, refetched
  'REVALIDATED', // Conditional request, not modified
  'DYNAMIC', // Not cacheable
  'ERROR', // Origin error, served stale if available
])
export type CacheStatus = z.infer<typeof CacheStatusSchema>

// ============================================================================
// Rate Limiting
// ============================================================================

export interface RateLimitConfig {
  enabled: boolean
  requestsPerSecond: number
  requestsPerMinute: number
  burstSize: number
  byIp: boolean
  byUser: boolean // By authenticated user
  byPath: boolean
  customRules: RateLimitRule[]
}

export interface RateLimitRule {
  pattern: string
  limit: number
  window: number // seconds
  keyBy: ('ip' | 'user' | 'path' | 'header')[]
  headerKey?: string
  action: 'block' | 'throttle' | 'log'
}

// ============================================================================
// Cache Invalidation
// ============================================================================

export interface InvalidationRequest {
  requestId: string
  type: 'path' | 'prefix' | 'tag' | 'all'
  targets: string[] // Paths, prefixes, or tags
  origin?: string // Specific origin
  regions?: CDNRegion[] // Specific regions or all
  requestedBy: string // Address that requested invalidation
  requestedAt: number
  priority: 'low' | 'normal' | 'high' | 'urgent'
}

export interface InvalidationResult {
  requestId: string
  status: 'pending' | 'processing' | 'completed' | 'failed'
  nodesProcessed: number
  nodesTotal: number
  pathsInvalidated: number
  bytesEvicted: bigint
  completedAt?: number
  errors?: InvalidationError[]
}

export interface InvalidationError {
  nodeId: string
  region: CDNRegion
  error: string
  retryable: boolean
}

// ============================================================================
// Warmup/Prefetch
// ============================================================================

export interface WarmupRequest {
  requestId: string
  urls: string[]
  regions: CDNRegion[] // Target regions
  priority: 'low' | 'normal' | 'high'
  requestedBy: string
  requestedAt: number
}

export interface WarmupResult {
  requestId: string
  status: 'pending' | 'processing' | 'completed' | 'partial'
  urlsProcessed: number
  urlsTotal: number
  bytesWarmed: bigint
  regionsWarmed: CDNRegion[]
  completedAt?: number
  errors?: WarmupError[]
}

export interface WarmupError {
  url: string
  region: CDNRegion
  error: string
  statusCode?: number
}

// ============================================================================
// Billing and Metering
// ============================================================================

export interface CDNUsageRecord {
  recordId: string
  nodeId: string
  provider: string
  region: CDNRegion
  timestamp: number
  periodStart: number
  periodEnd: number
  bytesEgress: bigint
  bytesIngress: bigint
  requests: bigint
  cacheHits: bigint
  cacheMisses: bigint
  uniqueVisitors: number
  bandwidth95thPercentile: number // Mbps
  signature: string // Provider signature for verification
}

export interface CDNBillingRecord {
  billingId: string
  user: string // App deployer address
  provider: string // CDN provider address
  periodStart: number
  periodEnd: number
  egressGB: number
  requestsM: number // Millions
  storageGB: number
  egressCost: bigint
  requestsCost: bigint
  storageCost: bigint
  totalCost: bigint
  paid: boolean
  paidAt?: number
  txHash?: string
}

// ============================================================================
// Site/App Configuration
// ============================================================================

export interface CDNSiteConfig {
  siteId: string
  domain: string // Primary domain
  aliases: string[] // Additional domains
  owner: string // Deployer address
  origin: OriginConfig
  cacheConfig: CacheConfig
  rateLimits?: RateLimitConfig
  headers?: HeaderConfig
  redirects?: RedirectRule[]
  rewrites?: RewriteRule[]
  customErrorPages?: ErrorPageConfig
  ssl: SSLConfig
  security: SecurityConfig
  createdAt: number
  updatedAt: number
}

export interface HeaderConfig {
  /** Headers to add to all responses */
  add: Record<string, string>
  /** Headers to remove from responses */
  remove: string[]
  /** Security headers preset */
  securityHeaders: boolean
  /** CORS configuration */
  cors?: CORSConfig
}

export interface CORSConfig {
  enabled: boolean
  origins: string[] // Allowed origins (* for all)
  methods: string[]
  headers: string[]
  credentials: boolean
  maxAge: number
}

export interface RedirectRule {
  source: string
  destination: string
  statusCode: 301 | 302 | 307 | 308
  permanent: boolean
}

export interface RewriteRule {
  source: string
  destination: string
}

export interface ErrorPageConfig {
  '404'?: string // Path to custom 404 page
  '500'?: string
  '503'?: string
}

export interface SSLConfig {
  enabled: boolean
  certificate?: string // Custom certificate
  privateKey?: string // Custom private key
  minVersion: 'TLSv1.2' | 'TLSv1.3'
  hsts: boolean
  hstsMaxAge: number
  hstsIncludeSubdomains: boolean
}

export interface SecurityConfig {
  waf: boolean
  ddosProtection: boolean
  botProtection: boolean
  ipAllowlist?: string[]
  ipBlocklist?: string[]
  geoBlocking?: string[] // Blocked country codes
}

// ============================================================================
// SDK Configuration
// ============================================================================

export interface CDNSDKConfig {
  rpcUrl: string
  privateKey?: string
  contracts: {
    registry: string
    billing: string
  }
  defaultRegion?: CDNRegion
  preferredProviders?: CDNProviderType[]
}

export interface CDNDeployConfig {
  appName: string
  buildDir: string
  origin: OriginConfig
  domain?: string
  jnsName?: string
  cacheConfig?: Partial<CacheConfig>
  regions?: CDNRegion[] // Target regions
  warmup?: boolean // Warmup after deploy
  invalidate?: boolean // Invalidate on deploy
}

// ============================================================================
// Events
// ============================================================================

export interface CDNNodeRegisteredEvent {
  nodeId: string
  operator: string
  region: CDNRegion
  providerType: CDNProviderType
  stake: bigint
  timestamp: number
}

export interface CDNNodeDeactivatedEvent {
  nodeId: string
  operator: string
  reason: string
  timestamp: number
}

export interface CDNInvalidationEvent {
  requestId: string
  siteId: string
  type: string
  targets: string[]
  requestedBy: string
  timestamp: number
}

export interface CDNUsageReportedEvent {
  nodeId: string
  provider: string
  bytesServed: bigint
  requests: bigint
  periodStart: number
  periodEnd: number
  timestamp: number
}

export interface CDNSettlementEvent {
  user: string
  provider: string
  amount: bigint
  period: string
  txHash: string
  timestamp: number
}

// ============================================================================
// Integration Types (External Providers)
// ============================================================================

export interface CloudFrontConfig {
  distributionId: string
  domainName: string
  originId: string
  accessKeyId: string
  secretAccessKey: string
  region: string
}

export interface CloudflareConfig {
  zoneId: string
  accountId: string
  apiToken: string
  r2Bucket?: string
  r2AccessKeyId?: string
  r2SecretAccessKey?: string
}

export interface FleekConfig {
  apiKey: string
  projectId: string
}

export interface PipeNetworkConfig {
  apiKey: string
  networkEndpoint: string
  walletAddress: string
}

export interface AIOZConfig {
  apiKey: string
  endpoint: string
}

// ============================================================================
// API Types
// ============================================================================

export interface CDNDeployRequest {
  siteId?: string // Existing site to update
  domain: string
  origin: OriginConfig
  cacheConfig?: Partial<CacheConfig>
  regions?: CDNRegion[]
}

export interface CDNDeployResponse {
  siteId: string
  domain: string
  cdnDomain: string // CDN endpoint
  status: 'deploying' | 'active' | 'failed'
  deployedAt: number
  warmupStatus?: WarmupResult
}

export interface CDNStatsRequest {
  siteId: string
  startTime: number
  endTime: number
  granularity: 'minute' | 'hour' | 'day'
  metrics: (
    | 'requests'
    | 'bandwidth'
    | 'cache_hit_rate'
    | 'latency'
    | 'errors'
  )[]
  regions?: CDNRegion[]
}

export interface CDNStatsResponse {
  siteId: string
  startTime: number
  endTime: number
  summary: {
    totalRequests: bigint
    totalBandwidth: bigint
    avgCacheHitRate: number
    avgLatency: number
    errorRate: number
  }
  timeSeries: CDNTimeSeriesPoint[]
  byRegion: Record<CDNRegion, CDNRegionStats>
}

export interface CDNTimeSeriesPoint {
  timestamp: number
  requests: number
  bandwidth: number
  cacheHitRate: number
  latencyP50: number
  latencyP99: number
  errorRate: number
}

export interface CDNRegionStats {
  requests: bigint
  bandwidth: bigint
  cacheHitRate: number
  avgLatency: number
  activeNodes: number
}
