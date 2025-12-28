/**
 * @jejunetwork/db - Database Types (EQLite)
 *
 * Types for decentralized SQL database integration.
 * EQLite provides:
 * - BFT-Raft consensus for strong consistency
 * - Column-level ACL for privacy
 * - Multi-tenant database rental
 * - SQL interface compatible with standard ORMs
 */

import type { Address, Hex } from 'viem'

// Consistency Types

/** Query consistency level for EQLite */
export type ConsistencyLevel = 'strong' | 'eventual'

// Connection Types

/**
 * Minimal interface for code that only needs query and exec methods.
 * Use this instead of EQLiteClient when you don't need the full client API.
 * EQLiteClient, EQLiteConnection, and EQLiteTransaction all implement this interface.
 */
export interface EQLiteQueryable {
  /** Execute a read query */
  query<T>(
    sql: string,
    params?: QueryParam[],
    dbId?: string,
  ): Promise<QueryResult<T>>
  /** Execute a write query */
  exec(sql: string, params?: QueryParam[], dbId?: string): Promise<ExecResult>
}

export interface EQLiteConfig {
  /** Block producer endpoint */
  blockProducerEndpoint: string
  /** Miner node endpoint (for direct queries) */
  minerEndpoint?: string
  /** KMS key ID for secure signing (uses threshold signatures via KMS MPC) */
  keyId?: string
  /** Private key for direct signing (alternative to KMS) */
  privateKey?: `0x${string}`
  /** Database ID (hex hash) */
  databaseId?: string
  /** Connection timeout in ms */
  timeout?: number
  /** Enable query logging */
  debug?: boolean
}

export interface EQLiteConnectionPool {
  /** Get a connection from the pool */
  acquire(): Promise<EQLiteConnection>
  /** Release a connection back to the pool */
  release(connection: EQLiteConnection): void
  /** Close all connections */
  close(): Promise<void>
  /** Pool statistics */
  stats(): { active: number; idle: number; total: number }
}

export interface EQLiteConnection {
  /** Connection ID */
  id: string
  /** Database ID */
  databaseId: string
  /** Whether connection is active */
  active: boolean
  /** Execute a query */
  query<T>(sql: string, params?: QueryParam[]): Promise<QueryResult<T>>
  /** Execute a write query */
  exec(sql: string, params?: QueryParam[]): Promise<ExecResult>
  /** Start a transaction */
  beginTransaction(): Promise<EQLiteTransaction>
  /** Close the connection */
  close(): Promise<void>
}

export interface EQLiteTransaction {
  /** Transaction ID */
  id: string
  /** Execute query within transaction */
  query<T>(sql: string, params?: QueryParam[]): Promise<QueryResult<T>>
  /** Execute write within transaction */
  exec(sql: string, params?: QueryParam[]): Promise<ExecResult>
  /** Commit transaction */
  commit(): Promise<void>
  /** Rollback transaction */
  rollback(): Promise<void>
}

// Query Types

export type QueryParam = string | number | boolean | null | Uint8Array | bigint

export interface QueryResult<T> {
  /** Result rows */
  rows: T[]
  /** Number of rows returned */
  rowCount: number
  /** Column metadata */
  columns: ColumnMeta[]
  /** Query execution time in ms */
  executionTime: number
  /** Block height at query time */
  blockHeight: number
}

export interface ExecResult {
  /** Number of rows affected */
  rowsAffected: number
  /** Last insert ID (if applicable) */
  lastInsertId?: bigint
  /** Transaction hash on EQLite chain */
  txHash: Hex
  /** Block height of transaction */
  blockHeight: number
  /** Gas used */
  gasUsed: bigint
}

export interface ColumnMeta {
  name: string
  type: EQLiteDataType
  nullable: boolean
  primaryKey: boolean
  autoIncrement: boolean
}

export type EQLiteDataType =
  | 'INTEGER'
  | 'BIGINT'
  | 'REAL'
  | 'TEXT'
  | 'BLOB'
  | 'BOOLEAN'
  | 'TIMESTAMP'
  | 'JSON'

// Database Management

export interface DatabaseConfig {
  /** Number of miner nodes (minimum 1, default 3) */
  nodeCount: number
  /** Use eventual consistency (faster) or strong consistency (slower, default) */
  useEventualConsistency?: boolean
  /** Geographic regions for miners */
  regions?: string[]
  /** Initial schema SQL */
  schema?: string
  /** Owner address */
  owner: Address
  /** Token to pay with */
  paymentToken?: Address
}

export interface DatabaseInfo {
  /** Database ID (hex hash) */
  id: string
  /** Creation timestamp */
  createdAt: number
  /** Owner address */
  owner: Address
  /** Number of miner nodes */
  nodeCount: number
  /** Consistency mode */
  consistencyMode: 'eventual' | 'strong'
  /** Status */
  status: DatabaseStatus
  /** Current block height */
  blockHeight: number
  /** Total size in bytes */
  sizeBytes: number
  /** Monthly cost in payment token */
  monthlyCost: bigint
}

export type DatabaseStatus =
  | 'creating'
  | 'running'
  | 'stopped'
  | 'migrating'
  | 'error'

// Access Control

export interface ACLRule {
  /** Grantee address or wildcard */
  grantee: Address | '*'
  /** Table name or wildcard */
  table: string | '*'
  /** Column names or wildcard */
  columns: string[] | '*'
  /** Permissions */
  permissions: ACLPermission[]
  /** Condition SQL (WHERE clause) */
  condition?: string
}

export type ACLPermission = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL'

export interface GrantRequest {
  /** Address to grant permissions to */
  grantee: Address
  /** Table to grant permissions on */
  table: string
  /** Specific columns (or all) */
  columns?: string[]
  /** Permissions to grant */
  permissions: ACLPermission[]
  /** Row-level condition */
  condition?: string
}

export interface RevokeRequest {
  /** Address to revoke permissions from */
  grantee: Address
  /** Table to revoke permissions on */
  table: string
  /** Specific columns (or all) */
  columns?: string[]
  /** Permissions to revoke */
  permissions: ACLPermission[]
}

// Rental & Billing

export interface RentalPlan {
  /** Plan ID */
  id: string
  /** Plan name */
  name: string
  /** Number of nodes included */
  nodeCount: number
  /** Storage quota in bytes */
  storageBytes: bigint
  /** Queries per month */
  queriesPerMonth: bigint
  /** Monthly price in payment token */
  pricePerMonth: bigint
  /** Payment token address */
  paymentToken: Address
}

export interface RentalInfo {
  /** Rental ID */
  id: string
  /** Database ID */
  databaseId: string
  /** Renter address */
  renter: Address
  /** Plan ID */
  planId: string
  /** Start timestamp */
  startedAt: number
  /** Expiration timestamp */
  expiresAt: number
  /** Auto-renew enabled */
  autoRenew: boolean
  /** Payment status */
  paymentStatus: 'current' | 'overdue' | 'cancelled'
}

export interface CreateRentalRequest {
  /** Plan to subscribe to */
  planId: string
  /** Initial schema SQL */
  schema?: string
  /** Enable auto-renewal */
  autoRenew?: boolean
  /** Payment token */
  paymentToken?: Address
  /** Prepay months */
  months?: number
}

// Migration Types

export interface Migration {
  /** Migration version */
  version: number
  /** Migration name */
  name: string
  /** Up migration SQL */
  up: string
  /** Down migration SQL */
  down: string
  /** Migration timestamp */
  appliedAt?: number
}

export interface MigrationResult {
  /** Applied migrations */
  applied: string[]
  /** Current version */
  currentVersion: number
  /** Pending migrations */
  pending: string[]
}

// Events

export interface QueryEventDetails {
  sql: string
  params?: QueryParam[]
  rowCount?: number
  executionTime?: number
}

export interface ExecEventDetails {
  sql: string
  params?: QueryParam[]
  rowsAffected?: number
  gasUsed?: bigint
}

export interface MigrationEventDetails {
  version: number
  name: string
  direction: 'up' | 'down'
}

export interface ACLEventDetails {
  grantee: Address
  table: string
  permissions: ACLPermission[]
  action: 'grant' | 'revoke'
}

export interface RentalEventDetails {
  planId: string
  rentalId: string
  action: 'create' | 'extend' | 'cancel'
  months?: number
}

export type EQLiteEventDetails =
  | { type: 'query'; data: QueryEventDetails }
  | { type: 'exec'; data: ExecEventDetails }
  | { type: 'migration'; data: MigrationEventDetails }
  | { type: 'acl'; data: ACLEventDetails }
  | { type: 'rental'; data: RentalEventDetails }

export interface EQLiteEvent {
  type: 'query' | 'exec' | 'migration' | 'acl' | 'rental'
  databaseId: string
  timestamp: number
  actor?: Address
  details: EQLiteEventDetails
  txHash?: Hex
}

// Block Producer Types

export interface BlockProducerInfo {
  /** Current block height */
  blockHeight: number
  /** Active databases */
  databases: number
  /** Status (e.g. 'running', 'active', 'syncing', 'offline') */
  status: string
  /** Block producer address (optional in dev mode) */
  address?: Address
  /** Endpoint URL (optional in dev mode) */
  endpoint?: string
  /** Total stake (optional in dev mode) */
  stake?: bigint
  /** Server type (e.g. 'sqlite', 'sqlite-dev') */
  type?: string
  /** Number of nodes */
  nodeCount?: number
}

export interface MinerInfo {
  /** Miner address */
  address: Address
  /** Database ID */
  databaseId: string
  /** Role (leader or follower) */
  role: 'leader' | 'follower'
  /** Endpoint URL */
  endpoint: string
  /** Block height */
  blockHeight: number
  /** Status */
  status: 'active' | 'syncing' | 'offline'
}

// Vector Search Types (powered by sqlite-vec)

/**
 * Vector data types supported by sqlite-vec
 * - float32: Standard 32-bit floats (4 bytes per element)
 * - int8: Quantized 8-bit integers (1 byte per element)
 * - bit: Binary vectors for hamming distance
 */
export type VectorType = 'float32' | 'int8' | 'bit'

/**
 * Distance metrics for vector similarity search
 * - L2: Euclidean distance (default)
 * - cosine: Cosine similarity (1 - cos_sim)
 * - L1: Manhattan distance
 */
export type VectorDistanceMetric = 'L2' | 'cosine' | 'L1'

/**
 * Configuration for creating a vector index (vec0 virtual table)
 */
export interface VectorIndexConfig {
  /** Name of the vector table */
  tableName: string
  /** Number of dimensions in the embedding */
  dimensions: number
  /** Vector data type (default: float32) */
  vectorType?: VectorType
  /** Distance metric (default: L2) */
  distanceMetric?: VectorDistanceMetric
  /** Metadata columns to include (prefixed with + in vec0) */
  metadataColumns?: VectorMetadataColumn[]
  /** Partition key column for filtering */
  partitionKey?: string
}

/**
 * Metadata column definition for vec0 tables
 */
export interface VectorMetadataColumn {
  /** Column name */
  name: string
  /** SQLite data type */
  type: 'TEXT' | 'INTEGER' | 'REAL' | 'BLOB'
  /** Is this column nullable */
  nullable?: boolean
}

/**
 * Request for vector similarity search (KNN)
 */
export interface VectorSearchRequest {
  /** Name of the vector table */
  tableName: string
  /** Query vector (will be serialized to BLOB) */
  vector: number[]
  /** Number of nearest neighbors to return */
  k: number
  /** Filter by partition key value */
  partitionValue?: string | number
  /** Additional WHERE clause for metadata filtering */
  metadataFilter?: string
  /** Include metadata columns in results */
  includeMetadata?: boolean
}

/**
 * Result from vector similarity search
 */
export interface VectorSearchResult {
  /** Row ID of the matched vector */
  rowid: number
  /** Distance from query vector */
  distance: number
  /** Metadata values (if includeMetadata was true) */
  metadata?: Record<string, string | number | boolean | null>
}

/**
 * Request to insert a vector
 */
export interface VectorInsertRequest {
  /** Name of the vector table */
  tableName: string
  /** Row ID (optional, auto-generated if not provided) */
  rowid?: number
  /** Vector embedding */
  vector: number[]
  /** Metadata values */
  metadata?: Record<string, string | number | boolean | null>
  /** Partition key value */
  partitionValue?: string | number
}

/**
 * Batch insert request for vectors
 */
export interface VectorBatchInsertRequest {
  /** Name of the vector table */
  tableName: string
  /** Vectors to insert */
  vectors: Array<{
    rowid?: number
    vector: number[]
    metadata?: Record<string, string | number | boolean | null>
    partitionValue?: string | number
  }>
}

/**
 * Vector index info returned by vec0
 */
export interface VectorIndexInfo {
  /** Table name */
  tableName: string
  /** Number of vectors stored */
  vectorCount: number
  /** Dimensions of vectors */
  dimensions: number
  /** Vector type */
  vectorType: VectorType
  /** Distance metric */
  distanceMetric: VectorDistanceMetric
  /** Metadata column names */
  metadataColumns: string[]
  /** Partition key column (if any) */
  partitionKey?: string
}
