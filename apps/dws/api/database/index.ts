/**
 * DWS Database Module
 *
 * Secure database provisioning and access control for apps.
 */

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
  createSecureCQLRouter,
  internalExec,
  internalQuery,
} from './secure-proxy'
