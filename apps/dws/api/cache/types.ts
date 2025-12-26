/**
 * Cache Service Types
 *
 * Types for the serverless decentralized cache service.
 * Supports standard, premium, and TEE-backed cache tiers.
 */

import type { Address, Hex } from 'viem'
import { z } from 'zod'

// Zod schemas for internal data structures
export const HashEntrySchema = z.record(z.string(), z.string())
export const SortedSetMemberSchema = z.object({
  member: z.string(),
  score: z.number(),
})
export const StreamEntrySchema = z.object({
  id: z.string(),
  fields: z.record(z.string(), z.string()),
})

// Cache Tiers

export const CacheTier = {
  /** Shared multi-tenant cache - best effort */
  STANDARD: 'standard',
  /** Dedicated single-tenant cache - SLA guarantees */
  PREMIUM: 'premium',
  /** TEE-backed cache in CVM - encrypted memory with attestation */
  TEE: 'tee',
} as const
export type CacheTier = (typeof CacheTier)[keyof typeof CacheTier]

// TEE Providers for cache

export const CacheTEEProvider = {
  PHALA: 'phala',
  INTEL_TDX: 'intel-tdx',
  AMD_SEV: 'amd-sev',
  DSTACK: 'dstack',
  LOCAL: 'local',
} as const
export type CacheTEEProvider =
  (typeof CacheTEEProvider)[keyof typeof CacheTEEProvider]

// Cache Instance Status

export const CacheInstanceStatus = {
  CREATING: 'creating',
  RUNNING: 'running',
  STOPPED: 'stopped',
  EXPIRED: 'expired',
  ERROR: 'error',
} as const
export type CacheInstanceStatus =
  (typeof CacheInstanceStatus)[keyof typeof CacheInstanceStatus]

// Cache Entry

export interface CacheEntry<T = string> {
  value: T
  createdAt: number
  expiresAt: number
  accessCount: number
  lastAccessedAt: number
  sizeBytes: number
}

// Cache Instance

export interface CacheInstance {
  id: string
  owner: Address
  namespace: string
  tier: CacheTier
  maxMemoryMb: number
  usedMemoryMb: number
  keyCount: number
  createdAt: number
  expiresAt: number
  status: CacheInstanceStatus
  teeProvider?: CacheTEEProvider
  teeAttestation?: CacheTEEAttestation
  nodeId?: string
  endpoint?: string
}

// TEE Attestation for cache

export interface CacheTEEAttestation {
  quote: Hex
  mrEnclave: Hex
  mrSigner: Hex
  reportData: Hex
  timestamp: number
  provider: CacheTEEProvider
  simulated: boolean
}

// Cache Plans (for rental/provisioning)

export interface CacheRentalPlan {
  id: string
  name: string
  tier: CacheTier
  maxMemoryMb: number
  maxKeys: number
  maxTtlSeconds: number
  pricePerHour: bigint
  pricePerMonth: bigint
  teeRequired: boolean
  features: string[]
}

// Cache Statistics

export interface CacheStats {
  totalKeys: number
  usedMemoryBytes: number
  maxMemoryBytes: number
  hits: number
  misses: number
  hitRate: number
  evictions: number
  expiredKeys: number
  avgKeySize: number
  avgValueSize: number
  oldestKeyAge: number
  namespaces: number
  uptime: number
}

export interface CacheNamespaceStats {
  namespace: string
  keyCount: number
  usedMemoryBytes: number
  hits: number
  misses: number
  hitRate: number
}

// Cache Node (for distributed cache)

export interface CacheNode {
  nodeId: string
  address: Address
  endpoint: string
  region: string
  tier: CacheTier
  teeProvider?: CacheTEEProvider
  maxMemoryMb: number
  usedMemoryMb: number
  instanceCount: number
  status: 'online' | 'offline' | 'draining'
  lastHeartbeat: number
  attestation?: CacheTEEAttestation
}

// Cache Operations

export interface CacheSetOptions {
  ttl?: number
  nx?: boolean // Only set if not exists
  xx?: boolean // Only set if exists
}

export interface CacheGetOptions {
  withMeta?: boolean
}

export interface CacheScanOptions {
  pattern?: string
  count?: number
  cursor?: string
}

export interface CacheScanResult {
  cursor: string
  keys: string[]
  done: boolean
}

// Hash Operations

export interface HashEntry {
  [field: string]: string
}

// List Operations

export interface ListRange {
  start: number
  stop: number
}

// Sorted Set Operations

export interface SortedSetMember {
  member: string
  score: number
}

// Stream Operations

export interface StreamEntry {
  id: string
  fields: Record<string, string>
}

export interface StreamReadOptions {
  block?: number
  count?: number
}

// Configuration

export interface CacheConfig {
  /** Maximum memory per instance (MB) */
  maxMemoryMb: number
  /** Default TTL (seconds) */
  defaultTtlSeconds: number
  /** Maximum TTL (seconds) */
  maxTtlSeconds: number
  /** Eviction policy (currently only 'lru' is implemented) */
  evictionPolicy: 'lru'
  /** TEE provider for secure tier */
  teeProvider?: CacheTEEProvider
  /** TEE endpoint */
  teeEndpoint?: string
}

export interface CacheServiceConfig extends CacheConfig {
  /** Listen port */
  port: number
  /** CovenantSQL database ID */
  cqlDatabaseId: string
  /** Node discovery via ERC-8004 */
  identityRegistryAddress: Address
  /** RPC URL */
  rpcUrl: string
}

// Events

export const CacheEventType = {
  KEY_SET: 'key_set',
  KEY_GET: 'key_get',
  KEY_DELETE: 'key_delete',
  KEY_EXPIRE: 'key_expire',
  KEY_EVICT: 'key_evict',
  INSTANCE_CREATE: 'instance_create',
  INSTANCE_DELETE: 'instance_delete',
  NODE_JOIN: 'node_join',
  NODE_LEAVE: 'node_leave',
  ATTESTATION_REFRESH: 'attestation_refresh',
} as const
export type CacheEventType =
  (typeof CacheEventType)[keyof typeof CacheEventType]

export interface CacheEvent {
  type: CacheEventType
  timestamp: number
  namespace?: string
  key?: string
  nodeId?: string
  instanceId?: string
  metadata?: Record<string, unknown>
}

export type CacheEventListener = (event: CacheEvent) => void

// Error Types

export const CacheErrorCode = {
  KEY_NOT_FOUND: 'KEY_NOT_FOUND',
  NAMESPACE_NOT_FOUND: 'NAMESPACE_NOT_FOUND',
  INSTANCE_NOT_FOUND: 'INSTANCE_NOT_FOUND',
  QUOTA_EXCEEDED: 'QUOTA_EXCEEDED',
  MEMORY_LIMIT: 'MEMORY_LIMIT',
  TTL_EXCEEDED: 'TTL_EXCEEDED',
  UNAUTHORIZED: 'UNAUTHORIZED',
  ATTESTATION_FAILED: 'ATTESTATION_FAILED',
  NODE_UNAVAILABLE: 'NODE_UNAVAILABLE',
  INVALID_OPERATION: 'INVALID_OPERATION',
} as const
export type CacheErrorCode =
  (typeof CacheErrorCode)[keyof typeof CacheErrorCode]

export class CacheError extends Error {
  constructor(
    public readonly code: CacheErrorCode,
    message: string,
    public readonly details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'CacheError'
  }
}
