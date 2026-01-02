/**
 * Empty stub for server-side modules in browser builds
 * Provides stub implementations for all server-only exports
 */

// Default export
export default {}

// Elysia
export const Elysia = class {
  use() { return this }
  get() { return this }
  post() { return this }
  put() { return this }
  delete() { return this }
  patch() { return this }
  group() { return this }
  onBeforeHandle() { return this }
  onAfterHandle() { return this }
  onError() { return this }
  listen() { return this }
}
export const cors = () => ({})

// Cache
export const getCacheClient = () => ({
  get: async () => null,
  set: async () => {},
  delete: async () => {},
})

// Database
export const SQLitClient = class {}
export const getSQLit = () => null
export type { SQLitClient }

// KMS
export const createKMSSigner = () => ({
  initialize: async () => {},
  isInitialized: () => false,
  getAddress: () => '0x0000000000000000000000000000000000000000',
  getKeyId: () => 'stub',
  sign: async () => '0x',
})

// Logger
export const createLogger = () => ({
  info: () => {},
  debug: () => {},
  warn: () => {},
  error: () => {},
  trace: () => {},
})

// Null implementations for other server-side modules
export const constantTimeCompare = () => false
export const extractAuthHeaders = () => ({})
export const validateWalletSignatureFromHeaders = async () => ({ valid: false })
