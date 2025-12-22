/**
 * KMS Service - Eden Client
 */

import { treaty } from '@elysiajs/eden'
import { Elysia, t } from 'elysia'
import type { Address } from 'viem'

const KMS_ENDPOINT = process.env.KMS_ENDPOINT || 'http://localhost:4400'
const KMS_TIMEOUT = 10000

interface KMSService {
  encrypt(data: string, owner: Address): Promise<string>
  decrypt(encryptedData: string, owner: Address): Promise<string>
  isHealthy(): Promise<boolean>
}

export class KMSError extends Error {
  constructor(
    message: string,
    public statusCode: number,
  ) {
    super(message)
    this.name = 'KMSError'
  }
}

const kmsAppDef = new Elysia()
  .post('/encrypt', () => ({ encrypted: '' as string }), {
    body: t.Object({
      data: t.String(),
      policy: t.Object({
        conditions: t.Array(
          t.Object({
            type: t.String(),
            chain: t.Optional(t.String()),
            value: t.Optional(t.String()),
            comparator: t.Optional(t.String()),
          }),
        ),
        operator: t.String(),
      }),
    }),
  })
  .post('/decrypt', () => ({ decrypted: '' as string }), {
    body: t.Object({ payload: t.String() }),
  })
  .get('/health', () => ({ status: 'ok' as const }))

type KMSApp = typeof kmsAppDef

class NetworkKMSService implements KMSService {
  private client: ReturnType<typeof treaty<KMSApp>>
  private baseUrl: string
  private healthLastChecked = 0
  private healthy = false

  constructor() {
    this.baseUrl = KMS_ENDPOINT.replace(/\/$/, '')
    this.client = treaty<KMSApp>(this.baseUrl, {
      fetch: { signal: AbortSignal.timeout(KMS_TIMEOUT) },
    })
  }

  async encrypt(data: string, owner: Address): Promise<string> {
    // Eden doesn't support custom headers per-request easily, use fetch
    const response = await fetch(`${this.baseUrl}/encrypt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': owner,
      },
      body: JSON.stringify({
        data,
        policy: {
          conditions: [
            { type: 'balance', chain: 'base', value: '0', comparator: '>=' },
          ],
          operator: 'and',
        },
      }),
      signal: AbortSignal.timeout(KMS_TIMEOUT),
    })

    if (!response.ok) {
      throw new KMSError(
        `KMS encryption failed: ${response.status} ${response.statusText}`,
        response.status,
      )
    }

    const result = (await response.json()) as { encrypted: string }
    return result.encrypted
  }

  async decrypt(encryptedData: string, owner: Address): Promise<string> {
    const response = await fetch(`${this.baseUrl}/decrypt`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-jeju-address': owner,
      },
      body: JSON.stringify({ payload: encryptedData }),
      signal: AbortSignal.timeout(KMS_TIMEOUT),
    })

    if (!response.ok) {
      throw new KMSError(
        `KMS decryption failed: ${response.status} ${response.statusText}`,
        response.status,
      )
    }

    const result = (await response.json()) as { decrypted: string }
    return result.decrypted
  }

  async isHealthy(): Promise<boolean> {
    if (Date.now() - this.healthLastChecked < 30000) {
      return this.healthy
    }

    const { error } = await this.client.health.get()
    this.healthy = !error
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

export function createKMSClient(baseUrl: string) {
  return treaty<KMSApp>(baseUrl, {
    fetch: { signal: AbortSignal.timeout(KMS_TIMEOUT) },
  })
}

export function resetKMSService(): void {
  kmsService = null
}
