/**
 * Shared utilities for DWS
 *
 * Note: Validation utilities (addressSchema, validateBody, etc.) are available
 * by importing directly from ./validation
 *
 * Note: x402 payment utilities are available by importing from ./x402
 */

// Schemas (heavily used by routes)
export * from './schemas'

// API Marketplace utilities
export * from './utils/api-marketplace'

// Common utilities
export * from './utils/common'

// Crypto utilities
export * from './utils/crypto'

// RPC utilities
export * from './utils/rpc'

// Re-export commonly needed types from validation
export {
  type JSONArray,
  type JSONObject,
  type JSONPrimitive,
  type JSONValue,
  jejuAddressHeaderSchema,
  strictHexSchema,
} from './validation'
