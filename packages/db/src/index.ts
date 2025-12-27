/**
 * @jejunetwork/db - Database Integration for Jeju Network (Powered by EQLite)
 *
 * Decentralized SQL database with:
 * - BFT-Raft consensus for strong consistency
 * - Column-level ACL for privacy
 * - Multi-tenant database rental
 * - Standard SQL interface
 *
 * @example
 * ```typescript
 * import { getDB, createRental } from '@jejunetwork/db';
 *
 * // Create a database rental
 * const eqlite = getEQLite();
 * const rental = await eqlite.createRental({
 *   planId: 'basic',
 *   schema: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)',
 * });
 *
 * // Query the database
 * const users = await eqlite.query<{ id: number; name: string }>(
 *   'SELECT * FROM users',
 *   [],
 *   rental.databaseId
 * );
 * ```
 */

export {
  EQLiteClient,
  getEQLite,
  getEQLite as getEQLiteClient,
  getEQLite as createEQLiteClient,
  resetEQLite,
  resetEQLite as resetEQLiteClient,
} from './client.js'
// Database manager for robust connection handling
export {
  createDatabaseManager,
  DatabaseManager,
  type DatabaseManagerConfig,
  type DatabaseManagerStats,
  getAllManagers,
  getManager,
  getOrCreateManager,
  type ManagerStatus,
  shutdownAllManagers,
} from './manager.js'
export {
  addColumn,
  createIndex,
  createMigrationManager,
  createTable,
  createTableMigration,
  defineMigration,
  MigrationManager,
  type TableSchema,
} from './migration.js'
export {
  buildOrderByClause,
  buildWhereClause,
  type OrderByInput,
  toQueryParam,
  type WhereClauseResult,
  type WhereInput,
} from './query-builder.js'
// Secure client for per-app database provisioning
export {
  createSecureEQLiteClient,
  type ProvisionedDatabase,
  SecureEQLiteClient,
  type SecureEQLiteConfig,
} from './secure-client.js'
export type {
  ACLEventDetails,
  ACLPermission,
  ACLRule,
  BlockProducerInfo,
  ColumnMeta,
  ConsistencyLevel,
  EQLiteConfig,
  EQLiteConnection,
  EQLiteConnectionPool,
  EQLiteDataType,
  EQLiteEvent,
  EQLiteEventDetails,
  EQLiteQueryable,
  EQLiteTransaction,
  CreateRentalRequest,
  DatabaseConfig,
  DatabaseInfo,
  DatabaseStatus,
  ExecEventDetails,
  ExecResult,
  GrantRequest,
  Migration,
  MigrationEventDetails,
  MigrationResult,
  MinerInfo,
  QueryEventDetails,
  QueryParam,
  QueryResult,
  RentalEventDetails,
  RentalInfo,
  RentalPlan,
  RevokeRequest,
  VectorBatchInsertRequest,
  VectorDistanceMetric,
  VectorIndexConfig,
  VectorIndexInfo,
  VectorInsertRequest,
  VectorMetadataColumn,
  VectorSearchRequest,
  VectorSearchResult,
  VectorType,
} from './types.js'
export {
  parseBoolean,
  parsePort,
  parseTimeout,
  sanitizeObject,
  sanitizeRows,
  validateColumnType,
  validateDatabaseId,
  validateMetadataFilter,
  validateSQLDefault,
  validateSQLIdentifier,
  validateSQLIdentifiers,
} from './utils.js'
// Vector search utilities (powered by sqlite-vec)
export {
  cosineDistance,
  deserializeBitVector,
  deserializeFloat32Vector,
  deserializeInt8Vector,
  generateCreateVectorTableSQL,
  generateVectorInsertSQL,
  generateVectorSearchSQL,
  l1Distance,
  l2Distance,
  normalizeVector,
  parseVectorSearchResults,
  serializeBitVector,
  serializeFloat32Vector,
  serializeInt8Vector,
  serializeVector,
  validateVectorDimensions,
  validateVectorValues,
} from './vector.js'
// EQLite Node Management (for TEE deployment)
export {
  EQLiteNodeManager,
  EQLiteNodeRole,
  EQLiteNodeStatus,
  createEQLiteNode,
  isEQLiteAvailable,
  type EQLiteNodeConfig,
  type EQLiteNodeState,
  type TEEAttestation,
} from './eqlite-node.js'
// Encrypted EQLite Client (KMS integration)
export {
  createEncryptedEQLiteClient,
  EncryptedEQLiteClient,
  type EncryptedEQLiteConfig,
  type EncryptedExecResult,
  type EncryptedQueryResult,
} from './encrypted-client.js'
// Backup Service (DWS storage integration)
export {
  BackupService,
  createBackupService,
  type BackupMetadata,
  type BackupOptions,
  type BackupServiceConfig,
  type RestoreOptions,
  type StorageBackend,
} from './backup.js'
