/**
 * Shared API utilities for SDK modules
 *
 * Provides common fetch patterns with Zod validation and auth header generation.
 */

import type { JsonValue } from '@jejunetwork/types'
import type { Address, Hex, PublicClient, TransactionReceipt } from 'viem'
import { decodeEventLog, keccak256, toHex } from 'viem'
import type { z } from 'zod'

/**
 * Wait for transaction receipt and parse event logs
 */
export async function waitForTxAndParseLog<T>(
  publicClient: PublicClient,
  txHash: Hex,
  eventAbi: readonly { type: 'event'; name: string }[],
  eventName: string,
  extractFn: (args: Record<string, unknown>) => T,
): Promise<{ receipt: TransactionReceipt; result: T }> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })

  for (const log of receipt.logs) {
    try {
      const decoded = decodeEventLog({
        abi: eventAbi,
        data: log.data,
        topics: log.topics,
      })
      if (decoded.eventName === eventName) {
        return {
          receipt,
          result: extractFn(decoded.args as Record<string, unknown>),
        }
      }
    } catch {
      // Skip logs that don't match our event
    }
  }

  throw new Error(`Event ${eventName} not found in transaction ${txHash}`)
}

/**
 * Parse a single bytes32/uint256 ID from transaction logs
 * Used for common patterns like "Created" events that emit an ID
 */
export async function parseIdFromLogs(
  publicClient: PublicClient,
  txHash: Hex,
  eventSignature: string,
  idFieldName: string,
): Promise<Hex> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
  const eventTopic = keccak256(toHex(eventSignature))

  for (const log of receipt.logs) {
    if (log.topics[0] === eventTopic) {
      // For indexed parameters, they appear in topics
      // For non-indexed bytes32/uint256, they're in data
      if (log.topics.length > 1) {
        return log.topics[1] as Hex
      }
      // If in data, first 32 bytes is the ID
      if (log.data && log.data.length >= 66) {
        return `0x${log.data.slice(2, 66)}` as Hex
      }
    }
  }

  throw new Error(
    `Could not parse ${idFieldName} from tx ${txHash} - event ${eventSignature} not found`,
  )
}

/**
 * Parse address from transaction logs (e.g., TokenCreated events)
 */
export async function parseAddressFromLogs(
  publicClient: PublicClient,
  txHash: Hex,
  eventSignature: string,
): Promise<Address> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash: txHash })
  const eventTopic = keccak256(toHex(eventSignature))

  for (const log of receipt.logs) {
    if (log.topics[0] === eventTopic) {
      // Address is typically indexed (in topics[1]) or first in data
      if (log.topics.length > 1) {
        // Extract address from 32-byte topic (last 20 bytes)
        return `0x${log.topics[1].slice(-40)}` as Address
      }
      if (log.data && log.data.length >= 66) {
        return `0x${log.data.slice(26, 66)}` as Address
      }
    }
  }

  throw new Error(`Could not parse address from tx ${txHash}`)
}

/** Wallet interface for auth header generation */
export interface AuthWallet {
  address: Address
  signMessage: (message: string) => Promise<Hex>
}

/** Auth header service identifier */
export type AuthService = 'jeju-storage' | 'jeju-dws' | 'a2a'

/**
 * Generate authentication headers for API requests
 */
export async function generateAuthHeaders(
  wallet: AuthWallet,
  service: AuthService,
): Promise<Record<string, string>> {
  const timestamp = Date.now().toString()
  const message = `${service}:${timestamp}`
  const signature = await wallet.signMessage(message)

  return {
    'Content-Type': 'application/json',
    'x-jeju-address': wallet.address,
    'x-jeju-timestamp': timestamp,
    'x-jeju-signature': signature,
  }
}

/**
 * Fetch and validate JSON response with Zod schema
 * Throws if response is not ok or validation fails
 */
export async function fetchAndValidate<T extends z.ZodTypeAny>(
  url: string,
  schema: T,
  options?: RequestInit,
): Promise<z.infer<T>> {
  const response = await fetch(url, options)

  if (!response.ok) {
    throw new Error(
      `API request failed: ${response.status} ${response.statusText}`,
    )
  }

  const data: unknown = await response.json()
  return schema.parse(data)
}

/**
 * Fetch and validate JSON response, returning null for 404
 */
export async function fetchAndValidateOptional<T extends z.ZodTypeAny>(
  url: string,
  schema: T,
  options?: RequestInit,
): Promise<z.infer<T> | null> {
  const response = await fetch(url, options)

  if (response.status === 404) {
    return null
  }

  if (!response.ok) {
    throw new Error(
      `API request failed: ${response.status} ${response.statusText}`,
    )
  }

  const data: unknown = await response.json()
  return schema.parse(data)
}

/**
 * Fetch with auth headers and validate response
 */
export async function fetchWithAuth<T extends z.ZodTypeAny>(
  url: string,
  schema: T,
  wallet: AuthWallet,
  service: AuthService,
  options?: Omit<RequestInit, 'headers'>,
): Promise<z.infer<T>> {
  const headers = await generateAuthHeaders(wallet, service)
  return fetchAndValidate(url, schema, {
    ...options,
    headers,
  })
}

/**
 * Post JSON with auth headers and validate response
 */
export async function postWithAuth<T extends z.ZodTypeAny>(
  url: string,
  body: JsonValue,
  schema: T,
  wallet: AuthWallet,
  service: AuthService,
): Promise<z.infer<T>> {
  const headers = await generateAuthHeaders(wallet, service)
  return fetchAndValidate(url, schema, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })
}

/**
 * Post and expect void response (just check ok status)
 */
export async function postVoidWithAuth(
  url: string,
  body: JsonValue,
  wallet: AuthWallet,
  service: AuthService,
): Promise<void> {
  const headers = await generateAuthHeaders(wallet, service)
  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`API request failed: ${response.status} - ${error}`)
  }
}

/**
 * Type for objects that may have bigint values after transformation
 */
type TransformableRecord = Record<string, JsonValue | bigint>

/**
 * Helper to transform bigint strings in API responses.
 * Takes a JSON record and converts specified string fields to bigint.
 * The result may contain bigint values which are not JSON-serializable.
 */
export function transformBigIntFields<T extends TransformableRecord>(
  obj: T,
  fields: (keyof T)[],
): T {
  const result = { ...obj }
  for (const field of fields) {
    const value = obj[field]
    if (typeof value === 'string') {
      ;(result as TransformableRecord)[field as string] = BigInt(value)
    }
  }
  return result
}
