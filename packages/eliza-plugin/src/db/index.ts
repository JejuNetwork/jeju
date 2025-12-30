/**
 * SQLit Database Plugin for ElizaOS
 *
 * Provides a decentralized database adapter using SQLit.
 * This replaces @elizaos/plugin-sql for Jeju-based agents.
 */

export { SQLitDatabaseAdapter } from './adapter'
export {
  checkMigrationStatus,
  SQLIT_SCHEMA,
  runSQLitMigrations,
} from './migrations'
export { sqlitDatabasePlugin } from './plugin'
