/**
 * Shared types for dapp-services
 */

import type { Address, Hex } from 'viem'

export interface ServiceHealth {
  name: string
  status: 'healthy' | 'degraded' | 'unhealthy'
  latency?: number
  details?: string
}

export interface AppManifest {
  name: string
  displayName?: string
  version: string
  description?: string
  type?: 'core' | 'vendor' | 'app'
  ports?: Record<string, number>
  jns?: {
    name: string
    description?: string
    url?: string
  }
  agent?: {
    enabled: boolean
    a2aEndpoint?: string
    mcpEndpoint?: string
    tags?: string[]
  }
  services?: {
    database?: DatabaseServiceConfig
    cache?: CacheServiceConfig
    storage?: StorageServiceConfig
    secrets?: SecretsServiceConfig
    triggers?: TriggersServiceConfig
  }
}

export interface DatabaseServiceConfig {
  type: 'eqlite'
  databaseId?: string
  tables?: string[]
}

export interface CacheServiceConfig {
  type: 'compute-redis'
  ttl?: number
}

export interface StorageServiceConfig {
  type: 'ipfs'
  tier?: 'hot' | 'warm' | 'cold' | 'permanent'
}

export interface SecretsServiceConfig {
  type: 'kms'
  provider?: 'mpc' | 'tee'
  keys?: string[]
}

export interface TriggersServiceConfig {
  type: 'cron'
  jobs?: string[]
}

export interface AuthHeaders {
  'Content-Type': string
  'x-jeju-address': string
  'x-jeju-timestamp': string
  'x-jeju-signature': string
}

export type { Address, Hex }
