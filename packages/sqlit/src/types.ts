/**
 * SQLit Types
 *
 * All types for the SQLit distributed database implementation.
 */

import type { Database } from 'bun:sqlite'
import type { Address, Hex } from 'viem'

// ============ Database Types ============

export const DatabaseEncryptionMode = {
  NONE: 'none',
  AT_REST: 'at_rest',
  TEE_ENCRYPTED: 'tee_encrypted',
} as const
export type DatabaseEncryptionMode =
  (typeof DatabaseEncryptionMode)[keyof typeof DatabaseEncryptionMode]

export const DatabaseNodeRole = {
  PRIMARY: 'primary',
  REPLICA: 'replica',
} as const
export type DatabaseNodeRole =
  (typeof DatabaseNodeRole)[keyof typeof DatabaseNodeRole]

export const DatabaseNodeStatus = {
  ACTIVE: 'active',
  SYNCING: 'syncing',
  OFFLINE: 'offline',
  SUSPENDED: 'suspended',
  EXITING: 'exiting',
  PENDING: 'pending',
} as const
export type DatabaseNodeStatus =
  (typeof DatabaseNodeStatus)[keyof typeof DatabaseNodeStatus]

export const DatabaseInstanceStatus = {
  CREATING: 'creating',
  RUNNING: 'running',
  READY: 'ready',
  STOPPED: 'stopped',
  MIGRATING: 'migrating',
  ERROR: 'error',
} as const
export type DatabaseInstanceStatus =
  (typeof DatabaseInstanceStatus)[keyof typeof DatabaseInstanceStatus]

export const DatabaseRegion = {
  US_EAST: 'us-east',
  US_WEST: 'us-west',
  EU_WEST: 'eu-west',
  EU_EAST: 'eu-east',
  ASIA_EAST: 'asia-east',
  ASIA_SOUTH: 'asia-south',
  GLOBAL: 'global',
} as const
export type DatabaseRegion =
  (typeof DatabaseRegion)[keyof typeof DatabaseRegion]

export const TransactionIsolation = {
  READ_UNCOMMITTED: 'read_uncommitted',
  READ_COMMITTED: 'read_committed',
  REPEATABLE_READ: 'repeatable_read',
  SERIALIZABLE: 'serializable',
} as const
export type TransactionIsolation =
  (typeof TransactionIsolation)[keyof typeof TransactionIsolation]

export interface DatabaseNode {
  id: string
  /** Alias for id used in some contexts */
  nodeId: string
  /** Alias for operatorAddress */
  operator?: Address
  operatorAddress: Address
  endpoint: string
  wsEndpoint: string
  region: DatabaseRegion | string
  role: DatabaseNodeRole
  status: DatabaseNodeStatus
  stakedAmount: bigint
  teeEnabled: boolean
  version: string
  registeredAt: number
  lastHeartbeat: number
  /** Number of databases hosted by this node */
  databaseCount: number
  /** Total queries processed */
  totalQueries: bigint
  /** Performance score */
  performanceScore?: number
  /** Slashed amount */
  slashedAmount?: bigint
}

export interface DatabaseInstance {
  id: string
  /** Alias for id used in some contexts */
  databaseId?: string
  name: string
  owner: Address
  primaryNodeId: string
  replicaNodeIds: string[]
  encryptionMode: DatabaseEncryptionMode
  createdAt: number
  updatedAt: number
  sizeBytes: bigint
  rowCount: bigint
  walPosition: bigint
  status: DatabaseInstanceStatus
  replicationConfig: ReplicationConfig
  /** Alias for replicationConfig */
  replication?: ReplicationConfig
  accessControl: ACLRule[]
  /** Connection string for database clients */
  connectionString?: string
  /** HTTP endpoint for REST API */
  httpEndpoint?: string
  /** Schema version number */
  schemaVersion?: number
}

export interface ReplicationConfig {
  replicaCount: number
  minConfirmations: number
  syncMode: 'sync' | 'async'
  readPreference: 'primary' | 'nearest' | 'any'
  failoverTimeout: number
  /** Preferred regions for replicas */
  preferredRegions?: string[]
}

export interface ReplicationStatus {
  nodeId: string
  role: DatabaseNodeRole
  walPosition: bigint
  lag: bigint
  lastSync: number
  syncing: boolean
}

export interface WALEntry {
  position: bigint
  timestamp: number
  sql: string
  params: (string | number | boolean | null)[]
  checksum: Hex
  /** Transaction identifier */
  transactionId?: string
  /** Hash of this entry */
  hash?: Hex
  /** Hash of the previous entry */
  prevHash?: Hex
}

export interface Transaction {
  id: string
  databaseId: string
  isolation: TransactionIsolation
  startedAt: number
  statements: string[]
}

export interface QueryRequest {
  databaseId: string
  sql: string
  params?: (string | number | boolean | null | bigint)[]
  queryType?: 'read' | 'write' | 'ddl'
}

export interface QueryResult {
  success: boolean
  rows: Record<string, unknown>[]
  rowsAffected: number
  lastInsertId: bigint
  executionTimeMs: number
  walPosition?: bigint
  /** Node that processed this query */
  processedByNodeId?: string
}

export interface DatabaseAuditChallenge {
  id: string
  databaseId: string
  challengerNodeId: string
  challengedNodeId: string
  pageIndex: bigint
  expectedHash: Hex
  issuedAt: number
  expiresAt: number
}

export interface DatabaseAuditResponse {
  challengeId: string
  pageData: Uint8Array
  pageHash: Hex
  walPosition: bigint
  respondedAt: number
}

export interface DatabaseBackup {
  id: string
  databaseId: string
  walPosition: bigint
  cid: string
  sizeBytes: bigint
  createdAt: number
  encryptedWith?: string
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
  /** Optional custom database ID. If not provided, one will be generated. */
  databaseId?: string
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
  /** Required WAL position for strong consistency */
  requiredWalPosition?: bigint
}

export interface ExecuteResponse extends QueryResult {
  /** Database ID */
  databaseId: string
  /** Whether query was read-only */
  readOnly: boolean
  /** Node that processed this query */
  processedByNodeId?: string
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

// ============ Constants ============

export const DEFAULT_REPLICATION_CONFIG: ReplicationConfig = {
  replicaCount: 2,
  minConfirmations: 1,
  syncMode: 'async',
  readPreference: 'primary',
  failoverTimeout: 30000,
}

export const HEARTBEAT_INTERVAL_MS = 10000
export const MAX_HEARTBEAT_MISSED = 3
export const MIN_NODE_STAKE_WEI = BigInt('1000000000000000000') // 1 JEJU
export const MIN_BP_STAKE_WEI = BigInt('10000000000000000000') // 10 JEJU
export const AUDIT_CHALLENGE_TIMEOUT_MS = 60000

// ============ TEE Types ============

export type TEEPlatform =
  | 'sgx'
  | 'sev-snp'
  | 'nitro'
  | 'aws-nitro'
  | 'simulated'

export interface TEEAttestation {
  platform: TEEPlatform
  measurement: Hex
  timestamp: number
  signature?: Hex
  publicKey?: Hex
  certificateChain?: string[]
  /** Platform-specific attestation quote */
  quote?: Hex
  /** Whether attestation has been verified */
  verified?: boolean
}

// SQLit Registry ABI (subset for common operations)
export const SQLIT_REGISTRY_ABI = [
  {
    inputs: [
      { name: 'endpoint', type: 'string' },
      { name: 'region', type: 'uint8' },
      { name: 'teeEnabled', type: 'bool' },
    ],
    name: 'registerNode',
    outputs: [],
    stateMutability: 'payable',
    type: 'function',
  },
  {
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    name: 'heartbeat',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
  {
    inputs: [{ name: 'nodeId', type: 'bytes32' }],
    name: 'getNode',
    outputs: [
      {
        components: [
          { name: 'id', type: 'bytes32' },
          { name: 'operator', type: 'address' },
          { name: 'endpoint', type: 'string' },
          { name: 'region', type: 'uint8' },
          { name: 'role', type: 'uint8' },
          { name: 'status', type: 'uint8' },
          { name: 'stakedAmount', type: 'uint256' },
          { name: 'teeEnabled', type: 'bool' },
          { name: 'registeredAt', type: 'uint256' },
          { name: 'lastHeartbeat', type: 'uint256' },
        ],
        name: '',
        type: 'tuple',
      },
    ],
    stateMutability: 'view',
    type: 'function',
  },
  {
    inputs: [
      { name: 'nodeId', type: 'bytes32' },
      { name: 'amount', type: 'uint256' },
    ],
    name: 'slash',
    outputs: [],
    stateMutability: 'nonpayable',
    type: 'function',
  },
] as const
