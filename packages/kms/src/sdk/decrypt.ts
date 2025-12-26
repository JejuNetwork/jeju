/**
 * KMS SDK - Decryption utilities
 */

import { type Address, type Hex, keccak256, toBytes } from 'viem'

/** JSON-serializable value type */
type JsonValue =
  | null
  | string
  | number
  | boolean
  | JsonValue[]
  | { [key: string]: JsonValue }
import type { z } from 'zod'
import { getKMS } from '../kms.js'
import type { AuthSignature, EncryptedPayload } from '../types.js'

export function createAuthSig(
  signature: Hex,
  message: string,
  address: Address,
  derivedVia: AuthSignature['derivedVia'] = 'web3.eth.personal.sign',
): AuthSignature {
  return { sig: signature, derivedVia, signedMessage: message, address }
}

export function createSIWEAuthSig(
  signature: Hex,
  siweMessage: string,
  address: Address,
): AuthSignature {
  return {
    sig: signature,
    derivedVia: 'siwe',
    signedMessage: siweMessage,
    address,
  }
}

export async function decrypt(
  payload: EncryptedPayload,
  authSig: AuthSignature,
): Promise<string> {
  const kms = getKMS()
  await kms.initialize()
  return kms.decrypt({ payload, authSig })
}

export async function decryptPublic(
  payload: EncryptedPayload,
): Promise<string> {
  const kms = getKMS()
  await kms.initialize()
  return kms.decrypt({ payload })
}

export async function canDecrypt(payload: EncryptedPayload): Promise<boolean> {
  const now = Math.floor(Date.now() / 1000)
  for (const c of payload.policy.conditions) {
    if (c.type === 'timestamp') {
      if (c.comparator === '>=' && now >= c.value) return true
      if (c.comparator === '<=' && now <= c.value) return true
    }
  }
  return false
}

/**
 * Decrypt and parse JSON with optional schema validation.
 *
 * SECURITY: Always provide a schema when decrypting untrusted data to prevent
 * type confusion and prototype pollution attacks.
 *
 * @param payload - The encrypted payload
 * @param authSig - Optional auth signature for access control
 * @param schema - Optional Zod schema for validation (RECOMMENDED)
 * @throws Error if schema validation fails
 */
export async function decryptJSON<T>(
  payload: EncryptedPayload,
  authSig?: AuthSignature,
  schema?: z.ZodType<T>,
): Promise<T> {
  const kms = getKMS()
  await kms.initialize()
  const decrypted = await kms.decrypt({ payload, authSig })

  // Parse JSON in a way that prevents prototype pollution
  const parsed: JsonValue = JSON.parse(decrypted, (key, value) => {
    // Reject __proto__ and constructor to prevent prototype pollution
    if (key === '__proto__' || key === 'constructor') {
      throw new Error('Prototype pollution attempt detected')
    }
    return value
  })

  // If schema provided, validate the parsed data
  if (schema) {
    const result = schema.safeParse(parsed)
    if (!result.success) {
      throw new Error(
        `Decrypted JSON validation failed: ${result.error.message}`,
      )
    }
    return result.data
  }

  // Without schema, return parsed data (caller assumes type safety)
  return parsed as T
}

export async function decryptAndVerify(
  payload: EncryptedPayload,
  authSig: AuthSignature,
  expectedHash?: Hex,
): Promise<{ data: string; verified: boolean }> {
  const kms = getKMS()
  await kms.initialize()
  const decrypted = await kms.decrypt({ payload, authSig })

  if (expectedHash) {
    return {
      data: decrypted,
      verified: keccak256(toBytes(decrypted)) === expectedHash,
    }
  }
  return { data: decrypted, verified: true }
}
