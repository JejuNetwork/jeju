/**
 * CQL Database Plugin for ElizaOS
 *
 * Provides a decentralized database adapter using CovenantSQL.
 * This replaces @elizaos/plugin-sql for Jeju-based agents.
 *
 * NO SQLITE. NO POSTGRES. CQL ONLY.
 */

export { CQLDatabaseAdapter } from './adapter';
export { cqlDatabasePlugin } from './plugin';
export { runCQLMigrations, checkMigrationStatus, CQL_SCHEMA } from './migrations';

