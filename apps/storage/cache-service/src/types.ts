/**
 * Cache Service Types
 *
 * Types for the decentralized Redis cache service.
 */

import type { Address, Hex } from 'viem';

// ============================================================================
// Cache Types
// ============================================================================

export interface CacheEntry<T = string> {
  key: string;
  value: T;
  ttl: number | null;
  createdAt: number;
  expiresAt: number | null;
  namespace: string;
}

export interface CacheSetRequest {
  key: string;
  value: string;
  ttl?: number; // Seconds
  namespace?: string;
}

export interface CacheGetRequest {
  key: string;
  namespace?: string;
}

export interface CacheDeleteRequest {
  key: string;
  namespace?: string;
}

export interface CacheBatchSetRequest {
  entries: Array<{
    key: string;
    value: string;
    ttl?: number;
  }>;
  namespace?: string;
}

export interface CacheBatchGetRequest {
  keys: string[];
  namespace?: string;
}

// ============================================================================
// Rental Types
// ============================================================================

export interface CacheInstance {
  id: string;
  owner: Address;
  namespace: string;
  maxMemoryMb: number;
  usedMemoryMb: number;
  keyCount: number;
  createdAt: number;
  expiresAt: number;
  status: CacheStatus;
  teeInfo: TEEInfo | null;
}

export type CacheStatus = 'creating' | 'running' | 'stopped' | 'expired' | 'error';

export interface TEEInfo {
  provider: 'phala' | 'marlin' | 'oasis';
  enclaveId: string;
  attestation: Hex;
  verifiedAt: number;
}

export interface CacheRentalPlan {
  id: string;
  name: string;
  maxMemoryMb: number;
  maxKeys: number;
  pricePerHour: bigint;
  pricePerMonth: bigint;
  paymentToken: Address;
  teeRequired: boolean;
}

export interface CreateCacheRequest {
  planId: string;
  namespace?: string;
  paymentToken?: Address;
  durationHours?: number;
}

export interface ExtendCacheRequest {
  instanceId: string;
  durationHours: number;
}

// ============================================================================
// Stats Types
// ============================================================================

export interface CacheStats {
  totalInstances: number;
  activeInstances: number;
  totalMemoryMb: number;
  usedMemoryMb: number;
  totalKeys: number;
  hits: number;
  misses: number;
  hitRate: number;
}

export interface InstanceStats {
  instanceId: string;
  keyCount: number;
  memoryUsedMb: number;
  hits: number;
  misses: number;
  hitRate: number;
  avgLatencyMs: number;
  lastAccess: number;
}

// ============================================================================
// Config Types
// ============================================================================

export interface CacheServiceConfig {
  port: number;
  defaultTtlSeconds: number;
  maxMemoryMb: number;
  teeProvider?: 'phala' | 'marlin' | 'oasis';
  teeEndpoint?: string;
  teeApiKey?: string;
  persistToIpfs?: boolean;
  ipfsEndpoint?: string;
}

// ============================================================================
// Events
// ============================================================================

export interface CacheEvent {
  type: 'set' | 'get' | 'delete' | 'expire' | 'evict';
  key: string;
  namespace: string;
  timestamp: number;
  hitOrMiss?: 'hit' | 'miss';
}

