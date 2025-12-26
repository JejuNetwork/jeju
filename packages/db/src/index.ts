/**
 * @jejunetwork/db - Database Integration for Jeju Network (Powered by CovenantSQL)
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
 * const cql = getCQL();
 * const rental = await cql.createRental({
 *   planId: 'basic',
 *   schema: 'CREATE TABLE users (id INTEGER PRIMARY KEY, name TEXT)',
 * });
 *
 * // Query the database
 * const users = await cql.query<{ id: number; name: string }>(
 *   'SELECT * FROM users',
 *   [],
 *   rental.databaseId
 * );
 * ```
 */

export {
  CQLClient,
  CQLClient as CovenantSQLClient,
  getCQL,
  getCQL as getCovenantSQLClient,
  getCQL as createCovenantSQLClient,
  resetCQL,
  resetCQL as resetCovenantSQLClient,
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
  createSecureCQLClient,
  type ProvisionedDatabase,
  SecureCQLClient,
  type SecureCQLConfig,
} from './secure-client.js'
export type {
  ACLEventDetails,
  ACLPermission,
  ACLRule,
  BlockProducerInfo,
  ColumnMeta,
  ConsistencyLevel,
  CQLConfig,
  CQLConnection,
  CQLConnectionPool,
  CQLDataType,
  CQLEvent,
  CQLEventDetails,
  CQLQueryable,
  CQLTransaction,
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
