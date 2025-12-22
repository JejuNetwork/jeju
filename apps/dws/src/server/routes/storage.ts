/**
 * Storage Routes - Enhanced multi-backend storage API
 *
 * Features:
 * - Content tiering (System, Popular, Private)
 * - Multi-backend selection (IPFS, Arweave, WebTorrent)
 * - Encryption support
 * - Popularity tracking
 * - Regional prefetching
 * - IPFS-compatible API
 */

import { Elysia, t } from 'elysia'
import { extractClientRegion } from '../../shared/utils/common'
import { getMultiBackendManager } from '../../storage/multi-backend'
import type {
  ContentCategory,
  ContentTier,
  StorageBackendType,
} from '../../storage/types'

const contentTierValues = ['system', 'popular', 'private'] as const
const contentCategoryValues = ['data', 'media', 'code', 'document'] as const
const storageBackendValues = ['ipfs', 'arweave', 'webtorrent'] as const

export const storageRoutes = new Elysia({ name: 'storage', prefix: '/storage' })
  .decorate('storageManager', getMultiBackendManager())

  // Health & Stats
  .get('/health', async ({ storageManager }) => {
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

  .get('/stats', ({ storageManager }) => storageManager.getNodeStats())

  // Upload endpoints
  .post(
    '/upload',
    async ({ body, storageManager }) => {
      const {
        file,
        tier,
        category,
        encrypt,
        permanent,
        backends,
        accessPolicy,
      } = body

      const content = Buffer.from(await file.arrayBuffer())

      const preferredBackends = backends?.split(',').filter(Boolean) as
        | StorageBackendType[]
        | undefined

      const result = await storageManager.upload(content, {
        filename: file.name,
        contentType: file.type,
        tier: (tier || 'popular') as ContentTier,
        category: (category || 'data') as ContentCategory,
        encrypt: encrypt === 'true',
        preferredBackends,
        accessPolicy,
      })

      if (permanent === 'true') {
        const permanentResult = await storageManager.uploadPermanent(content, {
          filename: file.name,
          contentType: file.type,
          tier: (tier || 'popular') as ContentTier,
          category: (category || 'data') as ContentCategory,
        })
        return permanentResult
      }

      return result
    },
    {
      body: t.Object({
        file: t.File(),
        tier: t.Optional(t.Union(contentTierValues.map((v) => t.Literal(v)))),
        category: t.Optional(
          t.Union(contentCategoryValues.map((v) => t.Literal(v))),
        ),
        encrypt: t.Optional(t.String()),
        permanent: t.Optional(t.String()),
        backends: t.Optional(t.String()),
        accessPolicy: t.Optional(t.String()),
      }),
    },
  )

  .post('/upload/raw', () => {
    // Raw bytes upload requires multipart form
    return { message: 'Use multipart upload via /upload endpoint' }
  })

  .post(
    '/upload/json',
    async ({ body, storageManager }) => {
      const content = Buffer.from(JSON.stringify(body.data))

      const result = await storageManager.upload(content, {
        filename: body.name ?? 'data.json',
        contentType: 'application/json',
        tier: (body.tier ?? 'popular') as ContentTier,
        category: (body.category ?? 'data') as ContentCategory,
        encrypt: body.encrypt,
      })

      return result
    },
    {
      body: t.Object({
        data: t.Unknown(),
        name: t.Optional(t.String()),
        tier: t.Optional(t.Union(contentTierValues.map((v) => t.Literal(v)))),
        category: t.Optional(
          t.Union(contentCategoryValues.map((v) => t.Literal(v))),
        ),
        encrypt: t.Optional(t.Boolean()),
      }),
    },
  )

  .post(
    '/upload/permanent',
    async ({ body, storageManager }) => {
      const { file, tier, category } = body
      const content = Buffer.from(await file.arrayBuffer())

      const result = await storageManager.uploadPermanent(content, {
        filename: file.name,
        contentType: file.type,
        tier: (tier || 'popular') as ContentTier,
        category: (category || 'data') as ContentCategory,
      })

      return result
    },
    {
      body: t.Object({
        file: t.File(),
        tier: t.Optional(t.Union(contentTierValues.map((v) => t.Literal(v)))),
        category: t.Optional(
          t.Union(contentCategoryValues.map((v) => t.Literal(v))),
        ),
      }),
    },
  )

  // Download endpoints
  .get(
    '/download/:cid',
    async ({ params, query, headers, storageManager, set }) => {
      const region = extractClientRegion(
        headers['x-region'],
        headers['cf-ipcountry'],
      )
      const decrypt = query.decrypt === 'true'
      const preferredBackend = query.backend as StorageBackendType | undefined

      const result = await storageManager.download(params.cid, {
        region,
        preferredBackends: preferredBackend ? [preferredBackend] : undefined,
        decryptionKeyId: decrypt ? headers['x-decryption-key-id'] : undefined,
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

      return new Uint8Array(result.content)
    },
    {
      params: t.Object({
        cid: t.String({ minLength: 1 }),
      }),
      query: t.Object({
        backend: t.Optional(
          t.Union(storageBackendValues.map((v) => t.Literal(v))),
        ),
        decrypt: t.Optional(t.String()),
      }),
      headers: t.Object({
        'x-region': t.Optional(t.String()),
        'cf-ipcountry': t.Optional(t.String()),
        'x-decryption-key-id': t.Optional(t.String()),
      }),
    },
  )

  .get(
    '/download/:cid/json',
    async ({ params, headers, storageManager, set }) => {
      const region = headers['x-region'] ?? 'unknown'

      const result = await storageManager
        .download(params.cid, { region })
        .catch(() => null)

      if (!result) {
        set.status = 404
        return { error: 'Not found' }
      }

      return JSON.parse(result.content.toString('utf-8'))
    },
    {
      params: t.Object({
        cid: t.String({ minLength: 1 }),
      }),
      headers: t.Object({
        'x-region': t.Optional(t.String()),
      }),
    },
  )

  // Content Management
  .get(
    '/content/:cid',
    ({ params, storageManager, set }) => {
      const metadata = storageManager.getMetadata(params.cid)

      if (!metadata) {
        set.status = 404
        return { error: 'Not found' }
      }

      return metadata
    },
    {
      params: t.Object({
        cid: t.String({ minLength: 1 }),
      }),
    },
  )

  .get(
    '/content',
    ({ query, storageManager }) => {
      const tier = query.tier as ContentTier | undefined
      const category = query.category as ContentCategory | undefined
      const limit = parseInt(query.limit ?? '100', 10)
      const offset = parseInt(query.offset ?? '0', 10)

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
    },
    {
      query: t.Object({
        tier: t.Optional(t.Union(contentTierValues.map((v) => t.Literal(v)))),
        category: t.Optional(
          t.Union(contentCategoryValues.map((v) => t.Literal(v))),
        ),
        limit: t.Optional(t.String()),
        offset: t.Optional(t.String()),
      }),
    },
  )

  .get(
    '/exists/:cid',
    async ({ params, storageManager }) => {
      const exists = await storageManager.exists(params.cid)
      return { cid: params.cid, exists }
    },
    {
      params: t.Object({
        cid: t.String({ minLength: 1 }),
      }),
    },
  )

  // Popularity & Regional
  .get(
    '/popular',
    ({ query, storageManager }) => {
      const limit = parseInt(query.limit ?? '10', 10)
      const popular = storageManager.getPopularContent(limit)
      return { items: popular }
    },
    {
      query: t.Object({
        limit: t.Optional(t.String()),
      }),
    },
  )

  .get(
    '/underseeded',
    ({ query, storageManager }) => {
      const minSeeders = parseInt(query.min ?? '3', 10)
      const underseeded = storageManager.getUnderseededContent(minSeeders)
      return { items: underseeded }
    },
    {
      query: t.Object({
        min: t.Optional(t.String()),
      }),
    },
  )

  .get(
    '/regional/:region',
    ({ params, storageManager }) => {
      const popularity = storageManager.getRegionalPopularity(params.region)
      return popularity
    },
    {
      params: t.Object({
        region: t.String({ minLength: 1 }),
      }),
    },
  )

  // WebTorrent
  .get(
    '/torrent/:cid',
    ({ params, storageManager, set }) => {
      const metadata = storageManager.getMetadata(params.cid)

      if (!metadata || !metadata.addresses.magnetUri) {
        set.status = 404
        return { error: 'Torrent not found' }
      }

      return {
        cid: params.cid,
        magnetUri: metadata.addresses.magnetUri,
        infoHash: metadata.addresses.cid,
        size: metadata.size,
        tier: metadata.tier,
      }
    },
    {
      params: t.Object({
        cid: t.String({ minLength: 1 }),
      }),
    },
  )

  .get(
    '/magnet/:cid',
    ({ params, storageManager, set }) => {
      const metadata = storageManager.getMetadata(params.cid)

      if (!metadata || !metadata.addresses.magnetUri) {
        set.status = 404
        return { error: 'Magnet URI not found' }
      }

      set.headers['Content-Type'] = 'text/plain'
      return metadata.addresses.magnetUri
    },
    {
      params: t.Object({
        cid: t.String({ minLength: 1 }),
      }),
    },
  )

  // Arweave
  .get(
    '/arweave/:txId',
    async ({ params, storageManager, set }) => {
      const result = await storageManager
        .download(params.txId, {
          preferredBackends: ['arweave'],
        })
        .catch(() => null)

      if (!result) {
        set.status = 404
        return { error: 'Not found' }
      }

      const contentType =
        result.metadata?.contentType ?? 'application/octet-stream'

      set.headers['Content-Type'] = contentType
      set.headers['X-Arweave-Tx'] = params.txId

      return new Uint8Array(result.content)
    },
    {
      params: t.Object({
        txId: t.String({ minLength: 1 }),
      }),
    },
  )

  // IPFS Compatibility
  .post(
    '/api/v0/add',
    async ({ body, storageManager }) => {
      const { file } = body
      const content = Buffer.from(await file.arrayBuffer())
      const result = await storageManager.upload(content, {
        filename: file.name,
        contentType: file.type,
        tier: 'popular',
      })

      return {
        Hash: result.cid,
        Size: String(result.size),
        Name: file.name,
      }
    },
    {
      body: t.Object({
        file: t.File(),
      }),
    },
  )

  .post('/api/v0/id', async ({ storageManager, set }) => {
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

  .post(
    '/api/v0/pin/rm',
    ({ query }) => {
      return { Pins: [query.arg] }
    },
    {
      query: t.Object({
        arg: t.String({ minLength: 1 }),
      }),
    },
  )

  .get(
    '/ipfs/:cid',
    async ({ params, headers, storageManager, set }) => {
      const region = headers['x-region'] ?? 'unknown'

      const result = await storageManager
        .download(params.cid, { region })
        .catch(() => null)

      if (!result) {
        set.status = 404
        return { error: 'Not found' }
      }

      const contentType =
        result.metadata?.contentType ?? 'application/octet-stream'

      set.headers['Content-Type'] = contentType
      set.headers['X-Ipfs-Path'] = `/ipfs/${params.cid}`
      set.headers['X-Backend'] = result.backend

      return new Uint8Array(result.content)
    },
    {
      params: t.Object({
        cid: t.String({ minLength: 1 }),
      }),
      headers: t.Object({
        'x-region': t.Optional(t.String()),
      }),
    },
  )

export type StorageRoutes = typeof storageRoutes
