/**
 * DWS Database Module
 *
 * Secure database provisioning and access control for apps.
 * EQLite runs as a DWS-managed service, not a separate deployment.
 */

// EQLite service management (runs ON DWS)
export {
  ensureEQLiteService,
  getDatabaseConnectionInfo,
  getEQLiteClientPort,
  getEQLiteEndpoint,
  getEQLiteStatus,
  isEQLiteHealthy,
  provisionAppDatabase,
} from './eqlite-service'
// Keepalive service for database health monitoring
export {
  createKeepaliveRouter,
  forceHealthCheck,
  getAllDatabases,
  getKeepaliveStats,
  getRegisteredDatabase,
  type KeepaliveConfig,
  type KeepaliveStats,
  type RegisteredDatabase,
  type ResourceStatus,
  registerDatabase,
  startKeepaliveService,
  stopKeepaliveService,
  unregisterDatabase,
} from './keepalive'
export {
  createDatabaseRouter,
  grantDatabaseAccess,
  listDatabases,
  provisionDatabase,
  revokeDatabaseAccess,
  verifySignedRequest,
} from './provisioning'
export {
  createSecureEQLiteRouter,
  internalExec,
  internalQuery,
} from './secure-proxy'
