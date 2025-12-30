/**
 * @jejunetwork/db - Database Integration for Jeju Network (Powered by SQLit)
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
 * const sqlit = getSQLit();
 * const rental = await sqlit.createRental({
 *   planId: 'basic',
 *   schema: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)',
 * });
 *
 * // Query the database
 * const users = await sqlit.query<{ id: number; name: string }>(
 *   'SELECT * FROM users',
 *   [],
 *   rental.databaseId
 * );
 * ```
 */

// Backup Service (DWS storage integration)
export {
  type BackupMetadata,
  type BackupOptions,
  BackupService,
  type BackupServiceConfig,
  createBackupService,
  type RestoreOptions,
  type StorageBackend,
} from './backup.js'
export {
  SQLitClient,
  getSQLit,
  getSQLit as getSQLitClient,
  getSQLit as createSQLitClient,
  resetSQLit,
  resetSQLit as resetSQLitClient,
} from './client.js'
// Encrypted SQLit Client (KMS integration)
export {
  createEncryptedSQLitClient,
  EncryptedSQLitClient,
  type EncryptedSQLitConfig,
  type EncryptedExecResult,
  type EncryptedQueryResult,
} from './encrypted-client.js'
// SQLit Node Management (for TEE deployment)
export {
  createSQLitNode,
  type SQLitNodeConfig,
  SQLitNodeManager,
  SQLitNodeRole,
  type SQLitNodeState,
  SQLitNodeStatus,
  isSQLitAvailable,
  type TEEAttestation,
} from './sqlit-node.js'
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
  createSecureSQLitClient,
  type ProvisionedDatabase,
  SecureSQLitClient,
  type SecureSQLitConfig,
} from './secure-client.js'
export type {
  ACLEventDetails,
  ACLPermission,
  ACLRule,
  BlockProducerInfo,
  ColumnMeta,
  ConsistencyLevel,
  CreateRentalRequest,
  DatabaseConfig,
  DatabaseInfo,
  DatabaseStatus,
  SQLitConfig,
  SQLitConnection,
  SQLitConnectionPool,
  SQLitDataType,
  SQLitEvent,
  SQLitEventDetails,
  SQLitQueryable,
  SQLitTransaction,
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
