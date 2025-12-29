/**
 * SQLit Database Plugin for ElizaOS
 *
 * Provides a decentralized database adapter using SQLit.
 * This replaces @elizaos/plugin-sql for Jeju-based agents.
 */

export { SQLitDatabaseAdapter } from './adapter'
export {
  checkMigrationStatus,
  runSQLitMigrations,
  SQLIT_SCHEMA,
} from './migrations'
export { sqlitDatabasePlugin } from './plugin'
