/**
 * HTTP client for TEE endpoint communication.
 */

import { getEnv } from '@jejunetwork/shared'
import type { Address, Hex } from 'viem'
import type {
  AccessControlPolicy,
  KeyCurve,
  KeyType,
  TEEAttestation,
} from './types.js'

/**
 * TEE API response types
 */
export interface TEEConnectResponse {
  attestation?: TEEAttestation
  enclaveKey?: Hex
}

export interface TEEKeyGenRequest {
  keyId: string
  owner: Address
  keyType: KeyType
  curve: KeyCurve
  policy: AccessControlPolicy
}

export interface TEEKeyGenResponse {
  publicKey: Hex
  address: Address
}

export interface TEESignRequest {
  message: string | Uint8Array
  hashAlgorithm?: 'keccak256' | 'sha256' | 'none'
}

export interface TEESignResponse {
  signature: Hex
}

/**
 * TEE Client wrapper with proper error handling
 */
export class TEEClient {
  private endpoint: string
  private timeout: number

  constructor(endpoint: string, timeout = 30000) {
    this.endpoint = endpoint
    this.timeout = timeout
  }

  private async fetchJson<T>(
    path: string,
    options?: RequestInit,
  ): Promise<T | undefined> {
    const response = await fetch(`${this.endpoint}${path}`, {
      ...options,
      signal: AbortSignal.timeout(this.timeout),
    }).catch(() => undefined)

    if (!response || !response.ok) return undefined
    return response.json() as Promise<T>
  }

  async checkHealth(): Promise<boolean> {
    const result = await fetch(`${this.endpoint}/health`, {
      signal: AbortSignal.timeout(5000),
    }).catch(() => undefined)
    return result?.ok ?? false
  }

  async connect(): Promise<TEEConnectResponse | undefined> {
    return this.fetchJson<TEEConnectResponse>('/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
  }

  async generateKey(
    request: TEEKeyGenRequest,
  ): Promise<TEEKeyGenResponse | undefined> {
    return this.fetchJson<TEEKeyGenResponse>('/keys/generate', {
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

  async sign(
    keyId: string,
    request: TEESignRequest,
  ): Promise<TEESignResponse | undefined> {
    return this.fetchJson<TEESignResponse>(`/keys/${keyId}/sign`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })
  }

  getEndpoint(): string {
    return this.endpoint
  }
}

let teeClient: TEEClient | undefined

export function getTEEClient(endpoint?: string): TEEClient | undefined {
  const teeEndpoint = endpoint ?? getEnv('TEE_ENDPOINT')
  if (!teeEndpoint) return undefined

  if (!teeClient || teeClient.getEndpoint() !== teeEndpoint) {
    teeClient = new TEEClient(teeEndpoint)
  }
  return teeClient
}

export function resetTEEClient(): void {
  teeClient = undefined
}
