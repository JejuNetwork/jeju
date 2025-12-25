/**
 * CQL Database Plugin for ElizaOS
 *
 * Provides a decentralized database adapter using CovenantSQL.
 * This replaces @elizaos/plugin-sql for Jeju-based agents.
 */

export { CQLDatabaseAdapter } from './adapter'
export {
  CQL_SCHEMA,
  checkMigrationStatus,
  runCQLMigrations,
} from './migrations'
export { cqlDatabasePlugin } from './plugin'
