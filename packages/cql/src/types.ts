/**
 * @jeju/cql - CovenantSQL Types
 *
 * Types for decentralized SQL database integration.
 * CovenantSQL provides:
 * - BFT-Raft consensus for strong consistency
 * - Column-level ACL for privacy
 * - Multi-tenant database rental
 * - SQL interface compatible with standard ORMs
 */

import type { Address, Hex } from 'viem';

// ============================================================================
// Connection Types
// ============================================================================

export interface CQLConfig {
  /** Block producer endpoint */
  blockProducerEndpoint: string;
  /** Miner node endpoint (for direct queries) */
  minerEndpoint?: string;
  /** Private key for signing (hex) */
  privateKey?: Hex;
  /** Database ID (hex hash) */
  databaseId?: string;
  /** Connection timeout in ms */
  timeout?: number;
  /** Enable query logging */
  debug?: boolean;
}

export interface CQLConnectionPool {
  /** Get a connection from the pool */
  acquire(): Promise<CQLConnection>;
  /** Release a connection back to the pool */
  release(connection: CQLConnection): void;
  /** Close all connections */
  close(): Promise<void>;
  /** Pool statistics */
  stats(): { active: number; idle: number; total: number };
}

export interface CQLConnection {
  /** Connection ID */
  id: string;
  /** Database ID */
  databaseId: string;
  /** Whether connection is active */
  active: boolean;
  /** Execute a query */
  query<T>(sql: string, params?: QueryParam[]): Promise<QueryResult<T>>;
  /** Execute a write query */
  exec(sql: string, params?: QueryParam[]): Promise<ExecResult>;
  /** Start a transaction */
  beginTransaction(): Promise<CQLTransaction>;
  /** Close the connection */
  close(): Promise<void>;
}

export interface CQLTransaction {
  /** Transaction ID */
  id: string;
  /** Execute query within transaction */
  query<T>(sql: string, params?: QueryParam[]): Promise<QueryResult<T>>;
  /** Execute write within transaction */
  exec(sql: string, params?: QueryParam[]): Promise<ExecResult>;
  /** Commit transaction */
  commit(): Promise<void>;
  /** Rollback transaction */
  rollback(): Promise<void>;
}

// ============================================================================
// Query Types
// ============================================================================

export type QueryParam = string | number | boolean | null | Uint8Array | bigint;

export interface QueryResult<T> {
  /** Result rows */
  rows: T[];
  /** Number of rows returned */
  rowCount: number;
  /** Column metadata */
  columns: ColumnMeta[];
  /** Query execution time in ms */
  executionTime: number;
  /** Block height at query time */
  blockHeight: number;
}

export interface ExecResult {
  /** Number of rows affected */
  rowsAffected: number;
  /** Last insert ID (if applicable) */
  lastInsertId?: bigint;
  /** Transaction hash on CQL chain */
  txHash: Hex;
  /** Block height of transaction */
  blockHeight: number;
  /** Gas used */
  gasUsed: bigint;
}

export interface ColumnMeta {
  name: string;
  type: CQLDataType;
  nullable: boolean;
  primaryKey: boolean;
  autoIncrement: boolean;
}

export type CQLDataType =
  | 'INTEGER'
  | 'BIGINT'
  | 'REAL'
  | 'TEXT'
  | 'BLOB'
  | 'BOOLEAN'
  | 'TIMESTAMP'
  | 'JSON';

// ============================================================================
// Database Management
// ============================================================================

export interface DatabaseConfig {
  /** Number of miner nodes (minimum 1, default 3) */
  nodeCount: number;
  /** Use eventual consistency (faster) or strong consistency (slower, default) */
  useEventualConsistency?: boolean;
  /** Geographic regions for miners */
  regions?: string[];
  /** Initial schema SQL */
  schema?: string;
  /** Owner address */
  owner: Address;
  /** Token to pay with */
  paymentToken?: Address;
}

export interface DatabaseInfo {
  /** Database ID (hex hash) */
  id: string;
  /** Creation timestamp */
  createdAt: number;
  /** Owner address */
  owner: Address;
  /** Number of miner nodes */
  nodeCount: number;
  /** Consistency mode */
  consistencyMode: 'eventual' | 'strong';
  /** Status */
  status: DatabaseStatus;
  /** Current block height */
  blockHeight: number;
  /** Total size in bytes */
  sizeBytes: number;
  /** Monthly cost in payment token */
  monthlyCost: bigint;
}

export type DatabaseStatus =
  | 'creating'
  | 'running'
  | 'stopped'
  | 'migrating'
  | 'error';

// ============================================================================
// Access Control
// ============================================================================

export interface ACLRule {
  /** Grantee address or wildcard */
  grantee: Address | '*';
  /** Table name or wildcard */
  table: string | '*';
  /** Column names or wildcard */
  columns: string[] | '*';
  /** Permissions */
  permissions: ACLPermission[];
  /** Condition SQL (WHERE clause) */
  condition?: string;
}

export type ACLPermission = 'SELECT' | 'INSERT' | 'UPDATE' | 'DELETE' | 'ALL';

export interface GrantRequest {
  /** Address to grant permissions to */
  grantee: Address;
  /** Table to grant permissions on */
  table: string;
  /** Specific columns (or all) */
  columns?: string[];
  /** Permissions to grant */
  permissions: ACLPermission[];
  /** Row-level condition */
  condition?: string;
}

export interface RevokeRequest {
  /** Address to revoke permissions from */
  grantee: Address;
  /** Table to revoke permissions on */
  table: string;
  /** Specific columns (or all) */
  columns?: string[];
  /** Permissions to revoke */
  permissions: ACLPermission[];
}

// ============================================================================
// Rental & Billing
// ============================================================================

export interface RentalPlan {
  /** Plan ID */
  id: string;
  /** Plan name */
  name: string;
  /** Number of nodes included */
  nodeCount: number;
  /** Storage quota in bytes */
  storageBytes: bigint;
  /** Queries per month */
  queriesPerMonth: bigint;
  /** Monthly price in payment token */
  pricePerMonth: bigint;
  /** Payment token address */
  paymentToken: Address;
}

export interface RentalInfo {
  /** Rental ID */
  id: string;
  /** Database ID */
  databaseId: string;
  /** Renter address */
  renter: Address;
  /** Plan ID */
  planId: string;
  /** Start timestamp */
  startedAt: number;
  /** Expiration timestamp */
  expiresAt: number;
  /** Auto-renew enabled */
  autoRenew: boolean;
  /** Payment status */
  paymentStatus: 'current' | 'overdue' | 'cancelled';
}

export interface CreateRentalRequest {
  /** Plan to subscribe to */
  planId: string;
  /** Initial schema SQL */
  schema?: string;
  /** Enable auto-renewal */
  autoRenew?: boolean;
  /** Payment token */
  paymentToken?: Address;
  /** Prepay months */
  months?: number;
}

// ============================================================================
// Migration Types
// ============================================================================

export interface Migration {
  /** Migration version */
  version: number;
  /** Migration name */
  name: string;
  /** Up migration SQL */
  up: string;
  /** Down migration SQL */
  down: string;
  /** Migration timestamp */
  appliedAt?: number;
}

export interface MigrationResult {
  /** Applied migrations */
  applied: string[];
  /** Current version */
  currentVersion: number;
  /** Pending migrations */
  pending: string[];
}

// ============================================================================
// Events
// ============================================================================

export interface CQLEvent {
  type: 'query' | 'exec' | 'migration' | 'acl' | 'rental';
  databaseId: string;
  timestamp: number;
  actor?: Address;
  details: Record<string, unknown>;
  txHash?: Hex;
}

// ============================================================================
// Block Producer Types
// ============================================================================

export interface BlockProducerInfo {
  /** Block producer address */
  address: Address;
  /** Endpoint URL */
  endpoint: string;
  /** Current block height */
  blockHeight: number;
  /** Active databases */
  databases: number;
  /** Total stake */
  stake: bigint;
  /** Status */
  status: 'active' | 'syncing' | 'offline';
}

export interface MinerInfo {
  /** Miner address */
  address: Address;
  /** Database ID */
  databaseId: string;
  /** Role (leader or follower) */
  role: 'leader' | 'follower';
  /** Endpoint URL */
  endpoint: string;
  /** Block height */
  blockHeight: number;
  /** Status */
  status: 'active' | 'syncing' | 'offline';
}

