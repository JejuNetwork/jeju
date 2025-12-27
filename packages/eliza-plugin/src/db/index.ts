/**
 * EQLite Database Plugin for ElizaOS
 *
 * Provides a decentralized database adapter using EQLite.
 * This replaces @elizaos/plugin-sql for Jeju-based agents.
 */

export { EQLiteDatabaseAdapter } from './adapter'
export {
  EQLITE_SCHEMA,
  checkMigrationStatus,
  runEQLiteMigrations,
} from './migrations'
export { eqliteDatabasePlugin } from './plugin'
