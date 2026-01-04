/**
 * @jejunetwork/durable-objects - Durable Objects for DWS
 *
 * Provides Cloudflare-compatible Durable Objects API backed by SQLit.
 *
 * @example
 * ```typescript
 * import {
 *   createNamespace,
 *   createDurableObjectState,
 *   initializeDOSchema,
 * } from '@jejunetwork/durable-objects'
 * import { getSQLit } from '@jejunetwork/db'
 *
 * // Initialize schema (once at startup)
 * const sqlit = getSQLit()
 * await initializeDOSchema(sqlit, 'my-database')
 *
 * // Create namespace for workers
 * const rooms = createNamespace('ROOMS', {
 *   dwsApiUrl: 'http://localhost:4030',
 * })
 *
 * // Get a DO stub
 * const id = rooms.idFromName('lobby')
 * const stub = rooms.get(id)
 * const response = await stub.fetch('http://do/messages')
 * ```
 */

// ID implementation
export { DWSObjectId } from './id.js'
// Namespace and stub
export {
  createAsyncNamespace,
  createNamespace,
  type DORouterConfig,
  DWSObjectNamespace,
  DWSObjectNamespaceAsync,
  DWSObjectStub,
} from './namespace.js'
// Schema and migrations
export {
  cleanupStaleDOData,
  DO_SCHEMA,
  DO_SCHEMA_STATEMENTS,
  getDOStats,
  initializeDOSchema,
  isDOSchemaInitialized,
} from './schema.js'

// State implementation
export { createDurableObjectState, DWSObjectState } from './state.js'
// Storage implementation
export {
  DWSObjectStorage,
  MAX_BATCH_SIZE,
  MAX_KEY_SIZE,
  MAX_LIST_LIMIT,
  MAX_VALUE_SIZE,
} from './storage.js'
// Types
export type {
  DeleteOptions,
  DOAlarmEntry,
  DOLocationEntry,
  DOStorageConfig,
  DurableObject,
  DurableObjectConstructor,
  DurableObjectId,
  DurableObjectNamespace,
  DurableObjectState,
  DurableObjectStorage,
  DurableObjectStub,
  GetAlarmOptions,
  GetDurableObjectOptions,
  GetOptions,
  ListOptions,
  PutOptions,
  SetAlarmOptions,
} from './types.js'
