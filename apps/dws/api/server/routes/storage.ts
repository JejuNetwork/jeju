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
 * - Content moderation before upload (CSAM, malware, illegal content)
 */

// Network configuration handled internally by MultiBackendManager
import { isProductionEnv } from '@jejunetwork/config'
import {
  ContentModerationPipeline,
  type ModerationResult,
} from '@jejunetwork/shared'
import { getFormString, getFormStringOr } from '@jejunetwork/types'
import { Elysia, t } from 'elysia'
import type { Address } from 'viem'
import { z } from 'zod'
import { getDWSReputationAdapter } from '../../moderation/reputation-adapter'

// Generic JSON value schema for user-uploaded content
const JsonValueSchema: z.ZodType<unknown> = z.lazy(() =>
  z.union([
    z.string(),
    z.number(),
    z.boolean(),
    z.null(),
    z.array(JsonValueSchema),
    z.record(z.string(), JsonValueSchema),
  ]),
)

import { extractClientRegion } from '../../shared/utils/common'
import type { BackendManager } from '../../storage/backends'
import { getMultiBackendManager } from '../../storage/multi-backend'
import type {
  ContentCategory,
  ContentTier,
  StorageBackendType,
} from '../../storage/types'

// ============ Content Moderation ============

/**
 * Determine content type from filename/mime type
 */
function getContentType(
  filename: string,
  mimeType?: string,
): 'image' | 'video' | 'text' | 'file' {
  const ext = filename.split('.').pop()?.toLowerCase() ?? ''
  const mime = mimeType?.toLowerCase() ?? ''

  if (
    ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp', 'svg'].includes(ext) ||
    mime.startsWith('image/')
  ) {
    return 'image'
  }

  if (
    ['mp4', 'webm', 'avi', 'mov', 'mkv'].includes(ext) ||
    mime.startsWith('video/')
  ) {
    return 'video'
  }

  if (
    ['txt', 'md', 'json', 'xml', 'html', 'css', 'js', 'ts'].includes(ext) ||
    mime.startsWith('text/')
  ) {
    return 'text'
  }

  return 'file'
}

// Singleton pipeline with reputation provider
let moderationPipeline: ContentModerationPipeline | null = null

function getModerationPipeline(): ContentModerationPipeline {
  if (!moderationPipeline) {
    const isProduction = isProductionEnv()

    // SECURITY NOTE: In production, these API keys should be stored in KMS
    // and accessed via the API marketplace key vault, not env vars.
    // For now, log warnings about direct env var usage.
    if (isProduction) {
      if (process.env.OPENAI_API_KEY) {
        console.warn(
          '[Storage] WARNING: Using OPENAI_API_KEY from env. Consider using API marketplace vault.',
        )
      }
      if (process.env.AWS_SECRET_ACCESS_KEY) {
        console.warn(
          '[Storage] WARNING: Using AWS credentials from env. Consider using IAM roles or KMS.',
        )
      }
    }

    moderationPipeline = new ContentModerationPipeline({
      reputationProvider: getDWSReputationAdapter(),
      openai: process.env.OPENAI_API_KEY
        ? { apiKey: process.env.OPENAI_API_KEY }
        : undefined,
      hive: process.env.HIVE_API_KEY
        ? { apiKey: process.env.HIVE_API_KEY }
        : undefined,
      awsRekognition:
        process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY
          ? {
              accessKeyId: process.env.AWS_ACCESS_KEY_ID,
              secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
              region: process.env.AWS_REGION ?? 'us-east-1',
            }
          : undefined,
      // Cloudflare moderation provider is not yet supported in PipelineConfig
    })
  }
  return moderationPipeline
}

/**
 * Moderate content before upload
 * Returns moderation result - caller should handle blocking/warning
 */
async function moderateUpload(
  content: Buffer,
  filename: string,
  senderAddress?: string,
): Promise<ModerationResult> {
  const pipeline = getModerationPipeline()
  const contentType = getContentType(filename)

  return pipeline.moderate({
    content,
    contentType,
    senderAddress: senderAddress as Address | undefined,
  })
}

// Deterrence messages for CSAM blocks per UK Government guidance
const DETERRENCE_MESSAGES = {
  csam: {
    warning: `⚠️ WARNING: Child sexual abuse material (CSAM) is illegal.

Viewing, possessing, or distributing CSAM is a serious criminal offense
that carries severe penalties including imprisonment.

If you or someone you know needs help, please contact:
• Stop It Now: 0808 1000 900 (UK) / 1-888-773-8368 (US)
• NCMEC CyberTipline: 1-800-843-5678
• Childhelp: 1-800-422-4453

This activity has been logged and may be reported to authorities.`,
    blocked: `🚫 ACCESS BLOCKED

This content has been identified as illegal child sexual abuse material.

This incident has been logged and will be reported to:
• National Center for Missing & Exploited Children (NCMEC)
• Internet Watch Foundation (IWF)
• Relevant law enforcement authorities

Attempting to access illegal content is a criminal offense.`,
  },
  support: {
    uk: [
      {
        name: 'Stop It Now UK',
        phone: '0808 1000 900',
        url: 'https://www.stopitnow.org.uk/',
      },
      {
        name: 'Childline',
        phone: '0800 1111',
        url: 'https://www.childline.org.uk/',
      },
    ],
    us: [
      {
        name: 'Stop It Now USA',
        phone: '1-888-773-8368',
        url: 'https://www.stopitnow.org/',
      },
      {
        name: 'NCMEC CyberTipline',
        phone: '1-800-843-5678',
        url: 'https://www.missingkids.org/',
      },
    ],
  },
}

/**
 * Build error response for moderation failure
 */
function buildModerationErrorResponse(result: ModerationResult): {
  error: string
  code: string
  category?: string
  severity: string
  reviewRequired: boolean
  deterrence?: {
    message: string
    support: typeof DETERRENCE_MESSAGES.support
  }
} {
  const isCSAM = result.primaryCategory === 'csam'

  return {
    error: isCSAM
      ? DETERRENCE_MESSAGES.csam.blocked
      : result.action === 'ban'
        ? 'Content violates platform policies and has been reported'
        : result.action === 'block'
          ? 'Content blocked due to policy violation'
          : 'Content flagged for review',
    code:
      result.action === 'ban'
        ? 'CONTENT_BANNED'
        : result.action === 'block'
          ? 'CONTENT_BLOCKED'
          : 'CONTENT_FLAGGED',
    category: result.primaryCategory,
    severity: result.severity,
    reviewRequired: result.reviewRequired,
    deterrence: isCSAM
      ? {
          message: DETERRENCE_MESSAGES.csam.blocked,
          support: DETERRENCE_MESSAGES.support,
        }
      : undefined,
  }
}

// Type-safe query param accessor
function getQueryInt(
  query: Record<string, string | undefined>,
  key: string,
  defaultVal: number,
): number {
  const val = query[key]
  return val !== undefined ? parseInt(val, 10) : defaultVal
}

export function createStorageRouter(_backend?: BackendManager) {
  // Always use MultiBackendManager - it handles localnet configuration internally
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
      .post('/upload', async ({ request, set }) => {
        // Parse multipart form data from request
        let formData: FormData
        try {
          formData = await request.formData()
        } catch (_err) {
          set.status = 400
          return { error: 'Invalid multipart form data' }
        }

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
        const senderAddress = request.headers.get('x-sender-address')

        const content = Buffer.from(await file.arrayBuffer())

        // ========== CONTENT MODERATION ==========
        const moderation = await moderateUpload(
          content,
          file.name,
          senderAddress ?? undefined,
        )

        // Block banned/blocked content
        if (moderation.action === 'ban' || moderation.action === 'block') {
          set.status = moderation.action === 'ban' ? 451 : 403
          return buildModerationErrorResponse(moderation)
        }

        // Add warning header for flagged content
        if (moderation.action === 'warn') {
          set.headers['X-Moderation-Warning'] =
            `${moderation.primaryCategory}: ${moderation.blockedReason}`
        }

        // Queue content that needs review but allow upload
        if (moderation.action === 'queue') {
          set.headers['X-Moderation-Status'] = 'pending_review'
        }
        // ========================================

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
      .post('/upload/raw', async ({ request, query, set }) => {
        const filename = request.headers.get('x-filename') || 'upload'
        const tier = (query.tier as ContentTier) || 'popular'
        const category = (query.category as ContentCategory) || 'data'
        const senderAddress = request.headers.get('x-sender-address')

        const content = Buffer.from(await request.arrayBuffer())

        // ========== CONTENT MODERATION ==========
        const moderation = await moderateUpload(
          content,
          filename,
          senderAddress ?? undefined,
        )

        if (moderation.action === 'ban' || moderation.action === 'block') {
          set.status = moderation.action === 'ban' ? 451 : 403
          return buildModerationErrorResponse(moderation)
        }

        if (moderation.action === 'warn') {
          set.headers['X-Moderation-Warning'] =
            `${moderation.primaryCategory}: ${moderation.blockedReason}`
        }
        // ========================================

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
        async ({ body, request, set }) => {
          const { data, name, tier, category, encrypt } = body
          const content = Buffer.from(JSON.stringify(data))
          const filename = name ?? 'data.json'
          const senderAddress = request.headers.get('x-sender-address')

          // ========== CONTENT MODERATION ==========
          const moderation = await moderateUpload(
            content,
            filename,
            senderAddress ?? undefined,
          )

          if (moderation.action === 'ban' || moderation.action === 'block') {
            set.status = moderation.action === 'ban' ? 451 : 403
            return buildModerationErrorResponse(moderation)
          }

          if (moderation.action === 'warn') {
            set.headers['X-Moderation-Warning'] =
              `${moderation.primaryCategory}: ${moderation.blockedReason}`
          }
          // ========================================

          const result = await storageManager.upload(content, {
            filename,
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
      .post('/upload/permanent', async ({ body, request, set }) => {
        const formData = body as FormData
        const file = formData.get('file') as File | null

        if (!file) {
          set.status = 400
          return { error: 'No file provided' }
        }

        const tier = getFormStringOr(formData, 'tier', 'popular')
        const category = getFormStringOr(formData, 'category', 'data')
        const content = Buffer.from(await file.arrayBuffer())
        const senderAddress = request.headers.get('x-sender-address')

        // ========== CONTENT MODERATION ==========
        // Permanent uploads require EXTRA strict moderation
        const moderation = await moderateUpload(
          content,
          file.name,
          senderAddress ?? undefined,
        )

        // Block anything that isn't clean for permanent storage
        if (moderation.action !== 'allow') {
          set.status =
            moderation.action === 'ban'
              ? 451
              : moderation.action === 'block'
                ? 403
                : 400
          return buildModerationErrorResponse(moderation)
        }
        // ========================================

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

        const result = await storageManager.download(cid, {
          region,
          preferredBackends: preferredBackend ? [preferredBackend] : undefined,
          decryptionKeyId: decrypt
            ? (request.headers.get('x-decryption-key-id') ?? undefined)
            : undefined,
        })

        const metadata = result.metadata
        const contentType = metadata.contentType ?? 'application/octet-stream'

        set.headers['Content-Type'] = contentType
        set.headers['Content-Length'] = String(result.content.length)
        set.headers['X-Backend'] = result.backend
        set.headers['X-Latency-Ms'] = String(result.latencyMs)
        set.headers['X-From-Cache'] = String(result.fromCache)
        if (metadata.tier) {
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

        return JsonValueSchema.parse(
          JSON.parse(result.content.toString('utf-8')),
        )
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
          result.metadata.contentType ?? 'application/octet-stream'

        set.headers['Content-Type'] = contentType
        set.headers['X-Arweave-Tx'] = txId

        return new Response(new Uint8Array(result.content))
      })

      // IPFS Compatibility - Add
      .post('/api/v0/add', async ({ request, set }) => {
        // Parse multipart form data from request (same as /upload)
        let formData: FormData
        try {
          formData = await request.formData()
        } catch {
          set.status = 400
          return { error: 'Invalid multipart form data' }
        }

        const file = formData.get('file') as File | null

        if (!file) {
          set.status = 400
          return { error: 'No file provided' }
        }

        const content = Buffer.from(await file.arrayBuffer())
        const senderAddress = request.headers.get('x-sender-address')

        // ========== CONTENT MODERATION ==========
        const moderation = await moderateUpload(
          content,
          file.name,
          senderAddress ?? undefined,
        )

        if (moderation.action === 'ban' || moderation.action === 'block') {
          set.status = moderation.action === 'ban' ? 451 : 403
          return buildModerationErrorResponse(moderation)
        }
        // ========================================

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
          result.metadata.contentType ?? 'application/octet-stream'

        set.headers['Content-Type'] = contentType
        set.headers['X-Ipfs-Path'] = `/ipfs/${cid}`
        set.headers['X-Backend'] = result.backend

        return new Response(new Uint8Array(result.content))
      })
  )
}
