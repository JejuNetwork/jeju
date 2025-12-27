/**
 * KMS Signer Adapter
 *
 * Adapts the SecureSigningService to the KMSSigner interface
 * for use with KMSEVMClient and KMSSolanaClient.
 *
 * SECURITY: This adapter delegates all signing to the MPC infrastructure.
 * Private keys NEVER exist in this process.
 */

import type { Address, Hex } from 'viem'
import type { KMSSigner } from './kms-evm-client.js'

/**
 * SecureSigningService interface (imported dynamically to avoid circular deps)
 */
export interface SigningService {
  sign(request: {
    keyId: string
    message: string | Uint8Array
    messageHash?: Hex
  }): Promise<{
    signature: Hex
    r: Hex
    s: Hex
    v: number
  }>

  getOrCreateKey(keyId: string): Promise<{
    keyId: string
    publicKey: Hex
    address: Address
  }>
}

/**
 * Remote KMS Client
 *
 * For distributed deployments where the signing service
 * is running on a remote endpoint.
 */
export interface RemoteKMSConfig {
  endpoint: string
  apiKey?: string
  timeoutMs?: number
}

/**
 * Create a KMS signer from SecureSigningService
 *
 * SECURITY: The signing service uses FROST threshold signatures.
 * Private keys are NEVER reconstructed.
 */
export function createKMSSignerFromService(
  signingService: SigningService,
  keyId: string,
  address: Address,
): KMSSigner {
  return {
    keyId,
    address,

    async sign(messageHash: Hex): Promise<{
      signature: Hex
      r: Hex
      s: Hex
      v: number
    }> {
      const result = await signingService.sign({
        keyId,
        message: '',
        messageHash,
      })

      return {
        signature: result.signature,
        r: result.r,
        s: result.s,
        v: result.v,
      }
    },
  }
}

/**
 * Create a KMS signer from a remote endpoint
 *
 * SECURITY: Signing happens on the remote server.
 * No key material enters this process.
 */
export function createRemoteKMSSigner(
  config: RemoteKMSConfig,
  keyId: string,
  address: Address,
): KMSSigner {
  const { endpoint, apiKey, timeoutMs = 30000 } = config

  return {
    keyId,
    address,

    async sign(messageHash: Hex): Promise<{
      signature: Hex
      r: Hex
      s: Hex
      v: number
    }> {
      const controller = new AbortController()
      const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

      try {
        const headers: Record<string, string> = {
          'Content-Type': 'application/json',
        }
        if (apiKey) {
          headers['Authorization'] = `Bearer ${apiKey}`
        }

        const response = await fetch(`${endpoint}/sign`, {
          method: 'POST',
          headers,
          body: JSON.stringify({
            keyId,
            messageHash,
          }),
          signal: controller.signal,
        })

        if (!response.ok) {
          const error = await response.text()
          throw new Error(`KMS signing failed: ${response.status} - ${error}`)
        }

        const result = (await response.json()) as {
          signature: Hex
          r: Hex
          s: Hex
          v: number
        }

        return result
      } finally {
        clearTimeout(timeoutId)
      }
    },
  }
}

/**
 * Initialize a KMS signer, creating the key if needed
 *
 * SECURITY: Key generation happens in the MPC infrastructure.
 * Only the public key and address are returned.
 */
export async function initializeKMSSigner(
  signingService: SigningService,
  keyId: string,
): Promise<KMSSigner> {
  // Generate or retrieve the key from MPC
  const keyInfo = await signingService.getOrCreateKey(keyId)

  return createKMSSignerFromService(signingService, keyId, keyInfo.address)
}

/**
 * Initialize a remote KMS signer
 *
 * Fetches key info from the remote endpoint.
 */
export async function initializeRemoteKMSSigner(
  config: RemoteKMSConfig,
  keyId: string,
): Promise<KMSSigner> {
  const { endpoint, apiKey, timeoutMs = 30000 } = config
  const controller = new AbortController()
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (apiKey) {
      headers['Authorization'] = `Bearer ${apiKey}`
    }

    const response = await fetch(`${endpoint}/keys/${encodeURIComponent(keyId)}`, {
      method: 'GET',
      headers,
      signal: controller.signal,
    })

    if (!response.ok) {
      // Key doesn't exist, create it
      if (response.status === 404) {
        const createResponse = await fetch(`${endpoint}/keys`, {
          method: 'POST',
          headers,
          body: JSON.stringify({ keyId }),
          signal: controller.signal,
        })

        if (!createResponse.ok) {
          const error = await createResponse.text()
          throw new Error(`KMS key creation failed: ${createResponse.status} - ${error}`)
        }

        const keyInfo = (await createResponse.json()) as {
          keyId: string
          address: Address
        }

        return createRemoteKMSSigner(config, keyId, keyInfo.address)
      }

      const error = await response.text()
      throw new Error(`KMS key lookup failed: ${response.status} - ${error}`)
    }

    const keyInfo = (await response.json()) as {
      keyId: string
      address: Address
    }

    return createRemoteKMSSigner(config, keyId, keyInfo.address)
  } finally {
    clearTimeout(timeoutId)
  }
}

