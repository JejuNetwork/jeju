/**
 * Storage Routes - Multi-backend storage API
 *
 * Features:
 * - Content tiering (System, Popular, Private)
 * - Multi-backend selection (IPFS, Arweave, WebTorrent)
 * - Encryption support
 * - Popularity tracking
 * - Regional prefetching
 * - IPFS-compatible API
 */

import { getFormString, getFormStringOr } from '@jejunetwork/types'
import { Elysia, t } from 'elysia'
import { z } from 'zod'

// Generic JSON value schema for user-uploaded content
const JsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ])
)
import { extractClientRegion } from '../../shared/utils/common'
import type { BackendManager } from '../../storage/backends'
import { getMultiBackendManager } from '../../storage/multi-backend'
import type {
  ContentCategory,
  ContentTier,
  StorageBackendType,
} from '../../storage/types'

// Type-safe query param accessor
function getQueryInt(
  query: Record<string, string | undefined>,
  key: string,
  defaultVal: number,
): number {
  const val = query[key]
  return val !== undefined ? parseInt(val, 10) : defaultVal
}

export function createStorageRouter(backend?: BackendManager) {
  const storageManager = getMultiBackendManager()

  return (
    new Elysia({ prefix: '/storage' })
      // Health & Stats
      .get('/health', async () => {
        const backends = storageManager.listBackends()
        const health = await storageManager.healthCheck()
        const stats = storageManager.getNodeStats()

        return {
          service: 'dws-storage',
          status: 'healthy' as const,
          backends,
          health,
          stats,
        }
      })

      .get('/stats', () => storageManager.getNodeStats())

      // Upload with multipart form
      .post('/upload', async ({ body, set }) => {
        const formData = body as FormData
        const file = formData.get('file') as File | null

        if (!file) {
          set.status = 400
          return { error: 'No file provided' }
        }

        const tier = getFormStringOr(formData, 'tier', 'popular')
        const category = getFormStringOr(formData, 'category', 'data')
        const encrypt = formData.get('encrypt') === 'true'
        const permanent = formData.get('permanent') === 'true'
        const backendsStr = getFormString(formData, 'backends')
        const accessPolicy = getFormString(formData, 'accessPolicy')

        const content = Buffer.from(await file.arrayBuffer())
        const preferredBackends = backendsStr?.split(',').filter(Boolean) as
          | StorageBackendType[]
          | undefined

        const result = await storageManager.upload(content, {
          filename: file.name,
          tier: tier as ContentTier,
          category: category as ContentCategory,
          encrypt,
          preferredBackends,
          accessPolicy: accessPolicy ?? undefined,
        })

        if (permanent) {
          const permanentResult = await storageManager.uploadPermanent(
            content,
            {
              filename: file.name,
              tier: tier as ContentTier,
              category: category as ContentCategory,
            },
          )
          return permanentResult
        }

        return result
      })

      // Raw upload (simple body as content)
      .post('/upload/raw', async ({ request, query }) => {
        const filename = request.headers.get('x-filename') || 'upload'
        const tier = (query.tier as ContentTier) || 'popular'
        const category = (query.category as ContentCategory) || 'data'

        const content = Buffer.from(await request.arrayBuffer())

        // Use the simple backend if provided, otherwise use multi-backend
        if (backend) {
          const cid = await backend.upload(content, { filename })
          return { cid, size: content.length }
        }

        const result = await storageManager.upload(content, {
          filename,
          tier,
          category,
        })

        return result
      })

      // JSON upload
      .post(
        '/upload/json',
        async ({ body }) => {
          const { data, name, tier, category, encrypt } = body
          const content = Buffer.from(JSON.stringify(data))

          const result = await storageManager.upload(content, {
            filename: name ?? 'data.json',
            tier: (tier as ContentTier | undefined) ?? 'popular',
            category: (category as ContentCategory | undefined) ?? 'data',
            encrypt,
          })

          return result
        },
        {
          body: t.Object({
            data: t.Unknown(),
            name: t.Optional(t.String()),
            tier: t.Optional(t.String()),
            category: t.Optional(t.String()),
            encrypt: t.Optional(t.Boolean()),
          }),
        },
      )

      // Permanent upload
      .post('/upload/permanent', async ({ body, set }) => {
        const formData = body as FormData
        const file = formData.get('file') as File | null

        if (!file) {
          set.status = 400
          return { error: 'No file provided' }
        }

        const tier = getFormStringOr(formData, 'tier', 'popular')
        const category = getFormStringOr(formData, 'category', 'data')
        const content = Buffer.from(await file.arrayBuffer())

        const result = await storageManager.uploadPermanent(content, {
          filename: file.name,
          tier: tier as ContentTier,
          category: category as ContentCategory,
        })

        return result
      })

      // Download
      .get('/download/:cid', async ({ params, query, request, set }) => {
        const cid = params.cid
        const region = extractClientRegion(
          request.headers.get('x-region') ?? undefined,
          request.headers.get('cf-ipcountry') ?? undefined,
        )
        const decrypt = query.decrypt === 'true'
        const preferredBackend = query.backend as StorageBackendType | undefined

        // Use simple backend if provided
        if (backend) {
          const result = await backend.download(cid)
          if (!result) {
            set.status = 404
            return { error: 'Not found' }
          }
          const respContentType =
            'contentType' in result && typeof result.contentType === 'string'
              ? result.contentType
              : 'application/octet-stream'
          set.headers['Content-Type'] = respContentType
          return new Response(new Uint8Array(result.content))
        }

        const result = await storageManager.download(cid, {
          region,
          preferredBackends: preferredBackend ? [preferredBackend] : undefined,
          decryptionKeyId: decrypt
            ? (request.headers.get('x-decryption-key-id') ?? undefined)
            : undefined,
        })

        const metadata = result.metadata
        const contentType = metadata?.contentType ?? 'application/octet-stream'

        set.headers['Content-Type'] = contentType
        set.headers['Content-Length'] = String(result.content.length)
        set.headers['X-Backend'] = result.backend
        set.headers['X-Latency-Ms'] = String(result.latencyMs)
        set.headers['X-From-Cache'] = String(result.fromCache)
        if (metadata?.tier) {
          set.headers['X-Content-Tier'] = metadata.tier
        }

        return new Response(new Uint8Array(result.content))
      })

      // Download as JSON
      .get('/download/:cid/json', async ({ params, request, set }) => {
        const cid = params.cid
        const region = request.headers.get('x-region') ?? 'unknown'

        const result = await storageManager.download(cid, { region })

        if (!result) {
          set.status = 404
          return { error: 'Not found' }
        }

        return JsonValueSchema.parse(JSON.parse(result.content.toString('utf-8')))
      })

      // Get content metadata
      .get('/content/:cid', ({ params, set }) => {
        const cid = params.cid
        const metadata = storageManager.getMetadata(cid)

        if (!metadata) {
          set.status = 404
          return { error: 'Not found' }
        }

        return metadata
      })

      // List content
      .get('/content', ({ query }) => {
        const tier = query.tier as ContentTier | undefined
        const category = query.category as ContentCategory | undefined
        const limit = getQueryInt(query, 'limit', 100)
        const offset = getQueryInt(query, 'offset', 0)

        let items = tier
          ? storageManager.listByTier(tier)
          : category
            ? storageManager.listByCategory(category)
            : [
                ...storageManager.listByTier('system'),
                ...storageManager.listByTier('popular'),
                ...storageManager.listByTier('private'),
              ]

        const total = items.length
        items = items.slice(offset, offset + limit)

        return { items, total, limit, offset }
      })

      // Check if content exists
      .get('/exists/:cid', async ({ params }) => {
        const cid = params.cid

        // Use simple backend if provided
        if (backend) {
          const result = await backend.download(cid)
          return { cid, exists: !!result }
        }

        const exists = await storageManager.exists(cid)
        return { cid, exists }
      })

      // Popular content
      .get('/popular', ({ query }) => {
        const limit = getQueryInt(query, 'limit', 10)
        const popular = storageManager.getPopularContent(limit)
        return { items: popular }
      })

      // Underseeded content
      .get('/underseeded', ({ query }) => {
        const minSeeders = getQueryInt(query, 'min', 3)
        const underseeded = storageManager.getUnderseededContent(minSeeders)
        return { items: underseeded }
      })

      // Regional popularity
      .get('/regional/:region', ({ params }) => {
        const region = params.region
        const popularity = storageManager.getRegionalPopularity(region)
        return popularity
      })

      // WebTorrent info
      .get('/torrent/:cid', ({ params, set }) => {
        const cid = params.cid
        const metadata = storageManager.getMetadata(cid)

        if (!metadata || !metadata.addresses.magnetUri) {
          set.status = 404
          return { error: 'Torrent not found' }
        }

        return {
          cid,
          magnetUri: metadata.addresses.magnetUri,
          infoHash: metadata.addresses.cid,
          size: metadata.size,
          tier: metadata.tier,
        }
      })

      // Get magnet URI
      .get('/magnet/:cid', ({ params, set }) => {
        const cid = params.cid
        const metadata = storageManager.getMetadata(cid)

        if (!metadata || !metadata.addresses.magnetUri) {
          set.status = 404
          return { error: 'Magnet URI not found' }
        }

        set.headers['Content-Type'] = 'text/plain'
        return metadata.addresses.magnetUri
      })

      // Arweave content
      .get('/arweave/:txId', async ({ params, set }) => {
        const txId = params.txId

        const result = await storageManager.download(txId, {
          preferredBackends: ['arweave'],
        })

        if (!result) {
          set.status = 404
          return { error: 'Not found' }
        }

        const contentType =
          result.metadata?.contentType ?? 'application/octet-stream'

        set.headers['Content-Type'] = contentType
        set.headers['X-Arweave-Tx'] = txId

        return new Response(new Uint8Array(result.content))
      })

      // IPFS Compatibility - Add
      .post('/api/v0/add', async ({ body, set }) => {
        const formData = body as FormData
        const file = formData.get('file') as File | null

        if (!file) {
          set.status = 400
          return { error: 'No file provided' }
        }

        const content = Buffer.from(await file.arrayBuffer())
        const result = await storageManager.upload(content, {
          filename: file.name,
          tier: 'popular',
        })

        return {
          Hash: result.cid,
          Size: String(result.size),
          Name: file.name,
        }
      })

      // IPFS Compatibility - ID
      .post('/api/v0/id', async ({ set }) => {
        const health = await storageManager.healthCheck()
        const allHealthy = Object.values(health).every((h) => h)

        if (!allHealthy) {
          set.status = 503
          return { error: 'Storage backends unhealthy' }
        }

        const backends = storageManager.listBackends()

        return {
          ID: 'dws-storage',
          AgentVersion: 'dws/2.0.0',
          Addresses: [],
          Backends: backends,
        }
      })

      // IPFS Compatibility - Unpin
      .post('/api/v0/pin/rm', ({ query }) => {
        const arg = query.arg
        return { Pins: [arg] }
      })

      // IPFS path
      .get('/ipfs/:cid', async ({ params, request, set }) => {
        const cid = params.cid
        const region = request.headers.get('x-region') ?? 'unknown'

        const result = await storageManager.download(cid, { region })

        if (!result) {
          set.status = 404
          return { error: 'Not found' }
        }

        const contentType =
          result.metadata?.contentType ?? 'application/octet-stream'

        set.headers['Content-Type'] = contentType
        set.headers['X-Ipfs-Path'] = `/ipfs/${cid}`
        set.headers['X-Backend'] = result.backend

        return new Response(new Uint8Array(result.content))
      })
  )
}
