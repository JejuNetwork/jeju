/**
 * Type Guards for Storage
 *
 * Uses Zod schemas for validation - type guards are thin wrappers for compatibility.
 */

import type {
  AccessCondition,
  CIDResponse,
  EncryptedPayload,
  IPFSUploadResult,
} from './types'
import {
  AccessConditionSchema,
  CIDResponseSchema,
  EncryptedPayloadSchema,
  IPFSUploadResultSchema,
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
  return CIDResponseSchema.safeParse(value).success
}

/**
 * Check if value is an access condition
 */
export function isAccessCondition(value: unknown): value is AccessCondition {
  return AccessConditionSchema.safeParse(value).success
}

/**
 * Check if value is an encrypted payload
 */
export function isEncryptedPayload(value: unknown): value is EncryptedPayload {
  return EncryptedPayloadSchema.safeParse(value).success
}

/**
 * Check if value is an IPFS upload result
 */
export function isIPFSUploadResult(value: unknown): value is IPFSUploadResult {
  return IPFSUploadResultSchema.safeParse(value).success
}

/**
 * Check if value is a JSON record
 */
export function isJsonRecord(value: unknown): value is Record<string, unknown> {
  return isObject(value)
}

/**
 * Validate CID response and return typed data, or throw
 */
export function validateCIDResponse(value: unknown): CIDResponse {
  return CIDResponseSchema.parse(value)
}

/**
 * Validate encrypted payload and return typed data, or throw
 */
export function validateEncryptedPayload(value: unknown): EncryptedPayload {
  const parsed = EncryptedPayloadSchema.parse(value)
  return {
    ciphertext: parsed.ciphertext,
    dataHash: parsed.dataHash,
    accessControlConditions: parsed.accessControlConditions.map((c) => ({
      type: c.type,
      chainId: c.chainId,
      address: c.address,
      role: c.role,
      timestamp: c.timestamp,
    })),
    accessControlConditionType: parsed.accessControlConditionType,
    encryptedSymmetricKey: parsed.encryptedSymmetricKey,
    chain: parsed.chain,
  }
}
