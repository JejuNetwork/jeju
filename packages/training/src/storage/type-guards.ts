/**
 * Type Guards for Storage
 */

import type {
  AccessCondition,
  CIDResponse,
  EncryptedPayload,
  IPFSUploadResult,
} from './types'

/**
 * Check if value is a plain object
 */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Check if value is a string
 */
export function isString(value: unknown): value is string {
  return typeof value === 'string'
}

/**
 * Check if value is a CID response
 */
export function isCIDResponse(value: unknown): value is CIDResponse {
  return isObject(value) && isString(value.cid)
}

/**
 * Check if value is an access condition
 */
export function isAccessCondition(value: unknown): value is AccessCondition {
  if (!isObject(value)) return false
  const type = value.type
  return (
    type === 'role' || type === 'contract' || type === 'timestamp'
  )
}

/**
 * Check if value is an encrypted payload
 */
export function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  if (!isObject(value)) return false
  return (
    isString(value.ciphertext) &&
    isString(value.dataHash) &&
    Array.isArray(value.accessControlConditions) &&
    isString(value.accessControlConditionType) &&
    isString(value.encryptedSymmetricKey)
  )
}

/**
 * Check if value is an IPFS upload result
 */
export function isIPFSUploadResult(value: unknown): value is IPFSUploadResult {
  if (!isObject(value)) return false
  return (
    isString(value.cid) &&
    isString(value.url) &&
    typeof value.size === 'number' &&
    (value.provider === 'ipfs' || value.provider === 'arweave')
  )
}

/**
 * Check if value is a JSON record
 */
export function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return isObject(value)
}
