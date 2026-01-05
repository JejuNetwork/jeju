/**
 * SQLit - Permissionless Distributed Database
 *
 * A high-throughput, permissionless distributed SQLite database
 * designed for decentralized applications on Jeju Network.
 *
 * Features:
 * - Primary-Replica replication with WAL streaming
 * - Permissionless node participation via staking
 * - TEE support for encrypted execution
 * - Strong consistency guarantees
 * - Vector search (sqlite-vec)
 * - Access Control Lists (ACL)
 * - Compatible with Drizzle ORM
 *
 * @example
 * ```typescript
 * // Start a node
 * import { createSQLitServer } from '@jejunetwork/sqlit'
 *
 * const server = await createSQLitServer({
 *   port: 8546,
 *   host: '0.0.0.0',
 *   nodeConfig: {
 *     operatorPrivateKey: '0x...',
 *     endpoint: 'http://localhost:8546',
 *     wsEndpoint: 'ws://localhost:8546/ws',
 *     dataDir: '.data/sqlit',
 *     region: 'us-east',
 *     teeEnabled: false,
 *     l2RpcUrl: 'http://localhost:8545',
 *     registryAddress: '0x...',
 *     version: '2.0.0',
 *   },
 * })
 *
 * // Use client
 * import { SQLitClient } from '@jejunetwork/sqlit'
 *
 * const client = new SQLitClient({
 *   endpoint: 'http://localhost:8546',
 *   databaseId: 'my-database',
 * })
 *
 * await client.execute('INSERT INTO users (name) VALUES (?)', ['Alice'])
 * const users = await client.query('SELECT * FROM users')
 * ```
 */

// Client
export { SQLitClient, type SQLitClientConfig } from './client'

// Node
export { SQLitNode } from './node'

// Server
export { createSQLitServer, type SQLitServerConfig } from './server'

// TEE
export {
  createNodeTEE,
  type DecryptedPage,
  type EncryptedPage,
  getTEEConfigFromEnv,
  type NodeTEECapabilities,
  SQLitEncryptionHandler,
  SQLitNodeTEE,
  type SQLitTEEConfig,
  SQLitTEEExecutor,
  type TEEQueryRequest,
  type TEEQueryResponse,
} from './tee'

// Types
export {
  // Database types
  type DatabaseAuditChallenge,
  type DatabaseAuditResponse,
  type DatabaseBackup,
  type DatabaseEncryptionMode,
  type DatabaseInstance,
  type DatabaseInstanceStatus,
  type DatabaseNode,
  type DatabaseNodeRole,
  type DatabaseNodeStatus,
  type DatabaseRegion,
  type QueryRequest,
  type QueryResult,
  type ReplicationConfig,
  type ReplicationStatus,
  type Transaction,
  type TransactionIsolation,
  type WALEntry,
  // Config types
  type SQLitNodeConfig,
  type SQLitServiceConfig,
  // State types
  type DatabaseState,
  type NodeState,
  type PeerConnection,
  // Protocol types
  type WALSyncRequest,
  type WALSyncResponse,
  type PromoteRequest,
  type SnapshotRequest,
  type SnapshotResponse,
  // API types
  type CreateDatabaseRequest,
  type CreateDatabaseResponse,
  type ExecuteRequest,
  type ExecuteResponse,
  type BatchExecuteRequest,
  type BatchExecuteResponse,
  // Vector types
  type VectorType,
  type VectorDistanceMetric,
  type VectorMetadataColumn,
  type VectorIndexConfig,
  type VectorInsertRequest,
  type VectorBatchInsertRequest,
  type VectorSearchRequest,
  type VectorSearchResult,
  // ACL types
  type ACLPermission,
  type ACLRule,
  type GrantRequest,
  type RevokeRequest,
  // Event types
  type SQLitEventType,
  type SQLitEvent,
  type SQLitEventHandler,
  // TEE types
  type TEEPlatform,
  type TEEAttestation,
  // Error types
  SQLitError,
  SQLitErrorCode,
  // Constants
  DEFAULT_REPLICATION_CONFIG,
  HEARTBEAT_INTERVAL_MS,
  MAX_HEARTBEAT_MISSED,
  MIN_NODE_STAKE_WEI,
  MIN_BP_STAKE_WEI,
  AUDIT_CHALLENGE_TIMEOUT_MS,
  SQLIT_REGISTRY_ABI,
} from './types'
