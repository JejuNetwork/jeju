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

import { Hono } from 'hono'
import {
  cidSchema,
  expectValid,
  regionHeaderSchema,
  validateHeaders,
  validateParams,
  validateQuery,
  z,
} from '../../shared'
import {
  contentCategorySchema,
  contentTierSchema,
  popularContentQuerySchema,
  regionalParamsSchema,
  storageBackendTypeSchema,
  torrentParamsSchema,
} from '../../shared/schemas/storage'
import { extractClientRegion } from '../../shared/utils/common'
import { getMultiBackendManager } from '../../storage/multi-backend'
import type {
  ContentCategory,
  ContentTier,
  StorageBackendType,
} from '../../storage/types'

export function createStorageRouter(): Hono {
  const router = new Hono()
  const manager = getMultiBackendManager()

  // ============================================================================
  // Health & Stats
  // ============================================================================

  router.get('/health', async (c) => {
    const backends = manager.listBackends()
    const health = await manager.healthCheck()
    const stats = manager.getNodeStats()

    return c.json({
      service: 'dws-storage',
      status: 'healthy',
      backends,
      health,
      stats,
    })
  })

  router.get('/stats', async (c) => {
    const stats = manager.getNodeStats()
    return c.json(stats)
  })

  // ============================================================================
  // Upload
  // ============================================================================

  router.post('/upload', async (c) => {
    const formData = await c.req.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      throw new Error('file required')
    }

    const content = Buffer.from(await file.arrayBuffer())

    // Parse and validate options from form
    const tierRaw = formData.get('tier')
    const tier = tierRaw ? expectValid(contentTierSchema, tierRaw) : 'popular'
    const categoryRaw = formData.get('category')
    const category = categoryRaw
      ? expectValid(contentCategorySchema, categoryRaw)
      : 'data'
    const encrypt = formData.get('encrypt') === 'true'
    const permanent = formData.get('permanent') === 'true'
    const backendsStr = formData.get('backends') as string | null
    const preferredBackends = backendsStr
      ?.split(',')
      .filter(Boolean)
      .map((b) => expectValid(storageBackendTypeSchema, b)) as
      | StorageBackendType[]
      | undefined
    const accessPolicy = formData.get('accessPolicy') as string | undefined

    const result = await manager.upload(content, {
      filename: file.name,
      contentType: file.type,
      tier,
      category,
      encrypt,
      preferredBackends,
      accessPolicy,
    })

    // Also upload to Arweave if permanent
    if (permanent) {
      const permanentResult = await manager.uploadPermanent(content, {
        filename: file.name,
        contentType: file.type,
        tier,
        category,
      })
      return c.json(permanentResult)
    }

    return c.json(result)
  })

  router.post('/upload/raw', async (c) => {
    const body = await c.req.arrayBuffer()
    const content = Buffer.from(body)
    const { 'x-filename': filename } = validateHeaders(
      z.object({ 'x-filename': z.string().optional() }),
      c,
    )

    const tierRaw = c.req.header('x-tier')
    const tier = tierRaw ? expectValid(contentTierSchema, tierRaw) : 'popular'
    const categoryRaw = c.req.header('x-category')
    const category = categoryRaw
      ? expectValid(contentCategorySchema, categoryRaw)
      : 'data'

    const result = await manager.upload(content, {
      filename: filename || 'file',
      tier,
      category,
    })

    return c.json({ ...result, size: content.length })
  })

  router.post('/upload/json', async (c) => {
    const body = (await c.req.json()) as {
      data: object
      tier?: ContentTier
      category?: ContentCategory
      name?: string
      encrypt?: boolean
    }

    const content = Buffer.from(JSON.stringify(body.data))

    const result = await manager.upload(content, {
      filename: body.name ?? 'data.json',
      contentType: 'application/json',
      tier: body.tier ?? 'popular',
      category: body.category ?? 'data',
      encrypt: body.encrypt,
    })

    return c.json(result)
  })

  router.post('/upload/permanent', async (c) => {
    const formData = await c.req.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      throw new Error('file required')
    }

    const content = Buffer.from(await file.arrayBuffer())
    const tierRaw = formData.get('tier')
    const tier = tierRaw ? expectValid(contentTierSchema, tierRaw) : 'popular'
    const categoryRaw = formData.get('category')
    const category = categoryRaw
      ? expectValid(contentCategorySchema, categoryRaw)
      : 'data'

    const result = await manager.uploadPermanent(content, {
      filename: file.name,
      contentType: file.type,
      tier,
      category,
    })

    return c.json(result)
  })

  // ============================================================================
  // Download
  // ============================================================================

  router.get('/download/:cid', async (c) => {
    const { cid } = validateParams(z.object({ cid: cidSchema }), c)
    const { 'x-region': xRegion, 'cf-ipcountry': cfIpCountry } =
      validateHeaders(regionHeaderSchema, c)
    const region = extractClientRegion(xRegion, cfIpCountry)
    const { backend: preferredBackend, decrypt: decryptStr } = validateQuery(
      z.object({
        backend: z.enum(['ipfs', 'arweave', 'webtorrent']).optional(),
        decrypt: z.string().optional(),
      }),
      c,
    )
    const decrypt = decryptStr === 'true'
    const { 'x-decryption-key-id': decryptionKeyId } = validateHeaders(
      z.object({ 'x-decryption-key-id': z.string().optional() }),
      c,
    )

    const result = await manager
      .download(cid, {
        region,
        preferredBackends: preferredBackend ? [preferredBackend] : undefined,
        decryptionKeyId: decrypt ? decryptionKeyId : undefined,
      })
      .catch((_e: Error) => {
        throw new Error('Not found')
      })

    const metadata = result.metadata
    const contentType = metadata?.contentType ?? 'application/octet-stream'

    return new Response(new Uint8Array(result.content), {
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(result.content.length),
        'X-Backend': result.backend,
        'X-Latency-Ms': String(result.latencyMs),
        'X-From-Cache': String(result.fromCache),
        ...(metadata?.tier && { 'X-Content-Tier': metadata.tier }),
      },
    })
  })

  router.get('/download/:cid/json', async (c) => {
    const { cid } = validateParams(z.object({ cid: cidSchema }), c)
    const region = c.req.header('x-region') ?? 'unknown'

    const result = await manager
      .download(cid, { region })
      .catch((e: Error) => ({ error: e.message }))

    if ('error' in result) {
      return c.json({ error: 'Not found' }, 404)
    }

    const data = JSON.parse(result.content.toString('utf-8'))
    return c.json(data)
  })

  // ============================================================================
  // Content Management
  // ============================================================================

  router.get('/content/:cid', async (c) => {
    const { cid } = validateParams(z.object({ cid: cidSchema }), c)
    const metadata = manager.getMetadata(cid)

    if (!metadata) {
      throw new Error('Not found')
    }

    return c.json(metadata)
  })

  router.get('/content', async (c) => {
    const tier = c.req.query('tier') as ContentTier | undefined
    const category = c.req.query('category') as ContentCategory | undefined
    const limit = parseInt(c.req.query('limit') ?? '100', 10)
    const offset = parseInt(c.req.query('offset') ?? '0', 10)

    let items = tier
      ? manager.listByTier(tier)
      : category
        ? manager.listByCategory(category)
        : [
            ...manager.listByTier('system'),
            ...manager.listByTier('popular'),
            ...manager.listByTier('private'),
          ]

    const total = items.length
    items = items.slice(offset, offset + limit)

    return c.json({ items, total, limit, offset })
  })

  router.get('/exists/:cid', async (c) => {
    const { cid } = validateParams(z.object({ cid: cidSchema }), c)
    const exists = await manager.exists(cid)
    return c.json({ cid, exists })
  })

  // ============================================================================
  // Popularity & Regional
  // ============================================================================

  router.get('/popular', async (c) => {
    const { limit } = validateQuery(popularContentQuerySchema, c)
    const popular = manager.getPopularContent(limit)
    return c.json({ items: popular })
  })

  router.get('/underseeded', async (c) => {
    const minSeeders = parseInt(c.req.query('min') ?? '3', 10)
    const underseeded = manager.getUnderseededContent(minSeeders)
    return c.json({ items: underseeded })
  })

  router.get('/regional/:region', async (c) => {
    const { region } = validateParams(regionalParamsSchema, c)
    const popularity = manager.getRegionalPopularity(region)
    return c.json(popularity)
  })

  // ============================================================================
  // WebTorrent
  // ============================================================================

  router.get('/torrent/:cid', async (c) => {
    const cid = c.req.param('cid')
    const metadata = manager.getMetadata(cid)

    if (!metadata || !metadata.addresses.magnetUri) {
      return c.json({ error: 'Torrent not found' }, 404)
    }

    return c.json({
      cid,
      magnetUri: metadata.addresses.magnetUri,
      infoHash: metadata.addresses.cid,
      size: metadata.size,
      tier: metadata.tier,
    })
  })

  router.get('/magnet/:cid', async (c) => {
    const { cid } = validateParams(torrentParamsSchema, c)
    const metadata = manager.getMetadata(cid)

    if (!metadata || !metadata.addresses.magnetUri) {
      throw new Error('Magnet URI not found')
    }

    // Return magnet URI as text for easy copy
    c.header('Content-Type', 'text/plain')
    return c.text(metadata.addresses.magnetUri)
  })

  // ============================================================================
  // Arweave
  // ============================================================================

  router.get('/arweave/:txId', async (c) => {
    const txId = c.req.param('txId')

    const result = await manager
      .download(txId, {
        preferredBackends: ['arweave'],
      })
      .catch((e: Error) => ({ error: e.message }))

    if ('error' in result) {
      return c.json({ error: 'Not found' }, 404)
    }

    const contentType =
      result.metadata?.contentType ?? 'application/octet-stream'

    return new Response(new Uint8Array(result.content), {
      headers: {
        'Content-Type': contentType,
        'X-Arweave-Tx': txId,
      },
    })
  })

  // ============================================================================
  // IPFS Compatibility
  // ============================================================================

  router.post('/api/v0/add', async (c) => {
    const formData = await c.req.formData()
    const file = formData.get('file')
    if (!(file instanceof File)) {
      throw new Error('file required')
    }

    const content = Buffer.from(await file.arrayBuffer())
    const result = await manager.upload(content, {
      filename: file.name,
      contentType: file.type,
      tier: 'popular',
    })

    // Return IPFS-compatible response
    return c.json({
      Hash: result.cid,
      Size: String(result.size),
      Name: file.name,
    })
  })

  router.post('/api/v0/id', async (c) => {
    const health = await manager.healthCheck()
    const allHealthy = Object.values(health).every((h) => h)

    if (!allHealthy) {
      throw new Error('Storage backends unhealthy')
    }

    const backends = manager.listBackends()

    return c.json({
      ID: 'dws-storage',
      AgentVersion: 'dws/2.0.0',
      Addresses: [],
      Backends: backends,
    })
  })

  router.post('/api/v0/pin/rm', async (c) => {
    const { arg } = validateQuery(z.object({ arg: cidSchema }), c)
    return c.json({ Pins: [arg] })
  })

  router.get('/ipfs/:cid', async (c) => {
    const { cid } = validateParams(z.object({ cid: cidSchema }), c)
    const { 'x-region': xRegion } = validateHeaders(regionHeaderSchema, c)
    const region = xRegion ?? 'unknown'

    const result = await manager.download(cid, { region }).catch(() => {
      throw new Error('Not found')
    })

    const contentType =
      result.metadata?.contentType ?? 'application/octet-stream'

    return new Response(new Uint8Array(result.content), {
      headers: {
        'Content-Type': contentType,
        'X-Ipfs-Path': `/ipfs/${cid}`,
        'X-Backend': result.backend,
      },
    })
  })

  return router
}
