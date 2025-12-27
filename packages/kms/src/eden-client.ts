/**
 * HTTP client for TEE endpoint communication.
 *
 * SECURITY: All responses from remote TEE endpoints are validated with Zod schemas
 * to prevent malformed data from causing issues or exploits.
 */

import type { Address } from 'viem'
import { z } from 'zod'
import { teeLogger as log } from './logger.js'
import type { AccessControlPolicy, KeyCurve, KeyType } from './types.js'

/**
 * Zod schemas for TEE API responses - ensures type safety at runtime
 */
const hexSchema = z.string().regex(/^0x[a-fA-F0-9]*$/)
const addressSchema = z.string().regex(/^0x[a-fA-F0-9]{40}$/)

const teeAttestationSchema = z.object({
  quote: hexSchema,
  measurement: hexSchema,
  timestamp: z.number().int().positive(),
  verified: z.boolean(),
  verifierSignature: hexSchema.optional(),
})

const teeConnectResponseSchema = z.object({
  attestation: teeAttestationSchema.optional(),
  enclaveKey: hexSchema.optional(),
})

const teeKeyGenResponseSchema = z.object({
  publicKey: hexSchema,
  address: addressSchema,
})

const teeSignResponseSchema = z.object({
  signature: hexSchema,
})

/**
 * TEE API response types (derived from schemas for type safety)
 */
type TEEConnectResponse = z.infer<typeof teeConnectResponseSchema>
type TEEKeyGenResponse = z.infer<typeof teeKeyGenResponseSchema>
type TEESignResponse = z.infer<typeof teeSignResponseSchema>

interface TEEKeyGenRequest {
  keyId: string
  owner: Address
  keyType: KeyType
  curve: KeyCurve
  policy: AccessControlPolicy
}

interface TEESignRequest {
  message: string | Uint8Array
  hashAlgorithm?: 'keccak256' | 'sha256' | 'none'
}

/**
 * TEE Client wrapper with proper error handling and response validation
 *
 * SECURITY: All responses are validated with Zod schemas to ensure
 * malformed or malicious responses don't cause issues.
 */
export class TEEClient {
  private endpoint: string
  private timeout: number

  constructor(endpoint: string, timeout = 30000) {
    this.endpoint = endpoint
    this.timeout = timeout
  }

  /**
   * Fetch and validate JSON response with schema
   * SECURITY: Validates response structure before returning
   */
  private async fetchAndValidate<T>(
    path: string,
    schema: z.ZodType<T>,
    options?: RequestInit,
  ): Promise<T | undefined> {
    const response = await fetch(`${this.endpoint}${path}`, {
      ...options,
      signal: AbortSignal.timeout(this.timeout),
    }).catch((error: Error) => {
      log.warn('TEE request failed', { path, error: error.message })
      return undefined
    })

    if (!response || !response.ok) {
      log.warn('TEE response not ok', {
        path,
        status: response?.status,
      })
      return undefined
    }

    const rawData: unknown = await response.json()
    const parseResult = schema.safeParse(rawData)

    if (!parseResult.success) {
      log.error('TEE response validation failed', {
        path,
        error: parseResult.error.message,
      })
      return undefined
    }

    return parseResult.data
  }

  async checkHealth(): Promise<boolean> {
    const result = await fetch(`${this.endpoint}/health`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => undefined)
    return result?.ok ?? false
  }

  /**
   * Connect to TEE and get attestation
   * SECURITY: Response is validated to ensure attestation structure is correct
   */
  async connect(): Promise<TEEConnectResponse | undefined> {
    return this.fetchAndValidate('/connect', teeConnectResponseSchema, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  }

  /**
   * Generate a key in the TEE
   * SECURITY: Response is validated to ensure public key format is correct
   */
  async generateKey(
    request: TEEKeyGenRequest,
  ): Promise<TEEKeyGenResponse | undefined> {
    return this.fetchAndValidate('/keys/generate', teeKeyGenResponseSchema, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  }

  async revokeKey(keyId: string): Promise<boolean> {
    const result = await fetch(`${this.endpoint}/keys/${keyId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(this.timeout),
    }).catch(() => undefined)
    return result?.ok ?? false
  }

  /**
   * Sign a message with a key in the TEE
   * SECURITY: Response is validated to ensure signature format is correct
   */
  async sign(
    keyId: string,
    request: TEESignRequest,
  ): Promise<TEESignResponse | undefined> {
    return this.fetchAndValidate(`/keys/${keyId}/sign`, teeSignResponseSchema, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  }

  getEndpoint(): string {
    return this.endpoint
  }
}

/**
 * Export schemas for use in tests and other modules
 */
export {
  teeAttestationSchema,
  teeConnectResponseSchema,
  teeKeyGenResponseSchema,
  teeSignResponseSchema,
}
