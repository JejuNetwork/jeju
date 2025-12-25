/**
 * IPFS Storage Integration for OAuth3
 */

import type { StorageTier } from '@jejunetwork/shared'
import { type Address, type Hex, toBytes, toHex } from 'viem'
import type {
  OAuth3App,
  OAuth3Identity,
  OAuth3Session,
  VerifiableCredential,
} from '../types.js'
import {
  CredentialIndexSchema,
  expectJson,
  IPFSAddResponseSchema,
  OAuth3SessionSchema,
  SessionIndexSchema,
  VerifiableCredentialSchema,
  validateResponse,
} from '../validation.js'
import { DEFAULT_IPFS_API, DEFAULT_IPFS_GATEWAY } from './config.js'

export type { StorageTier }

export interface StorageConfig {
  ipfsApiEndpoint?: string
  ipfsGatewayEndpoint?: string
  encryptionKey?: Hex
  defaultTier?: StorageTier
  enablePayments?: boolean
  paymentToken?: Address
}

export interface StoredSession {
  sessionId: Hex
  cid: string
  encryptedData: Hex
  expiresAt: number
  createdAt: number
}

export interface StoredCredential {
  credentialId: string
  cid: string
  subjectDid: string
  issuerDid: string
  type: string[]
  issuedAt: number
  expiresAt: number
}

export interface StorageResult {
  cid: string
  size: number
  url: string
  tier: StorageTier
}

/**
 * Storage Service - Sessions are encrypted, credentials are public
 */
export class OAuth3StorageService {
  private ipfsApi: string
  private ipfsGateway: string
  private encryptionKey: Uint8Array | null
  private defaultTier: StorageTier
  private sessionCache = new Map<Hex, string>()
  private credentialCache = new Map<string, string>()

  constructor(config: StorageConfig = {}) {
    this.ipfsApi =
      config.ipfsApiEndpoint ||
      process.env.IPFS_API_ENDPOINT ||
      DEFAULT_IPFS_API
    this.ipfsGateway =
      config.ipfsGatewayEndpoint ||
      process.env.IPFS_GATEWAY ||
      DEFAULT_IPFS_GATEWAY
    this.encryptionKey = config.encryptionKey
      ? toBytes(config.encryptionKey)
      : null
    this.defaultTier = config.defaultTier ?? 'hot'
  }

  async storeSession(session: OAuth3Session): Promise<StoredSession> {
    if (!this.encryptionKey) {
      throw new Error(
        'Encryption key required for session storage. Use MPC-derived key.',
      )
    }

    const encryptedData = await this.encrypt(JSON.stringify(session))
    const result = await this.upload(
      encryptedData,
      `session-${session.sessionId}.enc`,
      { tier: 'hot' },
    )
    this.sessionCache.set(session.sessionId, result.cid)

    return {
      sessionId: session.sessionId,
      cid: result.cid,
      encryptedData: toHex(encryptedData),
      expiresAt: session.expiresAt,
      createdAt: Date.now(),
    }
  }

  async retrieveSession(sessionId: Hex): Promise<OAuth3Session | null> {
    const cid = this.sessionCache.get(sessionId)
    if (!cid) return null

    const data = await this.retrieve(cid)
    if (!data) {
      this.sessionCache.delete(sessionId)
      return null
    }

    const session = expectJson(
      await this.decrypt(data),
      OAuth3SessionSchema,
      'encrypted session',
    )
    if (session.expiresAt < Date.now()) {
      await this.deleteSession(sessionId)
      return null
    }
    return session
  }

  async retrieveSessionByCid(cid: string): Promise<OAuth3Session | null> {
    const data = await this.retrieve(cid)
    if (!data) return null

    const session = expectJson(
      await this.decrypt(data),
      OAuth3SessionSchema,
      'encrypted session',
    )
    this.sessionCache.set(session.sessionId, cid)
    return session.expiresAt < Date.now() ? null : session
  }

  async deleteSession(sessionId: Hex): Promise<void> {
    const cid = this.sessionCache.get(sessionId)
    if (cid) {
      await this.unpin(cid)
      this.sessionCache.delete(sessionId)
    }
  }

  async listSessionsForIdentity(identityId: Hex): Promise<StoredSession[]> {
    const results: StoredSession[] = []
    for (const [sessionId, cid] of this.sessionCache.entries()) {
      const session = await this.retrieveSession(sessionId)
      if (session?.identityId === identityId) {
        results.push({
          sessionId,
          cid,
          encryptedData: '0x' as Hex,
          expiresAt: session.expiresAt,
          createdAt: 0,
        })
      }
    }
    return results
  }

  async storeCredential(
    credential: VerifiableCredential,
  ): Promise<StoredCredential> {
    const result = await this.upload(
      new TextEncoder().encode(JSON.stringify(credential)),
      `credential-${credential.id}.json`,
      { tier: 'permanent' },
    )
    this.credentialCache.set(credential.id, result.cid)

    return {
      credentialId: credential.id,
      cid: result.cid,
      subjectDid: credential.credentialSubject.id,
      issuerDid: credential.issuer.id,
      type: credential.type,
      issuedAt: new Date(credential.issuanceDate).getTime(),
      expiresAt: new Date(credential.expirationDate).getTime(),
    }
  }

  async retrieveCredential(
    credentialId: string,
  ): Promise<VerifiableCredential | null> {
    const cid = this.credentialCache.get(credentialId)
    if (!cid) return null
    const data = await this.retrieve(cid)
    if (!data) return null
    const result = VerifiableCredentialSchema.safeParse(
      JSON.parse(new TextDecoder().decode(data)),
    )
    return result.success ? result.data : null
  }

  async retrieveCredentialByCid(
    cid: string,
  ): Promise<VerifiableCredential | null> {
    const data = await this.retrieve(cid)
    if (!data) return null
    const result = VerifiableCredentialSchema.safeParse(
      JSON.parse(new TextDecoder().decode(data)),
    )
    if (!result.success) return null
    const credential = result.data
    this.credentialCache.set(credential.id, cid)
    return credential
  }

  async listCredentialsForSubject(
    subjectDid: string,
  ): Promise<StoredCredential[]> {
    const results: StoredCredential[] = []
    for (const [id, cid] of this.credentialCache.entries()) {
      const cred = await this.retrieveCredential(id)
      if (cred?.credentialSubject.id === subjectDid) {
        results.push({
          credentialId: id,
          cid,
          subjectDid,
          issuerDid: cred.issuer.id,
          type: cred.type,
          issuedAt: new Date(cred.issuanceDate).getTime(),
          expiresAt: new Date(cred.expirationDate).getTime(),
        })
      }
    }
    return results
  }

  async storeAppMetadata(app: OAuth3App): Promise<StorageResult> {
    return this.upload(
      new TextEncoder().encode(
        JSON.stringify({
          appId: app.appId,
          name: app.name,
          description: app.description,
          owner: app.owner,
          jnsName: app.jnsName,
          redirectUris: app.redirectUris,
          allowedProviders: app.allowedProviders,
          metadata: app.metadata,
          createdAt: app.createdAt,
        }),
      ),
      `app-${app.appId}.json`,
      { tier: 'warm' },
    )
  }

  async retrieveAppMetadata(cid: string): Promise<Partial<OAuth3App> | null> {
    const data = await this.retrieve(cid)
    if (!data) return null
    // App metadata is stored as partial data, use safeParse for best-effort validation
    const parsed: unknown = JSON.parse(new TextDecoder().decode(data))
    if (typeof parsed !== 'object' || parsed === null) return null
    return parsed as Partial<OAuth3App>
  }

  async storeIdentityMetadata(
    identity: OAuth3Identity,
  ): Promise<StorageResult> {
    return this.upload(
      new TextEncoder().encode(
        JSON.stringify({
          id: identity.id,
          owner: identity.owner,
          smartAccount: identity.smartAccount,
          metadata: identity.metadata,
          createdAt: identity.createdAt,
          updatedAt: identity.updatedAt,
        }),
      ),
      `identity-${identity.id}.json`,
      { tier: 'warm' },
    )
  }

  private async upload(
    data: Uint8Array,
    name: string,
    options: { tier?: StorageTier },
  ): Promise<StorageResult> {
    const formData = new FormData()
    formData.append('file', new Blob([new Uint8Array(data).buffer]), name)

    const response = await fetch(`${this.ipfsApi}/add?pin=true`, {
      method: 'POST',
      body: formData,
    }).catch((e: Error) => {
      throw new Error(`IPFS upload failed: ${e.message}`)
    })
    if (!response.ok) throw new Error(`IPFS upload failed: ${response.status}`)

    const result = validateResponse(
      IPFSAddResponseSchema,
      await response.json(),
      'IPFS upload response',
    )
    return {
      cid: result.Hash,
      size: parseInt(result.Size, 10),
      url: `${this.ipfsGateway}/${result.Hash}`,
      tier: options.tier || this.defaultTier,
    }
  }

  private async retrieve(cid: string): Promise<Uint8Array | null> {
    const response = await fetch(`${this.ipfsGateway}/${cid}`, {
      signal: AbortSignal.timeout(30000),
    }).catch((e: Error) => {
      throw e.name === 'AbortError' ? new Error(`Timeout: ${cid}`) : e
    })
    if (response.status === 404) return null
    if (!response.ok)
      throw new Error(`IPFS retrieve failed: ${response.status}`)
    return new Uint8Array(await response.arrayBuffer())
  }

  private async unpin(cid: string): Promise<void> {
    const response = await fetch(`${this.ipfsApi}/pin/rm?arg=${cid}`, {
      method: 'POST',
    }).catch((error: Error) => {
      throw new Error(`Failed to unpin ${cid}: ${error.message}`)
    })

    // 500 with "not pinned" message is acceptable (already unpinned)
    if (!response.ok && response.status !== 500) {
      throw new Error(`Unpin failed for ${cid}: ${response.status}`)
    }
  }

  private async encrypt(data: string): Promise<Uint8Array> {
    if (!this.encryptionKey) throw new Error('No encryption key')

    const iv = crypto.getRandomValues(new Uint8Array(12))
    const keyBuffer = new ArrayBuffer(this.encryptionKey.length)
    new Uint8Array(keyBuffer).set(this.encryptionKey)

    const key = await crypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: 'AES-GCM' },
      false,
      ['encrypt'],
    )
    const dataBuffer = new ArrayBuffer(data.length)
    new Uint8Array(dataBuffer).set(new TextEncoder().encode(data))

    const ciphertext = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      key,
      dataBuffer,
    )
    const result = new Uint8Array(iv.length + ciphertext.byteLength)
    result.set(iv)
    result.set(new Uint8Array(ciphertext), iv.length)
    return result
  }

  private async decrypt(data: Uint8Array): Promise<string> {
    if (!this.encryptionKey) throw new Error('No encryption key')

    const keyBuffer = new ArrayBuffer(this.encryptionKey.length)
    new Uint8Array(keyBuffer).set(this.encryptionKey)

    const key = await crypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: 'AES-GCM' },
      false,
      ['decrypt'],
    )
    const ciphertextBuffer = new ArrayBuffer(data.length - 12)
    new Uint8Array(ciphertextBuffer).set(data.slice(12))

    const plaintext = await crypto.subtle.decrypt(
      { name: 'AES-GCM', iv: data.slice(0, 12) },
      key,
      ciphertextBuffer,
    )
    return new TextDecoder().decode(plaintext)
  }

  async saveSessionIndex(): Promise<string> {
    const sessions = Array.from(this.sessionCache.entries()).map(
      ([sessionId, cid]) => ({ sessionId, cid }),
    )
    const result = await this.upload(
      new TextEncoder().encode(
        JSON.stringify({ version: 1, sessions, lastUpdated: Date.now() }),
      ),
      'session-index.json',
      { tier: 'hot' },
    )
    return result.cid
  }

  async loadSessionIndex(indexCid: string): Promise<void> {
    const data = await this.retrieve(indexCid)
    if (!data) throw new Error(`Index not found: ${indexCid}`)
    const index = expectJson(
      new TextDecoder().decode(data),
      SessionIndexSchema,
      'session index',
    )
    index.sessions.forEach((e) => {
      this.sessionCache.set(e.sessionId, e.cid)
    })
  }

  async saveCredentialIndex(): Promise<string> {
    const credentials = Array.from(this.credentialCache.entries()).map(
      ([credentialId, cid]) => ({ credentialId, cid }),
    )
    const result = await this.upload(
      new TextEncoder().encode(
        JSON.stringify({ version: 1, credentials, lastUpdated: Date.now() }),
      ),
      'credential-index.json',
      { tier: 'permanent' },
    )
    return result.cid
  }

  async loadCredentialIndex(indexCid: string): Promise<void> {
    const data = await this.retrieve(indexCid)
    if (!data) throw new Error(`Index not found: ${indexCid}`)
    const index = expectJson(
      new TextDecoder().decode(data),
      CredentialIndexSchema,
      'credential index',
    )
    index.credentials.forEach((e) => {
      this.credentialCache.set(e.credentialId, e.cid)
    })
  }

  async isHealthy(): Promise<boolean> {
    const response = await fetch(`${this.ipfsApi}/id`, {
      method: 'POST',
      signal: AbortSignal.timeout(5000),
    }).catch(() => null)
    if (!response) return false
    return response.ok
  }

  setEncryptionKey(key: Hex): void {
    this.encryptionKey = toBytes(key)
  }
  getGatewayUrl(cid: string): string {
    return `${this.ipfsGateway}/${cid}`
  }
}

let instance: OAuth3StorageService | null = null

export function createOAuth3StorageService(
  config: StorageConfig = {},
): OAuth3StorageService {
  if (!instance) instance = new OAuth3StorageService(config)
  return instance
}

export function resetOAuth3StorageService(): void {
  instance = null
}
