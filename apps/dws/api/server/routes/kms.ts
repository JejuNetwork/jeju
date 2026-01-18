/**
 * KMS API Routes
 * Key Management Service integration for DWS
 *
 * Uses FROST threshold signing from @jejunetwork/kms.
 * In-process MPC for testnet, distributed parties for mainnet.
 */

import { getSQLit, type SQLitClient } from '@jejunetwork/db'
import { FROSTCoordinator } from '@jejunetwork/kms'
import { decryptAesGcm, encryptAesGcm, randomUUID } from '@jejunetwork/shared'
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
import {
  getAddressFromRequest,
  parseAddress,
} from '../../shared/utils/type-guards'

// MPC Configuration
const MPC_CONFIG = {
  defaultThreshold: 2,
  defaultParties: 3,
  minStake: BigInt(100),
  sessionTimeout: 300000, // 5 minutes
  maxConcurrentSessions: 100,
}

// Determine network
const NETWORK = (process.env.NETWORK ??
  process.env.JEJU_NETWORK ??
  'localnet') as 'localnet' | 'testnet' | 'mainnet'

const SQLIT_DATABASE_ID = process.env.SQLIT_DATABASE_ID ?? 'dws'

let sqlitClient: SQLitClient | null = null
let tablesInitialized = false

async function getSQLitClient(): Promise<SQLitClient> {
  if (!sqlitClient) {
    sqlitClient = getSQLit({
      databaseId: SQLIT_DATABASE_ID,
      timeoutMs: 30000,
      debug: process.env.NODE_ENV !== 'production',
    })
    const healthy = await sqlitClient.isHealthy()
    if (!healthy) {
      throw new Error('[KMS] SQLit is required for vault storage')
    }
    await ensureTablesExist()
  }
  return sqlitClient
}

async function ensureTablesExist(): Promise<void> {
  if (tablesInitialized) return
  const client = sqlitClient
  if (!client) return

  const tables = [
    `CREATE TABLE IF NOT EXISTS kms_secrets (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      owner TEXT NOT NULL,
      encrypted_value TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER,
      metadata TEXT
    )`,
    `CREATE INDEX IF NOT EXISTS idx_kms_secrets_owner ON kms_secrets(owner)`,
    `CREATE INDEX IF NOT EXISTS idx_kms_secrets_name ON kms_secrets(name)`,
  ]
  for (const ddl of tables) {
    await client.exec(ddl, [], SQLIT_DATABASE_ID)
  }
  tablesInitialized = true
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

interface SecretRow {
  id: string
  name: string
  owner: string
  encrypted_value: string
  created_at: number
  updated_at: number
  expires_at: number | null
  metadata: string | null
}

const RevealByNameSchema = z.object({
  name: z.string().min(1),
})

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

const serviceKeyIndex = new Map<string, string>()

const serviceKeyRequestSchema = z.object({
  serviceId: z.string().min(1),
  action: z.enum(['get-or-create']).optional(),
  threshold: z.number().int().min(2).optional(),
  totalParties: z.number().int().positive().optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  acknowledgeInsecureCentralized: z.boolean().optional(),
})

const createKeyRequestSchema = z.union([
  createKmsKeyRequestSchema.extend({
    threshold: z.number().int().min(2).optional(),
    totalParties: z.number().int().positive().optional(),
    metadata: z.record(z.string(), z.string()).optional(),
    acknowledgeInsecureCentralized: z.boolean().optional(),
  }),
  serviceKeyRequestSchema,
])

function getOwnerFromRequest(request: Request): Address | null {
  const owner = getAddressFromRequest(request)
  if (owner) return owner
  const serviceId = request.headers.get('x-service-id')
  if (!serviceId) return null
  const hash = keccak256(toBytes(serviceId))
  const candidate = `0x${hash.slice(-40)}`
  return parseAddress(candidate)
}

export function createKMSRouter() {
  return (
    new Elysia({ name: 'kms', prefix: '/kms' })
      .get('/health', () => {
        const activeSessions = Array.from(signingSessions.values()).filter(
          (s) => s.status === 'pending' || s.status === 'signing',
        ).length
        return {
          healthy: true,
          status: 'healthy',
          service: 'dws-kms',
          mode: 'frost',
          network: NETWORK,
          keys: keys.size,
          secrets: secrets.size,
          activeSessions,
          config: {
            threshold: MPC_CONFIG.defaultThreshold,
            parties: MPC_CONFIG.defaultParties,
          },
        }
      })
      // Generate new MPC key using FROST threshold signing
      .post('/keys', async ({ body, request, set }) => {
        const owner = getOwnerFromRequest(request)
        if (!owner) {
          throw new Error('Missing x-jeju-address or x-service-id header')
        }

        const validBody = expectValid(
          createKeyRequestSchema,
          body,
          'Create KMS key request',
        )

        const serviceId = 'serviceId' in validBody ? validBody.serviceId : null
        if (serviceId) {
          const existingKeyId = serviceKeyIndex.get(serviceId)
          if (existingKeyId) {
            const existingKey = keys.get(existingKeyId)
            if (existingKey) {
              return {
                keyId: existingKey.keyId,
                publicKey: existingKey.publicKey,
                address: existingKey.address,
                threshold: existingKey.threshold,
                totalParties: existingKey.totalParties,
                createdAt: existingKey.createdAt,
                mode: 'frost',
              }
            }
            serviceKeyIndex.delete(serviceId)
          }
        }

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

        const keyId = randomUUID()

        // Auto-acknowledge insecure centralized for non-mainnet
        const ackInsecure =
          validBody.acknowledgeInsecureCentralized ?? NETWORK !== 'mainnet'

        // Create FROST coordinator for threshold signing
        const coordinator = new FROSTCoordinator(
          keyId,
          threshold,
          totalParties,
          {
            network: NETWORK,
            acknowledgeInsecureCentralized: ackInsecure,
          },
        )
        const cluster = await coordinator.initializeCluster()

        // Store the coordinator for signing operations
        frostCoordinators.set(keyId, coordinator)

        const metadata = validBody.metadata ? { ...validBody.metadata } : {}
        if (serviceId) {
          metadata.serviceId = serviceId
        }

        const key: StoredKey = {
          keyId,
          owner,
          publicKey: cluster.groupPublicKey,
          address: cluster.groupAddress,
          threshold,
          totalParties,
          createdAt: Date.now(),
          version: 1,
          metadata,
        }

        keys.set(keyId, key)
        if (serviceId) {
          serviceKeyIndex.set(serviceId, keyId)
        }

        set.status = 201
        return {
          keyId,
          publicKey: key.publicKey,
          address: key.address,
          threshold,
          totalParties,
          createdAt: key.createdAt,
          mode: 'frost',
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
        const owner = getOwnerFromRequest(request)
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
        const owner = getOwnerFromRequest(request)
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
        const owner = getOwnerFromRequest(request)
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

        // Sign using FROST threshold signing
        const frostSig = await coordinator.sign(messageHex)

        // Combine into standard Ethereum signature format
        const signature =
          `${frostSig.r}${frostSig.s.slice(2)}${frostSig.v.toString(16).padStart(2, '0')}` as Hex

        return {
          signature,
          keyId: key.keyId,
          address: key.address,
          signedAt: Date.now(),
          mode: 'frost',
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
        const keyId = validBody.keyId ?? randomUUID()
        const derivedKey = new Uint8Array(
          Buffer.from(keccak256(toBytes(keyId)).slice(2), 'hex'),
        )

        // Encrypt with AES-256-GCM
        const plaintext = new TextEncoder().encode(validBody.data)
        const {
          ciphertext: encrypted,
          iv,
          tag: authTag,
        } = await encryptAesGcm(plaintext, derivedKey)

        // Format: iv (12) + authTag (16) + ciphertext, base64 encoded
        const combined = new Uint8Array(
          iv.length + authTag.length + encrypted.length,
        )
        combined.set(iv, 0)
        combined.set(authTag, iv.length)
        combined.set(encrypted, iv.length + authTag.length)
        const ciphertext = btoa(String.fromCharCode(...combined))

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
        const data = new Uint8Array(
          atob(validBody.encrypted)
            .split('')
            .map((c) => c.charCodeAt(0)),
        )
        const iv = data.subarray(0, 12)
        const authTag = data.subarray(12, 28)
        const ciphertext = data.subarray(28)

        const derivedKey = new Uint8Array(
          Buffer.from(keccak256(toBytes(validBody.keyId)).slice(2), 'hex'),
        )
        const decryptedBytes = await decryptAesGcm(
          ciphertext,
          derivedKey,
          iv,
          authTag,
        )
        const decrypted = new TextDecoder().decode(decryptedBytes)

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
        const owner = getOwnerFromRequest(request)
        if (!owner) {
          set.status = 401
          return { error: 'Missing x-jeju-address header' }
        }

        const validBody = expectValid(
          createSecretStoreRequestSchema,
          body,
          'Create secret request',
        )

        const id = randomUUID()

        // Encrypt the value with AES-256-GCM
        const derivedKey = new Uint8Array(
          Buffer.from(keccak256(toBytes(id)).slice(2), 'hex'),
        )
        const plaintext = new TextEncoder().encode(validBody.value)
        const {
          ciphertext: encrypted,
          iv,
          tag: authTag,
        } = await encryptAesGcm(plaintext, derivedKey)
        const combined = new Uint8Array(
          iv.length + authTag.length + encrypted.length,
        )
        combined.set(iv, 0)
        combined.set(authTag, iv.length)
        combined.set(encrypted, iv.length + authTag.length)
        const encryptedValue = btoa(String.fromCharCode(...combined))

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

        const client = await getSQLitClient()
        await client.exec(
          `INSERT INTO kms_secrets (id, name, owner, encrypted_value, created_at, updated_at, expires_at, metadata)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            secret.id,
            secret.name,
            secret.owner.toLowerCase(),
            secret.encryptedValue,
            secret.createdAt,
            secret.updatedAt,
            secret.expiresAt ?? null,
            JSON.stringify(secret.metadata),
          ],
          SQLIT_DATABASE_ID,
        )
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
        return (async () => {
          const owner = getOwnerFromRequest(request)?.toLowerCase() ?? null
          const client = await getSQLitClient()
          const rows = await client.query<SecretRow>(
            owner
              ? 'SELECT * FROM kms_secrets WHERE owner = ? ORDER BY created_at DESC'
              : 'SELECT * FROM kms_secrets ORDER BY created_at DESC',
            owner ? [owner] : [],
            SQLIT_DATABASE_ID,
          )
          const now = Date.now()
          const secretList = rows.rows.filter(
            (s) => !s.expires_at || s.expires_at > now,
          )
          return {
            secrets: secretList.map((s) => ({
              id: s.id,
              name: s.name,
              createdAt: s.created_at,
              updatedAt: s.updated_at,
              expiresAt: s.expires_at ?? undefined,
            })),
          }
        })()
      })
      // Get secret (returns metadata only, not value)
      .get('/vault/secrets/:id', ({ params, request, set }) => {
        return (async () => {
          const owner = getOwnerFromRequest(request)?.toLowerCase() ?? null
          const client = await getSQLitClient()
          const rows = await client.query<SecretRow>(
            'SELECT * FROM kms_secrets WHERE id = ? LIMIT 1',
            [params.id],
            SQLIT_DATABASE_ID,
          )
          const secret = rows.rows[0]
          if (!secret) {
            set.status = 404
            return { error: 'Secret not found' }
          }
          if (!owner || secret.owner.toLowerCase() !== owner) {
            set.status = 403
            return { error: 'Not authorized' }
          }
          if (secret.expires_at && secret.expires_at < Date.now()) {
            set.status = 410
            return { error: 'Secret expired' }
          }
          return {
            id: secret.id,
            name: secret.name,
            createdAt: secret.created_at,
            updatedAt: secret.updated_at,
            expiresAt: secret.expires_at ?? undefined,
            metadata: secret.metadata ? JSON.parse(secret.metadata) : {},
          }
        })()
      })
      // Reveal secret value (requires authentication)
      .post('/vault/secrets/:id/reveal', async ({ params, request, set }) => {
        const owner = getOwnerFromRequest(request)?.toLowerCase() ?? null
        const client = await getSQLitClient()
        const rows = await client.query<SecretRow>(
          'SELECT * FROM kms_secrets WHERE id = ? LIMIT 1',
          [params.id],
          SQLIT_DATABASE_ID,
        )
        const secret = rows.rows[0]

        if (!secret) {
          set.status = 404
          return { error: 'Secret not found' }
        }
        if (!owner || secret.owner.toLowerCase() !== owner) {
          set.status = 403
          return { error: 'Not authorized' }
        }
        if (secret.expires_at && secret.expires_at < Date.now()) {
          set.status = 410
          return { error: 'Secret expired' }
        }

        // Decrypt the value with AES-256-GCM
        const data = new Uint8Array(
          atob(secret.encrypted_value)
            .split('')
            .map((c) => c.charCodeAt(0)),
        )
        const iv = data.subarray(0, 12)
        const authTag = data.subarray(12, 28)
        const ciphertext = data.subarray(28)

        const derivedKey = new Uint8Array(
          Buffer.from(keccak256(toBytes(secret.id)).slice(2), 'hex'),
        )
        const decryptedBytes = await decryptAesGcm(
          ciphertext,
          derivedKey,
          iv,
          authTag,
        )
        const decrypted = new TextDecoder().decode(decryptedBytes)

        return {
          id: secret.id,
          name: secret.name,
          value: decrypted,
        }
      })
      .post('/vault/secrets/reveal', async ({ body, request, set }) => {
        const owner = getOwnerFromRequest(request)?.toLowerCase() ?? null
        if (!owner) {
          set.status = 401
          return { error: 'Missing x-jeju-address or x-service-id header' }
        }

        const parsed = RevealByNameSchema.safeParse(body)
        if (!parsed.success) {
          set.status = 400
          return { error: 'Invalid request', details: parsed.error.issues }
        }

        const client = await getSQLitClient()
        const rows = await client.query<SecretRow>(
          'SELECT * FROM kms_secrets WHERE name = ? AND owner = ? ORDER BY updated_at DESC LIMIT 1',
          [parsed.data.name, owner],
          SQLIT_DATABASE_ID,
        )
        const secret = rows.rows[0]
        if (!secret) {
          set.status = 404
          return { error: 'Secret not found' }
        }
        if (secret.expires_at && secret.expires_at < Date.now()) {
          set.status = 410
          return { error: 'Secret expired' }
        }

        const data = new Uint8Array(
          atob(secret.encrypted_value)
            .split('')
            .map((c) => c.charCodeAt(0)),
        )
        const iv = data.subarray(0, 12)
        const authTag = data.subarray(12, 28)
        const ciphertext = data.subarray(28)

        const derivedKey = new Uint8Array(
          Buffer.from(keccak256(toBytes(secret.id)).slice(2), 'hex'),
        )
        const decryptedBytes = await decryptAesGcm(
          ciphertext,
          derivedKey,
          iv,
          authTag,
        )
        const decrypted = new TextDecoder().decode(decryptedBytes)

        return {
          id: secret.id,
          name: secret.name,
          value: decrypted,
        }
      })
      // Delete secret
      .delete('/vault/secrets/:id', ({ params, request, set }) => {
        return (async () => {
          const owner = getOwnerFromRequest(request)?.toLowerCase() ?? null
          const client = await getSQLitClient()
          const rows = await client.query<SecretRow>(
            'SELECT * FROM kms_secrets WHERE id = ? LIMIT 1',
            [params.id],
            SQLIT_DATABASE_ID,
          )
          const secret = rows.rows[0]
          if (!secret) {
            set.status = 404
            return { error: 'Secret not found' }
          }
          if (!owner || secret.owner.toLowerCase() !== owner) {
            set.status = 403
            return { error: 'Not authorized' }
          }
          await client.exec(
            'DELETE FROM kms_secrets WHERE id = ?',
            [params.id],
            SQLIT_DATABASE_ID,
          )
          secrets.delete(secret.id)
          return { success: true }
        })()
      })
  )
}
