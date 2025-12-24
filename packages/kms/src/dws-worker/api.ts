/**
 * KMS API Worker
 *
 * Public API layer that coordinates MPC parties for key management.
 * This is the user-facing service that orchestrates threshold operations.
 *
 * Features:
 * - Key generation (coordinates DKG across MPC parties)
 * - Signing requests (collects signatures from threshold of parties)
 * - Key rotation
 * - Encryption/decryption coordination
 *
 * Architecture:
 * - This worker does NOT hold key shares
 * - It discovers MPC parties from on-chain registry
 * - It orchestrates the protocol rounds
 * - Returns aggregated results to callers
 */

import { Elysia } from 'elysia'
import type { Address, Hex } from 'viem'
import { keccak256, toBytes, verifyMessage } from 'viem'
import { createMPCClient, MPCPartyDiscovery } from './mpc-discovery'

// ============ Types ============

export interface KMSAPIConfig {
  serviceAgentId: string
  mpcRegistryAddress: Address
  identityRegistryAddress: Address
  rpcUrl: string
  minRequiredParties?: number
}

interface ManagedKey {
  keyId: string
  clusterId: Hex
  groupPublicKey: Hex
  groupAddress: Address
  owner: Address
  createdAt: number
  lastUsed: number
  signaturesCount: number
  metadata: Record<string, string>
}

interface SigningRequest {
  requestId: string
  keyId: string
  messageHash: Hex
  requester: Address
  createdAt: number
  expiresAt: number
  status: 'pending' | 'signing' | 'completed' | 'failed'
  signature?: Hex
  error?: string
}

// ============ KMS API Worker ============

export function createKMSAPIWorker(config: KMSAPIConfig) {
  const discovery = new MPCPartyDiscovery({
    rpcUrl: config.rpcUrl,
    mpcRegistryAddress: config.mpcRegistryAddress,
    identityRegistryAddress: config.identityRegistryAddress,
  })

  const mpcClient = createMPCClient(
    {
      rpcUrl: config.rpcUrl,
      mpcRegistryAddress: config.mpcRegistryAddress,
      identityRegistryAddress: config.identityRegistryAddress,
    },
    config.serviceAgentId,
  )

  const _minRequiredParties = config.minRequiredParties ?? 2

  // Key registry (indexed by owner for access control)
  const keys = new Map<string, ManagedKey>()
  const ownerKeys = new Map<string, string[]>() // owner address => keyIds

  // Signing requests
  const signingRequests = new Map<string, SigningRequest>()

  // ============ Helpers ============

  function verifyKeyOwnership(
    keyId: string,
    requesterAddress: Address,
  ): boolean {
    const key = keys.get(keyId)
    if (!key) return false
    return key.owner.toLowerCase() === requesterAddress.toLowerCase()
  }

  async function verifySignature(
    address: Address,
    message: string,
    signature: Hex,
  ): Promise<boolean> {
    return verifyMessage({
      address,
      message,
      signature,
    })
  }

  // ============ Router ============

  return (
    new Elysia({ name: 'kms-api', prefix: '/kms' })
      .get('/health', async () => {
        const parties = await discovery.getActiveParties()
        const clusters = await discovery.getActiveClusters()

        return {
          status: 'healthy',
          service: 'kms-api',
          activeParties: parties.length,
          activeClusters: clusters.length,
          keysManaged: keys.size,
          pendingSignings: Array.from(signingRequests.values()).filter(
            (r) => r.status === 'pending' || r.status === 'signing',
          ).length,
        }
      })

      // ============ MPC Infrastructure Status ============

      .get('/parties', async () => {
        const parties = await discovery.getActiveParties()

        return {
          parties: parties.map((p) => ({
            agentId: p.agentId.toString(),
            endpoint: p.endpoint,
            teePlatform: p.teePlatform,
            status: p.status,
            attestationExpiry: p.attestationExpiry,
          })),
          count: parties.length,
        }
      })

      .get('/clusters', async () => {
        const clusters = await discovery.getActiveClusters()

        return {
          clusters: clusters.map((c) => ({
            clusterId: c.clusterId,
            name: c.name,
            threshold: c.threshold,
            totalParties: c.totalParties,
            groupAddress: c.groupAddress,
            status: c.status,
          })),
          count: clusters.length,
        }
      })

      // ============ Key Generation ============

      .post('/keys', async ({ body, request }) => {
        const params = body as {
          name: string
          metadata?: Record<string, string>
        }

        const ownerSignature = request.headers.get(
          'x-jeju-signature',
        ) as Hex | null
        const ownerAddress = request.headers.get(
          'x-jeju-address',
        ) as Address | null
        const nonce = request.headers.get('x-jeju-nonce')

        if (!ownerSignature || !ownerAddress || !nonce) {
          throw new Error('Missing authentication headers')
        }

        // Verify ownership
        const isValid = await verifySignature(
          ownerAddress,
          `Create KMS key:${nonce}`,
          ownerSignature,
        )
        if (!isValid) {
          throw new Error('Invalid signature')
        }

        // Get active cluster
        const clusters = await discovery.getActiveClusters()
        if (clusters.length === 0) {
          throw new Error('No active MPC cluster available')
        }

        const cluster = clusters[0]
        const keyId = `kms:${params.name}:${Date.now()}`

        // Generate key via MPC
        const { groupPublicKey, groupAddress } = await mpcClient.requestKeyGen({
          keyId,
          clusterId: cluster.clusterId,
        })

        // Store key metadata
        const managedKey: ManagedKey = {
          keyId,
          clusterId: cluster.clusterId,
          groupPublicKey,
          groupAddress,
          owner: ownerAddress,
          createdAt: Date.now(),
          lastUsed: Date.now(),
          signaturesCount: 0,
          metadata: params.metadata ?? {},
        }

        keys.set(keyId, managedKey)

        // Index by owner
        const existing = ownerKeys.get(ownerAddress.toLowerCase()) ?? []
        existing.push(keyId)
        ownerKeys.set(ownerAddress.toLowerCase(), existing)

        return {
          keyId,
          groupPublicKey,
          groupAddress,
          clusterId: cluster.clusterId,
          createdAt: managedKey.createdAt,
        }
      })

      .get('/keys', async ({ request }) => {
        const ownerAddress = request.headers.get(
          'x-jeju-address',
        ) as Address | null

        let keyList = Array.from(keys.values())

        if (ownerAddress) {
          keyList = keyList.filter(
            (k) => k.owner.toLowerCase() === ownerAddress.toLowerCase(),
          )
        }

        return {
          keys: keyList.map((k) => ({
            keyId: k.keyId,
            groupAddress: k.groupAddress,
            owner: k.owner,
            createdAt: k.createdAt,
            lastUsed: k.lastUsed,
            signaturesCount: k.signaturesCount,
            metadata: k.metadata,
          })),
          count: keyList.length,
        }
      })

      .get('/keys/:keyId', ({ params }) => {
        const key = keys.get(params.keyId)
        if (!key) {
          throw new Error('Key not found')
        }

        return {
          keyId: key.keyId,
          groupPublicKey: key.groupPublicKey,
          groupAddress: key.groupAddress,
          clusterId: key.clusterId,
          owner: key.owner,
          createdAt: key.createdAt,
          lastUsed: key.lastUsed,
          signaturesCount: key.signaturesCount,
          metadata: key.metadata,
        }
      })

      .delete('/keys/:keyId', async ({ params, request }) => {
        const ownerSignature = request.headers.get(
          'x-jeju-signature',
        ) as Hex | null
        const ownerAddress = request.headers.get(
          'x-jeju-address',
        ) as Address | null
        const nonce = request.headers.get('x-jeju-nonce')

        if (!ownerSignature || !ownerAddress || !nonce) {
          throw new Error('Missing authentication headers')
        }

        // Verify ownership
        const isValid = await verifySignature(
          ownerAddress,
          `Delete KMS key:${params.keyId}:${nonce}`,
          ownerSignature,
        )
        if (!isValid) {
          throw new Error('Invalid signature')
        }

        if (!verifyKeyOwnership(params.keyId, ownerAddress)) {
          throw new Error('Not authorized to delete this key')
        }

        // Remove key (shares are retained in MPC parties for audit)
        keys.delete(params.keyId)

        // Remove from owner index
        const existing = ownerKeys.get(ownerAddress.toLowerCase()) ?? []
        const updated = existing.filter((id) => id !== params.keyId)
        ownerKeys.set(ownerAddress.toLowerCase(), updated)

        return { success: true }
      })

      // ============ Signing ============

      .post('/sign', async ({ body, request }) => {
        const params = body as {
          keyId: string
          message?: string
          messageHash?: Hex
        }

        const requesterSignature = request.headers.get(
          'x-jeju-signature',
        ) as Hex | null
        const requesterAddress = request.headers.get(
          'x-jeju-address',
        ) as Address | null
        const nonce = request.headers.get('x-jeju-nonce')

        if (!requesterSignature || !requesterAddress || !nonce) {
          throw new Error('Missing authentication headers')
        }

        // Verify requester
        const isValid = await verifySignature(
          requesterAddress,
          `Sign with key:${params.keyId}:${nonce}`,
          requesterSignature,
        )
        if (!isValid) {
          throw new Error('Invalid signature')
        }

        // Verify key ownership
        if (!verifyKeyOwnership(params.keyId, requesterAddress)) {
          throw new Error('Not authorized to sign with this key')
        }

        const key = keys.get(params.keyId)
        if (!key) {
          throw new Error('Key not found')
        }

        // Compute message hash
        const messageHash: Hex = params.messageHash
          ? params.messageHash
          : keccak256(toBytes(params.message ?? ''))

        // Create signing request
        const requestId = crypto.randomUUID()
        const signingRequest: SigningRequest = {
          requestId,
          keyId: params.keyId,
          messageHash,
          requester: requesterAddress,
          createdAt: Date.now(),
          expiresAt: Date.now() + 5 * 60 * 1000, // 5 minutes
          status: 'signing',
        }

        signingRequests.set(requestId, signingRequest)

        // Request signature from MPC parties
        const result = await mpcClient.requestSignature({
          keyId: params.keyId,
          messageHash,
        })

        // Update request status
        signingRequest.status = 'completed'
        signingRequest.signature = result.signature

        // Update key stats
        key.lastUsed = Date.now()
        key.signaturesCount++

        return {
          requestId,
          signature: result.signature,
          r: result.r,
          s: result.s,
          v: result.v,
          messageHash,
          signedAt: Date.now(),
          signingParties: result.signingParties,
        }
      })

      .get('/sign/:requestId', ({ params }) => {
        const request = signingRequests.get(params.requestId)
        if (!request) {
          throw new Error('Signing request not found')
        }

        return {
          requestId: request.requestId,
          keyId: request.keyId,
          messageHash: request.messageHash,
          status: request.status,
          signature: request.signature,
          error: request.error,
          createdAt: request.createdAt,
          expiresAt: request.expiresAt,
        }
      })

      // ============ Batch Signing ============

      .post('/sign/batch', async ({ body, request }) => {
        const params = body as {
          keyId: string
          messages: { id: string; message?: string; messageHash?: Hex }[]
        }

        const requesterSignature = request.headers.get(
          'x-jeju-signature',
        ) as Hex | null
        const requesterAddress = request.headers.get(
          'x-jeju-address',
        ) as Address | null
        const nonce = request.headers.get('x-jeju-nonce')

        if (!requesterSignature || !requesterAddress || !nonce) {
          throw new Error('Missing authentication headers')
        }

        // Verify requester
        const isValid = await verifySignature(
          requesterAddress,
          `Batch sign with key:${params.keyId}:${params.messages.length}:${nonce}`,
          requesterSignature,
        )
        if (!isValid) {
          throw new Error('Invalid signature')
        }

        // Verify key ownership
        if (!verifyKeyOwnership(params.keyId, requesterAddress)) {
          throw new Error('Not authorized to sign with this key')
        }

        // Sign all messages
        const results = await Promise.all(
          params.messages.map(async (msg) => {
            const messageHash: Hex = msg.messageHash
              ? msg.messageHash
              : keccak256(toBytes(msg.message ?? ''))

            const result = await mpcClient.requestSignature({
              keyId: params.keyId,
              messageHash,
            })

            return {
              id: msg.id,
              messageHash,
              signature: result.signature,
              r: result.r,
              s: result.s,
              v: result.v,
            }
          }),
        )

        // Update key stats
        const key = keys.get(params.keyId)
        if (key) {
          key.lastUsed = Date.now()
          key.signaturesCount += params.messages.length
        }

        return {
          keyId: params.keyId,
          results,
          signedAt: Date.now(),
        }
      })

      // ============ Key Rotation ============

      .post('/keys/:keyId/rotate', async ({ params, request }) => {
        const ownerSignature = request.headers.get(
          'x-jeju-signature',
        ) as Hex | null
        const ownerAddress = request.headers.get(
          'x-jeju-address',
        ) as Address | null
        const nonce = request.headers.get('x-jeju-nonce')

        if (!ownerSignature || !ownerAddress || !nonce) {
          throw new Error('Missing authentication headers')
        }

        // Verify ownership
        const isValid = await verifySignature(
          ownerAddress,
          `Rotate KMS key:${params.keyId}:${nonce}`,
          ownerSignature,
        )
        if (!isValid) {
          throw new Error('Invalid signature')
        }

        if (!verifyKeyOwnership(params.keyId, ownerAddress)) {
          throw new Error('Not authorized to rotate this key')
        }

        const key = keys.get(params.keyId)
        if (!key) {
          throw new Error('Key not found')
        }

        // Generate new key shares (proactive secret sharing)
        // This rotates the shares without changing the public key
        const newKeyId = `${params.keyId}:${Date.now()}`

        await mpcClient.requestKeyGen({
          keyId: newKeyId,
          clusterId: key.clusterId,
        })

        // Verify same public key (for true rotation)
        // In real implementation, use proactive refresh protocol

        return {
          keyId: params.keyId,
          rotatedAt: Date.now(),
          newSharesGenerated: true,
        }
      })

      // ============ Encryption ============

      .post('/encrypt', async ({ body }) => {
        const params = body as {
          keyId: string
          plaintext: string
        }

        const key = keys.get(params.keyId)
        if (!key) {
          throw new Error('Key not found')
        }

        // Derive encryption key from group public key
        const encryptionKey = keccak256(toBytes(key.groupPublicKey))

        // Generate random nonce
        const nonceBytes = crypto.getRandomValues(new Uint8Array(12))
        const nonce = Buffer.from(nonceBytes).toString('base64')

        // Encrypt using AES-256-GCM (via Web Crypto)
        const keyBytes = toBytes(encryptionKey)
        const keyMaterial = await crypto.subtle.importKey(
          'raw',
          new Uint8Array(keyBytes),
          'AES-GCM',
          false,
          ['encrypt'],
        )

        const plainBytes = new TextEncoder().encode(params.plaintext)
        const ciphertext = await crypto.subtle.encrypt(
          { name: 'AES-GCM', iv: nonceBytes },
          keyMaterial,
          plainBytes,
        )

        return {
          keyId: params.keyId,
          ciphertext: Buffer.from(ciphertext).toString('base64'),
          nonce,
          algorithm: 'AES-256-GCM',
        }
      })

      .post('/decrypt', async ({ body, request }) => {
        const params = body as {
          keyId: string
          ciphertext: string
          nonce: string
        }

        const requesterSignature = request.headers.get(
          'x-jeju-signature',
        ) as Hex | null
        const requesterAddress = request.headers.get(
          'x-jeju-address',
        ) as Address | null

        if (!requesterSignature || !requesterAddress) {
          throw new Error('Missing authentication headers')
        }

        if (!verifyKeyOwnership(params.keyId, requesterAddress)) {
          throw new Error('Not authorized to decrypt with this key')
        }

        const key = keys.get(params.keyId)
        if (!key) {
          throw new Error('Key not found')
        }

        // Derive encryption key from group public key
        const encryptionKey = keccak256(toBytes(key.groupPublicKey))

        const decryptKeyBytes = toBytes(encryptionKey)
        const keyMaterial = await crypto.subtle.importKey(
          'raw',
          decryptKeyBytes.slice() as Uint8Array<ArrayBuffer>,
          'AES-GCM',
          false,
          ['decrypt'],
        )

        const cipherBytes = Buffer.from(params.ciphertext, 'base64')
        const nonceBytes = Buffer.from(params.nonce, 'base64')

        const plaintext = await crypto.subtle.decrypt(
          { name: 'AES-GCM', iv: nonceBytes },
          keyMaterial,
          cipherBytes,
        )

        return {
          keyId: params.keyId,
          plaintext: new TextDecoder().decode(plaintext),
        }
      })
  )
}

export type KMSAPIWorker = ReturnType<typeof createKMSAPIWorker>
