/**
 * Shared API utilities for SDK modules
 *
 * Provides common fetch patterns with Zod validation and auth header generation.
 */

import type { Address, Hex } from 'viem'
import type { z } from 'zod'
import type { JsonValue } from './types'

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
