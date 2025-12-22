/**
 * KMS Service for encrypted data
 *
 * Provides encryption/decryption using the network KMS with MPC.
 * No fallbacks - requires KMS to be available for production use.
 */

import type { Address } from 'viem'

const KMS_ENDPOINT = process.env.KMS_ENDPOINT || 'http://localhost:4400'
const KMS_TIMEOUT = 10000

interface KMSService {
  encrypt(data: string, owner: Address): Promise<string>
  decrypt(encryptedData: string, owner: Address): Promise<string>
  isHealthy(): Promise<boolean>
}

class NetworkKMSService implements KMSService {
  private healthLastChecked = 0
  private healthy = false

  async encrypt(data: string, owner: Address): Promise<string> {
    const response = await fetch(`${KMS_ENDPOINT}/encrypt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': owner,
      },
      body: JSON.stringify({
        data,
        policy: {
          conditions: [{ type: 'address', value: owner }],
          operator: 'and',
        },
      }),
      signal: AbortSignal.timeout(KMS_TIMEOUT),
    })

    if (!response.ok) {
      throw new Error(
        `KMS encryption failed: ${response.status} ${response.statusText}`,
      )
    }

    const result = (await response.json()) as { encrypted: string }
    return result.encrypted
  }

  async decrypt(encryptedData: string, owner: Address): Promise<string> {
    const response = await fetch(`${KMS_ENDPOINT}/decrypt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': owner,
      },
      body: JSON.stringify({ payload: encryptedData }),
      signal: AbortSignal.timeout(KMS_TIMEOUT),
    })

    if (!response.ok) {
      throw new Error(
        `KMS decryption failed: ${response.status} ${response.statusText}`,
      )
    }

    const result = (await response.json()) as { decrypted: string }
    return result.decrypted
  }

  async isHealthy(): Promise<boolean> {
    // Cache the health check result for 30 seconds
    if (Date.now() - this.healthLastChecked < 30000) {
      return this.healthy
    }

    try {
      const response = await fetch(`${KMS_ENDPOINT}/health`, {
        signal: AbortSignal.timeout(5000),
      })
      this.healthy = response.ok
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error'
      console.debug(`[KMS] Health check failed: ${errorMsg}`)
      this.healthy = false
    }

    this.healthLastChecked = Date.now()
    return this.healthy
  }
}

let kmsService: KMSService | null = null

export function getKMSService(): KMSService {
  if (!kmsService) {
    kmsService = new NetworkKMSService()
  }
  return kmsService
}
