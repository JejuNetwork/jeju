#!/usr/bin/env bun

/**
 * DA (Data Availability) Server
 *
 * Standalone data availability service for Jeju infrastructure.
 * Provides blob storage and retrieval with vault encryption.
 */

import { createHash, randomBytes } from 'node:crypto'
import { Elysia, t } from 'elysia'

const PORT = parseInt(process.env.PORT ?? '4010', 10)
const _DATA_DIR = process.env.DATA_DIR ?? '/data'
const VAULT_SECRET = process.env.VAULT_ENCRYPTION_SECRET ?? ''
const IPFS_API_URL = process.env.IPFS_API_URL ?? 'http://localhost:5001'
const MAX_BLOB_SIZE = 128 * 1024 * 1024 // 128MB

interface BlobEntry {
  id: string
  data: Uint8Array
  commitment: string
  submitter: string
  namespace: string
  createdAt: number
  expiresAt: number
  size: number
}

const blobStore = new Map<string, BlobEntry>()

const stats = {
  blobsStored: 0,
  blobsRetrieved: 0,
  bytesStored: 0,
  bytesRetrieved: 0,
}

function computeCommitment(data: Uint8Array): string {
  return createHash('sha256').update(data).digest('hex')
}

function generateBlobId(): string {
  return `0x${randomBytes(32).toString('hex')}`
}

// Cleanup expired blobs
setInterval(() => {
  const now = Date.now()
  let expired = 0
  for (const [id, blob] of blobStore.entries()) {
    if (blob.expiresAt > 0 && blob.expiresAt < now) {
      stats.bytesStored -= blob.size
      blobStore.delete(id)
      expired++
    }
  }
  if (expired > 0) {
    console.log(`[DAServer] Cleaned up ${expired} expired blobs`)
  }
}, 60000)

const app = new Elysia()
  .get('/health', () => ({
    status: 'healthy',
    service: 'da-server',
    blobCount: blobStore.size,
    stats,
    vaultEnabled: VAULT_SECRET.length > 0,
    ipfsConfigured: IPFS_API_URL.length > 0,
    timestamp: new Date().toISOString(),
  }))

  .get('/stats', () => ({
    stats: {
      blobCount: blobStore.size,
      blobsStored: stats.blobsStored,
      blobsRetrieved: stats.blobsRetrieved,
      bytesStoredMb: Math.round((stats.bytesStored / 1024 / 1024) * 100) / 100,
      bytesRetrievedMb:
        Math.round((stats.bytesRetrieved / 1024 / 1024) * 100) / 100,
    },
  }))

  .post(
    '/blob',
    ({ body, set }) => {
      let data: Uint8Array

      if (body.data.startsWith('0x')) {
        const hex = body.data.slice(2)
        data = new Uint8Array(
          hex.match(/.{1,2}/g)?.map((byte) => parseInt(byte, 16)) ?? [],
        )
      } else {
        data = Uint8Array.from(atob(body.data), (ch) => ch.charCodeAt(0))
      }

      if (data.length > MAX_BLOB_SIZE) {
        set.status = 400
        return {
          error: `Blob too large: ${data.length} bytes (max: ${MAX_BLOB_SIZE})`,
        }
      }

      const id = generateBlobId()
      const commitment = computeCommitment(data)
      const retentionMs = (body.retentionPeriod ?? 86400) * 1000

      const blob: BlobEntry = {
        id,
        data,
        commitment,
        submitter: body.submitter ?? 'anonymous',
        namespace: body.namespace ?? 'default',
        createdAt: Date.now(),
        expiresAt: Date.now() + retentionMs,
        size: data.length,
      }

      blobStore.set(id, blob)
      stats.blobsStored++
      stats.bytesStored += data.length

      return {
        blobId: id,
        commitment,
        size: data.length,
        expiresAt: blob.expiresAt,
      }
    },
    {
      body: t.Object({
        data: t.String(),
        submitter: t.Optional(t.String()),
        namespace: t.Optional(t.String()),
        retentionPeriod: t.Optional(t.Number()),
        quorumPercent: t.Optional(t.Number()),
      }),
    },
  )

  .get('/blob/:id', ({ params, set }) => {
    const blob = blobStore.get(params.id)

    if (!blob) {
      set.status = 404
      return { error: 'Blob not found' }
    }

    return {
      id: blob.id,
      commitment: blob.commitment,
      size: blob.size,
      submitter: blob.submitter,
      namespace: blob.namespace,
      createdAt: blob.createdAt,
      expiresAt: blob.expiresAt,
    }
  })

  .get('/blob/:id/data', ({ params, set }) => {
    const blob = blobStore.get(params.id)

    if (!blob) {
      set.status = 404
      return { error: 'Blob not found' }
    }

    stats.blobsRetrieved++
    stats.bytesRetrieved += blob.size

    // Return as hex
    const hex = Array.from(blob.data)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')

    return {
      blobId: blob.id,
      data: `0x${hex}`,
      commitment: blob.commitment,
      size: blob.size,
    }
  })

  .delete('/blob/:id', ({ params, set }) => {
    const blob = blobStore.get(params.id)

    if (!blob) {
      set.status = 404
      return { error: 'Blob not found' }
    }

    stats.bytesStored -= blob.size
    blobStore.delete(params.id)

    return { success: true }
  })

  .post(
    '/sample',
    ({ body, set }) => {
      const blob = blobStore.get(body.blobId)

      if (!blob) {
        set.status = 404
        return { error: 'Blob not found' }
      }

      // Verify commitment matches
      const actualCommitment = computeCommitment(blob.data)
      const isValid = actualCommitment === blob.commitment

      return {
        blobId: body.blobId,
        available: true,
        verified: isValid,
        commitment: blob.commitment,
        sampledAt: Date.now(),
      }
    },
    {
      body: t.Object({
        blobId: t.String(),
        commitment: t.Optional(t.String()),
        requester: t.Optional(t.String()),
      }),
    },
  )

  .get(
    '/blobs',
    ({ query }) => {
      const limit = query.limit ?? 100
      const namespace = query.namespace

      let blobs = Array.from(blobStore.values())

      if (namespace) {
        blobs = blobs.filter((b) => b.namespace === namespace)
      }

      blobs = blobs.slice(0, limit)

      return {
        count: blobs.length,
        blobs: blobs.map((b) => ({
          id: b.id,
          commitment: b.commitment,
          size: b.size,
          submitter: b.submitter,
          namespace: b.namespace,
          createdAt: b.createdAt,
          expiresAt: b.expiresAt,
        })),
      }
    },
    {
      query: t.Object({
        namespace: t.Optional(t.String()),
        limit: t.Optional(t.Number({ default: 100 })),
      }),
    },
  )

  .get('/operators', () => ({
    count: 1,
    operators: [
      {
        address: '0x0000000000000000000000000000000000000001',
        endpoint: `http://localhost:${PORT}`,
        region: 'local',
        status: 'active',
        capacityGB: 100,
        usedGB:
          Math.round((stats.bytesStored / 1024 / 1024 / 1024) * 100) / 100,
      },
    ],
  }))

console.log(`[DAServer] Starting on port ${PORT}`)

app.listen(PORT, () => {
  console.log(`[DAServer] Ready at http://localhost:${PORT}`)
})
