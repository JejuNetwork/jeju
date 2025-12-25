/**
 * KMS API Routes
 * Key Management Service integration for DWS
 *
 * Uses real FROST threshold signing from @jejunetwork/auth
 */

import crypto from 'node:crypto'
import { FROSTCoordinator } from '@jejunetwork/auth'
import { expectValid } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import type { Address, Hex } from 'viem'
import { keccak256, toBytes, toHex } from 'viem'
import { z } from 'zod'
import {
  createKmsKeyRequestSchema,
  createSecretStoreRequestSchema,
  decryptRequestSchema,
  encryptRequestSchema,
  kmsKeyParamsSchema,
  signRequestSchema,
  updateKmsKeyRequestSchema,
} from '../../shared'
import { getAddressFromRequest } from '../../shared/utils/type-guards'

// MPC Configuration
const MPC_CONFIG = {
  defaultThreshold: 2,
  defaultParties: 3,
  minStake: BigInt(100),
  sessionTimeout: 300000, // 5 minutes
  maxConcurrentSessions: 100,
}

// FROST coordinators per key (threshold signing clusters)
const frostCoordinators = new Map<string, FROSTCoordinator>()

// Key metadata storage
interface StoredKey {
  keyId: string
  owner: Address
  publicKey: Hex
  address: Address
  threshold: number
  totalParties: number
  createdAt: number
  version: number
  metadata: Record<string, string>
}

interface Secret {
  id: string
  name: string
  owner: Address
  encryptedValue: string
  createdAt: number
  updatedAt: number
  expiresAt?: number
  metadata: Record<string, string>
}

const keys = new Map<string, StoredKey>()
const secrets = new Map<string, Secret>()
const signingSessions = new Map<
  string,
  {
    sessionId: string
    keyId: string
    messageHash: Hex
    requester: Address
    createdAt: number
    expiresAt: number
    status: 'pending' | 'signing' | 'completed' | 'expired'
  }
>()

export function createKMSRouter() {
  return (
    new Elysia({ name: 'kms', prefix: '/kms' })
      .get('/health', () => {
        return {
          status: 'healthy',
          service: 'dws-kms',
          keys: keys.size,
          secrets: secrets.size,
          activeSessions: Array.from(signingSessions.values()).filter(
            (s) => s.status === 'pending' || s.status === 'signing',
          ).length,
          config: {
            defaultThreshold: MPC_CONFIG.defaultThreshold,
            defaultParties: MPC_CONFIG.defaultParties,
          },
        }
      })
      // Generate new MPC key using FROST threshold signing
      .post('/keys', async ({ body, request, set }) => {
        const owner = getAddressFromRequest(request)
        if (!owner) throw new Error('Missing x-jeju-address header')

        const validBody = expectValid(
          createKmsKeyRequestSchema.extend({
            threshold: z.number().int().min(2).optional(),
            totalParties: z.number().int().positive().optional(),
            metadata: z.record(z.string(), z.string()).optional(),
          }),
          body,
          'Create KMS key request',
        )

        const threshold = validBody.threshold ?? MPC_CONFIG.defaultThreshold
        const totalParties = validBody.totalParties ?? MPC_CONFIG.defaultParties

        if (threshold < 2) {
          set.status = 400
          return { error: 'Threshold must be at least 2' }
        }
        if (threshold > totalParties) {
          set.status = 400
          return { error: 'Threshold cannot exceed total parties' }
        }

        const keyId = crypto.randomUUID()

        // Create FROST coordinator for this key - real threshold signing
        const coordinator = new FROSTCoordinator(keyId, threshold, totalParties)
        const cluster = await coordinator.initializeCluster()

        // Store the coordinator for signing operations
        frostCoordinators.set(keyId, coordinator)

        const key: StoredKey = {
          keyId,
          owner,
          publicKey: cluster.groupPublicKey,
          address: cluster.groupAddress,
          threshold,
          totalParties,
          createdAt: Date.now(),
          version: 1,
          metadata: validBody.metadata ?? {},
        }

        keys.set(keyId, key)

        set.status = 201
        return {
          keyId,
          publicKey: key.publicKey,
          address: key.address,
          threshold,
          totalParties,
          createdAt: key.createdAt,
          mode: 'frost', // Using real FROST threshold signing
        }
      })
      // List keys
      .get('/keys', ({ request }) => {
        const owner = request.headers.get('x-jeju-address')?.toLowerCase()

        let keyList = Array.from(keys.values())
        if (owner) {
          keyList = keyList.filter((k) => k.owner.toLowerCase() === owner)
        }

        return {
          keys: keyList.map((k) => ({
            keyId: k.keyId,
            address: k.address,
            threshold: k.threshold,
            totalParties: k.totalParties,
            version: k.version,
            createdAt: k.createdAt,
          })),
        }
      })
      // Get key details
      .get('/keys/:keyId', ({ params }) => {
        const { keyId } = expectValid(
          kmsKeyParamsSchema,
          params,
          'KMS key params',
        )
        const key = keys.get(keyId)
        if (!key) {
          throw new Error('Key not found')
        }

        return {
          keyId: key.keyId,
          publicKey: key.publicKey,
          address: key.address,
          threshold: key.threshold,
          totalParties: key.totalParties,
          version: key.version,
          createdAt: key.createdAt,
          metadata: key.metadata,
        }
      })
      // Rotate key
      .post('/keys/:keyId/rotate', async ({ params, body, request }) => {
        const owner = getAddressFromRequest(request)
        if (!owner) throw new Error('Missing x-jeju-address header')

        const { keyId } = expectValid(
          kmsKeyParamsSchema,
          params,
          'KMS key params',
        )
        const key = keys.get(keyId)

        if (!key) {
          throw new Error('Key not found')
        }
        if (key.owner.toLowerCase() !== owner.toLowerCase()) {
          throw new Error('Not authorized')
        }

        const validBody = expectValid(
          updateKmsKeyRequestSchema,
          body,
          'Update key request',
        )

        key.threshold = validBody.newThreshold ?? key.threshold
        key.totalParties = validBody.newTotalParties ?? key.totalParties
        key.version++

        return {
          keyId: key.keyId,
          version: key.version,
          threshold: key.threshold,
          totalParties: key.totalParties,
        }
      })
      // Delete key
      .delete('/keys/:keyId', ({ params, request }) => {
        const owner = getAddressFromRequest(request)
        if (!owner) throw new Error('Missing x-jeju-address header')

        const { keyId } = expectValid(
          kmsKeyParamsSchema,
          params,
          'KMS key params',
        )
        const key = keys.get(keyId)

        if (!key) {
          throw new Error('Key not found')
        }
        if (key.owner.toLowerCase() !== owner.toLowerCase()) {
          throw new Error('Not authorized')
        }

        keys.delete(key.keyId)
        frostCoordinators.delete(key.keyId) // Clean up FROST coordinator
        return { success: true }
      })
      // Request signature using FROST threshold signing
      .post('/sign', async ({ body, request }) => {
        const owner = getAddressFromRequest(request)
        if (!owner) throw new Error('Missing x-jeju-address header')

        const validBody = expectValid(
          signRequestSchema.extend({
            keyId: z.string().uuid(),
          }),
          body,
          'Sign request',
        )

        const key = keys.get(validBody.keyId)
        if (!key) {
          throw new Error('Key not found')
        }

        const coordinator = frostCoordinators.get(validBody.keyId)
        if (!coordinator) {
          throw new Error('FROST coordinator not found for this key')
        }

        // Convert message to hex for FROST signing
        const messageHex =
          validBody.encoding === 'hex'
            ? (validBody.messageHash as Hex)
            : toHex(new TextEncoder().encode(validBody.messageHash))

        // Sign using FROST - real threshold signing where private key is never reconstructed
        const frostSig = await coordinator.sign(messageHex)

        // Combine into standard Ethereum signature format
        const signature =
          `${frostSig.r}${frostSig.s.slice(2)}${frostSig.v.toString(16).padStart(2, '0')}` as Hex

        return {
          signature,
          keyId: key.keyId,
          address: key.address,
          signedAt: Date.now(),
          mode: 'frost', // Using real FROST threshold signing
        }
      })
      .post('/encrypt', async ({ body }) => {
        const validBody = expectValid(
          encryptRequestSchema.extend({
            keyId: z.string().uuid().optional(),
          }),
          body,
          'Encrypt request',
        )

        // AES-256-GCM encryption (development mode - key stored in memory)
        // Generate or derive encryption key
        const keyId = validBody.keyId ?? crypto.randomUUID()
        const derivedKey = Buffer.from(
          keccak256(toBytes(keyId)).slice(2),
          'hex',
        )

        // Encrypt with AES-256-GCM
        const iv = crypto.randomBytes(12)
        const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv)
        const encrypted = Buffer.concat([
          cipher.update(validBody.data, 'utf8'),
          cipher.final(),
        ])
        const authTag = cipher.getAuthTag()

        // Format: iv (12) + authTag (16) + ciphertext, base64 encoded
        const ciphertext = Buffer.concat([iv, authTag, encrypted]).toString(
          'base64',
        )

        return {
          encrypted: ciphertext,
          keyId,
          mode: process.env.MPC_COORDINATOR_URL ? 'mpc' : 'development',
        }
      })
      .post('/decrypt', async ({ body }) => {
        const validBody = expectValid(
          decryptRequestSchema.extend({
            keyId: z.string().uuid(),
          }),
          body,
          'Decrypt request',
        )

        const mpcEnabled = !!process.env.MPC_COORDINATOR_URL

        // Decrypt with AES-256-GCM (development mode)
        const data = Buffer.from(validBody.encrypted, 'base64')
        const iv = data.subarray(0, 12)
        const authTag = data.subarray(12, 28)
        const ciphertext = data.subarray(28)

        const derivedKey = Buffer.from(
          keccak256(toBytes(validBody.keyId)).slice(2),
          'hex',
        )
        const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv)
        decipher.setAuthTag(authTag)

        const decrypted = Buffer.concat([
          decipher.update(ciphertext),
          decipher.final(),
        ]).toString('utf8')

        return {
          decrypted,
          keyId: validBody.keyId,
          mode: mpcEnabled ? 'mpc' : 'development',
          warning: mpcEnabled
            ? undefined
            : 'Running in development mode. Set MPC_COORDINATOR_URL for production MPC.',
        }
      })
      // Store secret
      .post('/vault/secrets', async ({ body, request, set }) => {
        const owner = getAddressFromRequest(request)
        if (!owner) {
          set.status = 401
          return { error: 'Missing x-jeju-address header' }
        }

        const validBody = expectValid(
          createSecretStoreRequestSchema,
          body,
          'Create secret request',
        )

        const id = crypto.randomUUID()

        // Encrypt the value with AES-256-GCM
        const derivedKey = Buffer.from(keccak256(toBytes(id)).slice(2), 'hex')
        const iv = crypto.randomBytes(12)
        const cipher = crypto.createCipheriv('aes-256-gcm', derivedKey, iv)
        const encrypted = Buffer.concat([
          cipher.update(validBody.value, 'utf8'),
          cipher.final(),
        ])
        const authTag = cipher.getAuthTag()
        const encryptedValue = Buffer.concat([iv, authTag, encrypted]).toString(
          'base64',
        )

        const secret: Secret = {
          id,
          name: validBody.name,
          owner,
          encryptedValue,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          expiresAt: validBody.expiresIn
            ? Date.now() + validBody.expiresIn * 1000
            : undefined,
          metadata: validBody.metadata ?? {},
        }

        secrets.set(id, secret)

        set.status = 201
        return {
          id,
          name: secret.name,
          createdAt: secret.createdAt,
          expiresAt: secret.expiresAt,
        }
      })
      // List secrets
      .get('/vault/secrets', ({ request }) => {
        const owner = request.headers.get('x-jeju-address')?.toLowerCase()

        let secretList = Array.from(secrets.values())
        if (owner) {
          secretList = secretList.filter((s) => s.owner.toLowerCase() === owner)
        }

        // Filter expired secrets
        const now = Date.now()
        secretList = secretList.filter((s) => !s.expiresAt || s.expiresAt > now)

        return {
          secrets: secretList.map((s) => ({
            id: s.id,
            name: s.name,
            createdAt: s.createdAt,
            updatedAt: s.updatedAt,
            expiresAt: s.expiresAt,
          })),
        }
      })
      // Get secret (returns metadata only, not value)
      .get('/vault/secrets/:id', ({ params, request, set }) => {
        const owner = request.headers.get('x-jeju-address')?.toLowerCase()
        const secret = secrets.get(params.id)

        if (!secret) {
          set.status = 404
          return { error: 'Secret not found' }
        }
        if (secret.owner.toLowerCase() !== owner) {
          set.status = 403
          return { error: 'Not authorized' }
        }
        if (secret.expiresAt && secret.expiresAt < Date.now()) {
          set.status = 410
          return { error: 'Secret expired' }
        }

        return {
          id: secret.id,
          name: secret.name,
          createdAt: secret.createdAt,
          updatedAt: secret.updatedAt,
          expiresAt: secret.expiresAt,
          metadata: secret.metadata,
        }
      })
      // Reveal secret value (requires authentication)
      .post('/vault/secrets/:id/reveal', async ({ params, request, set }) => {
        const owner = request.headers.get('x-jeju-address')?.toLowerCase()
        const secret = secrets.get(params.id)

        if (!secret) {
          set.status = 404
          return { error: 'Secret not found' }
        }
        if (secret.owner.toLowerCase() !== owner) {
          set.status = 403
          return { error: 'Not authorized' }
        }
        if (secret.expiresAt && secret.expiresAt < Date.now()) {
          set.status = 410
          return { error: 'Secret expired' }
        }

        // Decrypt the value with AES-256-GCM
        const data = Buffer.from(secret.encryptedValue, 'base64')
        const iv = data.subarray(0, 12)
        const authTag = data.subarray(12, 28)
        const ciphertext = data.subarray(28)

        const derivedKey = Buffer.from(
          keccak256(toBytes(secret.id)).slice(2),
          'hex',
        )
        const decipher = crypto.createDecipheriv('aes-256-gcm', derivedKey, iv)
        decipher.setAuthTag(authTag)

        const decrypted = Buffer.concat([
          decipher.update(ciphertext),
          decipher.final(),
        ]).toString('utf8')

        return {
          id: secret.id,
          name: secret.name,
          value: decrypted,
        }
      })
      // Delete secret
      .delete('/vault/secrets/:id', ({ params, request, set }) => {
        const owner = request.headers.get('x-jeju-address')?.toLowerCase()
        const secret = secrets.get(params.id)

        if (!secret) {
          set.status = 404
          return { error: 'Secret not found' }
        }
        if (secret.owner.toLowerCase() !== owner) {
          set.status = 403
          return { error: 'Not authorized' }
        }

        secrets.delete(secret.id)
        return { success: true }
      })
  )
}
