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
  resetCQL,
} from './client.js'

export {
  addColumn,
  createIndex,
  createMigrationManager,
  createTable,
  defineMigration,
  MigrationManager,
} from './migration.js'

export {
  buildOrderByClause,
  buildWhereClause,
  type OrderByInput,
  toQueryParam,
  type WhereClauseResult,
  type WhereInput,
} from './query-builder.js'

export { CQLServer, createCQLServer } from './server.js'

export type {
  ACLEventDetails,
  ACLPermission,
  ACLRule,
  BlockProducerInfo,
  ColumnMeta,
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
