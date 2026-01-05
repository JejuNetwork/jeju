/**
 * SQLit v2 Internal Types
 *
 * Types specific to the SQLit v2 implementation, extending the shared types.
 */

import type { Database } from 'bun:sqlite'
import type {
  DatabaseAuditChallenge,
  DatabaseAuditResponse,
  DatabaseBackup,
  DatabaseEncryptionMode,
  DatabaseInstance,
  DatabaseInstanceStatus,
  DatabaseNode,
  DatabaseNodeRole,
  DatabaseNodeStatus,
  DatabaseRegion,
  QueryRequest,
  QueryResult,
  ReplicationConfig,
  ReplicationStatus,
  Transaction,
  TransactionIsolation,
  WALEntry,
} from '@jejunetwork/types'
import type { Address, Hex } from 'viem'

// Re-export for convenience
export type {
  DatabaseAuditChallenge,
  DatabaseAuditResponse,
  DatabaseBackup,
  DatabaseEncryptionMode,
  DatabaseInstance,
  DatabaseInstanceStatus,
  DatabaseNode,
  DatabaseNodeRole,
  DatabaseNodeStatus,
  DatabaseRegion,
  QueryRequest,
  QueryResult,
  ReplicationConfig,
  ReplicationStatus,
  Transaction,
  TransactionIsolation,
  WALEntry,
}

// ============ Configuration Types ============

export interface SQLitNodeConfig {
  /** Node operator private key for signing */
  operatorPrivateKey: Hex
  /** RPC endpoint to expose */
  endpoint: string
  /** WebSocket endpoint for replication */
  wsEndpoint: string
  /** Data directory for databases */
  dataDir: string
  /** Geographic region */
  region: DatabaseRegion
  /** Whether to enable TEE mode */
  teeEnabled: boolean
  /** Jeju L2 RPC URL */
  l2RpcUrl: string
  /** SQLit Registry contract address */
  registryAddress: Address
  /** Node software version */
  version: string
}

export interface SQLitServiceConfig {
  /** Staking token amount */
  stakeAmount: bigint
  /** Default replication config */
  defaultReplication: ReplicationConfig
  /** KMS endpoint for encryption keys */
  kmsEndpoint?: string
  /** Heartbeat interval in milliseconds */
  heartbeatIntervalMs: number
  /** Max databases per node */
  maxDatabasesPerNode: number
  /** Enable WAL archiving to DWS */
  enableWalArchiving: boolean
  /** DWS endpoint for backups */
  dwsEndpoint?: string
}

// ============ Internal State Types ============

export interface DatabaseState {
  /** SQLite database handle */
  db: Database
  /** Database instance info */
  instance: DatabaseInstance
  /** Current WAL position */
  walPosition: bigint
  /** In-memory WAL buffer for replication */
  walBuffer: WALEntry[]
  /** Active transactions */
  activeTransactions: Map<string, Transaction>
  /** Replication status per replica */
  replicaStatus: Map<string, ReplicationStatus>
  /** Last checkpoint timestamp */
  lastCheckpoint: number
  /** Schema hash for consistency */
  schemaHash: Hex
}

export interface NodeState {
  /** Node info */
  node: DatabaseNode
  /** Hosted databases */
  databases: Map<string, DatabaseState>
  /** Pending audit challenges */
  pendingChallenges: Map<string, DatabaseAuditChallenge>
  /** Connection pool to other nodes */
  peerConnections: Map<string, PeerConnection>
  /** Is node running */
  running: boolean
}

export interface PeerConnection {
  nodeId: string
  endpoint: string
  wsEndpoint: string
  lastPing: number
  latencyMs: number
  connected: boolean
  role: DatabaseNodeRole
}

// ============ Protocol Types ============

export interface WALSyncRequest {
  databaseId: string
  fromPosition: bigint
  toPosition?: bigint
  limit: number
}

export interface WALSyncResponse {
  entries: WALEntry[]
  hasMore: boolean
  currentPosition: bigint
}

export interface PromoteRequest {
  databaseId: string
  newPrimaryNodeId: string
  reason: 'failover' | 'rebalance' | 'upgrade'
  signature: Hex
}

export interface SnapshotRequest {
  databaseId: string
  walPosition: bigint
  includeIndexes: boolean
}

export interface SnapshotResponse {
  databaseId: string
  walPosition: bigint
  snapshotCid: string
  sizeBytes: bigint
  checksum: Hex
}

// ============ API Types ============

export interface CreateDatabaseRequest {
  name: string
  encryptionMode: DatabaseEncryptionMode
  replication: Partial<ReplicationConfig>
  schema?: string
}

export interface CreateDatabaseResponse {
  databaseId: string
  connectionString: string
  httpEndpoint: string
  primaryNodeId: string
  replicaNodeIds: string[]
}

export interface ExecuteRequest extends QueryRequest {
  /** Signature for authenticated queries */
  signature?: Hex
  /** Timestamp for replay protection */
  timestamp?: number
}

export interface ExecuteResponse extends QueryResult {
  /** Database ID */
  databaseId: string
  /** Whether query was read-only */
  readOnly: boolean
}

export interface BatchExecuteRequest {
  databaseId: string
  queries: Array<{
    sql: string
    params?: (string | number | boolean | null | bigint)[]
  }>
  transactional: boolean
}

export interface BatchExecuteResponse {
  results: QueryResult[]
  totalExecutionTimeMs: number
  walPosition: bigint
}

// ============ Vector Types ============

export type VectorType = 'float32' | 'int8' | 'bit'
export type VectorDistanceMetric = 'l2' | 'cosine' | 'l1'

export interface VectorMetadataColumn {
  name: string
  type: 'TEXT' | 'INTEGER' | 'REAL' | 'BLOB'
}

export interface VectorIndexConfig {
  tableName: string
  dimensions: number
  vectorType?: VectorType
  distanceMetric?: VectorDistanceMetric
  metadataColumns?: VectorMetadataColumn[]
  partitionKey?: string
}

export interface VectorInsertRequest {
  tableName: string
  rowid?: number
  vector: number[]
  metadata?: Record<string, string | number | boolean | null>
  partitionValue?: string | number
}

export interface VectorBatchInsertRequest {
  tableName: string
  vectors: Array<{
    rowid?: number
    vector: number[]
    metadata?: Record<string, string | number | boolean | null>
    partitionValue?: string | number
  }>
}

export interface VectorSearchRequest {
  tableName: string
  vector: number[]
  k: number
  partitionValue?: string | number
  metadataFilter?: string
  includeMetadata?: boolean
}

export interface VectorSearchResult {
  rowid: number
  distance: number
  metadata?: Record<string, string | number | boolean | null>
}

// ============ ACL Types ============

export type ACLPermission = 'read' | 'write' | 'admin'

export interface ACLRule {
  grantee: `0x${string}`
  permissions: ACLPermission[]
  grantedAt: number
  expiresAt?: number
}

export interface GrantRequest {
  grantee: `0x${string}`
  permissions: ACLPermission[]
  expiresAt?: number
}

export interface RevokeRequest {
  grantee: `0x${string}`
  permissions?: ACLPermission[]
}

// ============ Event Types ============

export type SQLitEventType =
  | 'node:registered'
  | 'node:heartbeat'
  | 'node:offline'
  | 'node:slashed'
  | 'database:created'
  | 'database:deleted'
  | 'database:failover'
  | 'replication:synced'
  | 'replication:lagging'
  | 'audit:challenge'
  | 'audit:response'
  | 'audit:failed'

export interface SQLitEvent {
  type: SQLitEventType
  timestamp: number
  nodeId?: string
  databaseId?: string
  data: Record<string, unknown>
}

export type SQLitEventHandler = (event: SQLitEvent) => void | Promise<void>

// ============ Error Types ============

export class SQLitError extends Error {
  constructor(
    message: string,
    public code: string,
    public details?: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'SQLitError'
  }
}

export const SQLitErrorCode = {
  NODE_NOT_FOUND: 'NODE_NOT_FOUND',
  NODE_NOT_ACTIVE: 'NODE_NOT_ACTIVE',
  DATABASE_NOT_FOUND: 'DATABASE_NOT_FOUND',
  DATABASE_UNAVAILABLE: 'DATABASE_UNAVAILABLE',
  INSUFFICIENT_STAKE: 'INSUFFICIENT_STAKE',
  REPLICATION_LAG: 'REPLICATION_LAG',
  QUERY_TIMEOUT: 'QUERY_TIMEOUT',
  TRANSACTION_CONFLICT: 'TRANSACTION_CONFLICT',
  AUDIT_FAILED: 'AUDIT_FAILED',
  TEE_REQUIRED: 'TEE_REQUIRED',
  ENCRYPTION_ERROR: 'ENCRYPTION_ERROR',
  UNAUTHORIZED: 'UNAUTHORIZED',
  RATE_LIMITED: 'RATE_LIMITED',
} as const
export type SQLitErrorCode =
  (typeof SQLitErrorCode)[keyof typeof SQLitErrorCode]
