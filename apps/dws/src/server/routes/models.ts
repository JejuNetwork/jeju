/**
 * Model Registry Routes - HuggingFace-compatible API
 *
 * Compatible with:
 * - huggingface_hub Python library
 * - transformers.from_pretrained()
 * - Custom jeju-hub CLI
 */

import { createHash } from 'node:crypto'
import { Elysia, t } from 'elysia'
import type { Address, Hex } from 'viem'
import { encodePacked, keccak256 } from 'viem'
import type { BackendManager } from '../../storage/backends'

// ============================================================================
// Types
// ============================================================================

export const ModelType = {
  LLM: 0,
  VISION: 1,
  AUDIO: 2,
  MULTIMODAL: 3,
  EMBEDDING: 4,
  CLASSIFIER: 5,
  REGRESSION: 6,
  RL: 7,
  OTHER: 8,
} as const
export type ModelType = (typeof ModelType)[keyof typeof ModelType]

export const LicenseType = {
  MIT: 0,
  APACHE_2: 1,
  GPL_3: 2,
  CC_BY_4: 3,
  CC_BY_NC_4: 4,
  LLAMA_2: 5,
  CUSTOM: 6,
  PROPRIETARY: 7,
} as const
export type LicenseType = (typeof LicenseType)[keyof typeof LicenseType]

export const AccessLevel = {
  PUBLIC: 0,
  GATED: 1,
  ENCRYPTED: 2,
} as const
export type AccessLevel = (typeof AccessLevel)[keyof typeof AccessLevel]

export interface Model {
  modelId: string
  name: string
  organization: string
  owner: string
  modelType: ModelType
  license: LicenseType
  licenseUri: string
  accessLevel: AccessLevel
  description: string
  tags: string[]
  createdAt: number
  updatedAt: number
  isPublic: boolean
  isVerified: boolean
}

export interface ModelVersion {
  versionId: string
  modelId: string
  version: string
  weightsUri: string
  weightsHash: string
  weightsSize: number
  configUri: string
  tokenizerUri: string
  parameterCount: number
  precision: string
  publishedAt: number
  isLatest: boolean
}

export interface ModelFile {
  filename: string
  cid: string
  size: number
  sha256: string
  type: 'weights' | 'config' | 'tokenizer' | 'other'
}

interface ModelsContext {
  backend: BackendManager
  rpcUrl: string
  modelRegistryAddress: Address
  privateKey?: Hex
}

// In-memory store for development (production would use on-chain + indexer)
const modelsStore = new Map<string, Model>()
const versionsStore = new Map<string, ModelVersion[]>()
const filesStore = new Map<string, ModelFile[]>()
const metricsStore = new Map<
  string,
  { downloads: number; stars: number; inferences: number }
>()
const starredStore = new Map<string, Set<string>>()

// ============================================================================
// Helpers
// ============================================================================

function findModelByKey(key: string): Model | null {
  for (const model of modelsStore.values()) {
    if (`${model.organization}/${model.name}` === key) {
      return model
    }
  }
  return null
}

function getPipelineTag(modelType: ModelType): string {
  const mapping: Record<ModelType, string> = {
    [ModelType.LLM]: 'text-generation',
    [ModelType.VISION]: 'image-classification',
    [ModelType.AUDIO]: 'automatic-speech-recognition',
    [ModelType.MULTIMODAL]: 'image-text-to-text',
    [ModelType.EMBEDDING]: 'feature-extraction',
    [ModelType.CLASSIFIER]: 'text-classification',
    [ModelType.REGRESSION]: 'tabular-regression',
    [ModelType.RL]: 'reinforcement-learning',
    [ModelType.OTHER]: 'other',
  }
  return mapping[modelType] || 'other'
}

// ============================================================================
// Router
// ============================================================================

export function createModelsRouter(ctx: ModelsContext) {
  const { backend } = ctx

  return (
    new Elysia({ name: 'models', prefix: '/models' })
      // Health check
      .get('/health', () => ({ service: 'dws-models', status: 'healthy' }))

      // ============================================================================
      // HuggingFace Hub API Compatibility
      // ============================================================================

      // List models (HF Hub compatible)
      .get(
        '/api/models',
        ({ query, set }) => {
          const search = query.search
          const author = query.author
          const filter = query.filter
          const sort = query.sort ?? 'downloads'
          const direction = query.direction ?? '-1'
          const limit = parseInt(query.limit ?? '30', 10)
          const offset = parseInt(query.offset ?? '0', 10)

          let models = Array.from(modelsStore.values())

          // Filter by author/organization
          if (author) {
            models = models.filter(
              (m) => m.organization.toLowerCase() === author.toLowerCase(),
            )
          }

          // Filter by search term
          if (search) {
            const searchLower = search.toLowerCase()
            models = models.filter(
              (m) =>
                m.name.toLowerCase().includes(searchLower) ||
                m.description.toLowerCase().includes(searchLower) ||
                m.tags.some((tag) => tag.toLowerCase().includes(searchLower)),
            )
          }

          // Filter by type/tags
          if (filter) {
            const filters = filter.split(',')
            const modelTypeNames = Object.keys(ModelType).filter((k) =>
              Number.isNaN(Number(k)),
            ) as (keyof typeof ModelType)[]
            models = models.filter((m) =>
              filters.some((f) => {
                const typeName = modelTypeNames.find(
                  (k) => ModelType[k] === m.modelType,
                )
                return (
                  m.tags.includes(f) ||
                  (typeName && typeName.toLowerCase() === f.toLowerCase())
                )
              }),
            )
          }

          // Sort
          models.sort((a, b) => {
            const metricsA = metricsStore.get(a.modelId) || {
              downloads: 0,
              stars: 0,
              inferences: 0,
            }
            const metricsB = metricsStore.get(b.modelId) || {
              downloads: 0,
              stars: 0,
              inferences: 0,
            }

            let diff = 0
            if (sort === 'downloads')
              diff = metricsB.downloads - metricsA.downloads
            else if (sort === 'likes') diff = metricsB.stars - metricsA.stars
            else if (sort === 'modified') diff = b.updatedAt - a.updatedAt
            else if (sort === 'created') diff = b.createdAt - a.createdAt

            return direction === '-1' ? diff : -diff
          })

          // Paginate
          const total = models.length
          models = models.slice(offset, offset + limit)

          // Convert to HF format
          const result = models.map((m) => {
            const metrics = metricsStore.get(m.modelId) || {
              downloads: 0,
              stars: 0,
              inferences: 0,
            }
            return {
              _id: m.modelId,
              id: `${m.organization}/${m.name}`,
              modelId: `${m.organization}/${m.name}`,
              author: m.organization,
              sha: m.modelId.slice(0, 40),
              lastModified: new Date(m.updatedAt).toISOString(),
              private: m.accessLevel !== AccessLevel.PUBLIC,
              gated: m.accessLevel === AccessLevel.GATED,
              disabled: false,
              tags: m.tags,
              pipeline_tag: getPipelineTag(m.modelType),
              downloads: metrics.downloads,
              likes: metrics.stars,
              library_name: 'transformers',
              createdAt: new Date(m.createdAt).toISOString(),
            }
          })

          set.headers['X-Total-Count'] = total.toString()
          return result
        },
        {
          query: t.Object({
            search: t.Optional(t.String()),
            author: t.Optional(t.String()),
            filter: t.Optional(t.String()),
            sort: t.Optional(
              t.Union([
                t.Literal('downloads'),
                t.Literal('likes'),
                t.Literal('modified'),
                t.Literal('created'),
              ]),
            ),
            direction: t.Optional(t.Union([t.Literal('-1'), t.Literal('1')])),
            limit: t.Optional(t.String()),
            offset: t.Optional(t.String()),
          }),
        },
      )

      // Get single model (HF Hub compatible)
      .get(
        '/api/models/:org/:name',
        ({ params, set }) => {
          const modelKey = `${params.org}/${params.name}`
          const model = findModelByKey(modelKey)

          if (!model) {
            set.status = 404
            return { error: 'Model not found' }
          }

          const versions = versionsStore.get(model.modelId) || []
          const files = filesStore.get(model.modelId) || []
          const metrics = metricsStore.get(model.modelId) || {
            downloads: 0,
            stars: 0,
            inferences: 0,
          }
          const latestVersion = versions.find((v) => v.isLatest)

          return {
            _id: model.modelId,
            id: modelKey,
            modelId: modelKey,
            author: model.organization,
            sha: latestVersion?.weightsHash || model.modelId.slice(0, 40),
            lastModified: new Date(model.updatedAt).toISOString(),
            private: model.accessLevel !== AccessLevel.PUBLIC,
            gated: model.accessLevel === AccessLevel.GATED,
            disabled: false,
            tags: model.tags,
            pipeline_tag: getPipelineTag(model.modelType),
            downloads: metrics.downloads,
            likes: metrics.stars,
            library_name: 'transformers',
            createdAt: new Date(model.createdAt).toISOString(),
            config: latestVersion?.configUri
              ? { model_type: getPipelineTag(model.modelType) }
              : undefined,
            cardData: {
              language: ['en'],
              license:
                Object.keys(LicenseType)
                  .find(
                    (k) =>
                      LicenseType[k as keyof typeof LicenseType] ===
                      model.license,
                  )
                  ?.toLowerCase()
                  .replace('_', '-') || 'unknown',
              tags: model.tags,
              pipeline_tag: getPipelineTag(model.modelType),
            },
            siblings: files.map((f) => ({
              rfilename: f.filename,
              size: f.size,
              blobId: f.cid,
            })),
          }
        },
        {
          params: t.Object({
            org: t.String({ minLength: 1 }),
            name: t.String({ minLength: 1 }),
          }),
        },
      )

      // Get model files/tree (HF Hub compatible)
      .get(
        '/api/models/:org/:name/tree/:revision',
        ({ params, query, set }) => {
          const path = query.path || ''

          const model = findModelByKey(`${params.org}/${params.name}`)
          if (!model) {
            set.status = 404
            return { error: 'Model not found' }
          }

          const files = filesStore.get(model.modelId) || []

          // Filter by path prefix if provided
          const filteredFiles = path
            ? files.filter((f) => f.filename.startsWith(path))
            : files

          return filteredFiles.map((f) => ({
            type: 'file',
            oid: f.cid,
            size: f.size,
            path: f.filename,
            lfs:
              f.size > 10_000_000
                ? {
                    // LFS for files > 10MB
                    oid: f.sha256,
                    size: f.size,
                    pointerSize: 134,
                  }
                : undefined,
          }))
        },
        {
          params: t.Object({
            org: t.String({ minLength: 1 }),
            name: t.String({ minLength: 1 }),
            revision: t.String({ minLength: 1 }),
          }),
          query: t.Object({
            path: t.Optional(t.String()),
          }),
        },
      )

      // Download file (HF Hub compatible - resolve endpoint)
      .get(
        '/api/models/:org/:name/resolve/:revision/*',
        async ({ params, request, set }) => {
          const model = findModelByKey(`${params.org}/${params.name}`)
          if (!model) {
            set.status = 404
            return { error: 'Model not found' }
          }

          const url = new URL(request.url)
          const filename = url.pathname
            .split('/resolve/')[1]
            ?.split('/')
            .slice(1)
            .join('/')

          const files = filesStore.get(model.modelId) || []
          const file = files.find((f) => f.filename === filename)

          if (!file) {
            set.status = 404
            return { error: 'File not found' }
          }

          // Track download
          const metrics = metricsStore.get(model.modelId) || {
            downloads: 0,
            stars: 0,
            inferences: 0,
          }
          metrics.downloads++
          metricsStore.set(model.modelId, metrics)

          // Redirect to storage backend
          const result = await backend.download(file.cid).catch(() => null)
          if (!result) {
            set.status = 404
            return { error: 'File not available' }
          }

          const content = Buffer.isBuffer(result.content)
            ? new Uint8Array(result.content)
            : result.content
          return new Response(content, {
            headers: {
              'Content-Type': 'application/octet-stream',
              'Content-Disposition': `attachment; filename="${filename}"`,
              'X-Sha256': file.sha256,
              ETag: `"${file.sha256}"`,
            },
          })
        },
        {
          params: t.Object({
            org: t.String({ minLength: 1 }),
            name: t.String({ minLength: 1 }),
            revision: t.String({ minLength: 1 }),
            '*': t.String(),
          }),
        },
      )

      // LFS batch download (HF Hub compatible)
      .post(
        '/api/models/:org/:name/info/refs/lfs',
        ({ params, body, headers, set }) => {
          const model = findModelByKey(`${params.org}/${params.name}`)
          if (!model) {
            set.status = 404
            return { error: 'Model not found' }
          }

          const files = filesStore.get(model.modelId) || []
          const baseUrl = headers.host
          if (!baseUrl) {
            set.status = 400
            return { error: 'Missing host header' }
          }
          const protocol = headers['x-forwarded-proto'] || 'http'

          return {
            transfer: 'basic',
            objects: body.objects.map((obj) => {
              const file = files.find((f) => f.sha256 === obj.oid)
              if (!file) {
                return {
                  oid: obj.oid,
                  size: obj.size,
                  error: { code: 404, message: 'Object not found' },
                }
              }
              return {
                oid: obj.oid,
                size: obj.size,
                authenticated: true,
                actions: {
                  download: {
                    href: `${protocol}://${baseUrl}/storage/download/${file.cid}`,
                    expires_in: 3600,
                  },
                },
              }
            }),
          }
        },
        {
          params: t.Object({
            org: t.String({ minLength: 1 }),
            name: t.String({ minLength: 1 }),
          }),
          body: t.Object({
            operation: t.Optional(t.String()),
            transfers: t.Optional(t.Array(t.String())),
            objects: t.Array(
              t.Object({
                oid: t.String(),
                size: t.Number(),
              }),
            ),
          }),
          headers: t.Object({
            host: t.Optional(t.String()),
            'x-forwarded-proto': t.Optional(t.String()),
          }),
        },
      )

      // ============================================================================
      // Jeju Native API
      // ============================================================================

      // List all models
      .get(
        '/',
        ({ query }) => {
          const type = query.type
          const org = query.org
          const search = query.q
          const limit = parseInt(query.limit ?? '50', 10)
          const offset = parseInt(query.offset ?? '0', 10)

          let models = Array.from(modelsStore.values())

          if (type) {
            const typeNum =
              ModelType[type.toUpperCase() as keyof typeof ModelType]
            if (typeNum !== undefined) {
              models = models.filter((m) => m.modelType === typeNum)
            }
          }

          if (org) {
            models = models.filter(
              (m) => m.organization.toLowerCase() === org.toLowerCase(),
            )
          }

          if (search) {
            const searchLower = search.toLowerCase()
            models = models.filter(
              (m) =>
                m.name.toLowerCase().includes(searchLower) ||
                m.description.toLowerCase().includes(searchLower),
            )
          }

          const total = models.length
          models = models.slice(offset, offset + limit)

          return {
            models: models.map((m) => ({
              ...m,
              metrics: metricsStore.get(m.modelId) || {
                downloads: 0,
                stars: 0,
                inferences: 0,
              },
            })),
            total,
            limit,
            offset,
          }
        },
        {
          query: t.Object({
            type: t.Optional(t.String()),
            org: t.Optional(t.String()),
            q: t.Optional(t.String()),
            limit: t.Optional(t.String()),
            offset: t.Optional(t.String()),
          }),
        },
      )

      // Get model details
      .get(
        '/:org/:name',
        ({ params, set }) => {
          const model = findModelByKey(`${params.org}/${params.name}`)
          if (!model) {
            set.status = 404
            return { error: 'Model not found' }
          }

          const versions = versionsStore.get(model.modelId) || []
          const files = filesStore.get(model.modelId) || []
          const metrics = metricsStore.get(model.modelId) || {
            downloads: 0,
            stars: 0,
            inferences: 0,
          }

          return {
            ...model,
            versions,
            files,
            metrics,
          }
        },
        {
          params: t.Object({
            org: t.String({ minLength: 1 }),
            name: t.String({ minLength: 1 }),
          }),
        },
      )

      // Create model
      .post(
        '/',
        ({ body, headers, set }) => {
          const owner = headers['x-jeju-address']
          if (!owner) {
            set.status = 401
            return { error: 'Missing x-jeju-address header' }
          }

          // Parse enums if strings
          const modelType: ModelType =
            typeof body.modelType === 'string'
              ? (ModelType[
                  body.modelType.toUpperCase() as keyof typeof ModelType
                ] ?? ModelType.OTHER)
              : (body.modelType as ModelType)
          const license: LicenseType =
            typeof body.license === 'string'
              ? (LicenseType[
                  body.license
                    .toUpperCase()
                    .replace('-', '_') as keyof typeof LicenseType
                ] ?? LicenseType.MIT)
              : ((body.license as LicenseType) ?? LicenseType.MIT)
          const accessLevel: AccessLevel =
            typeof body.accessLevel === 'string'
              ? (AccessLevel[
                  body.accessLevel.toUpperCase() as keyof typeof AccessLevel
                ] ?? AccessLevel.PUBLIC)
              : ((body.accessLevel as AccessLevel) ?? AccessLevel.PUBLIC)

          const modelId = keccak256(
            encodePacked(
              ['string', 'string', 'address', 'uint256'],
              [
                body.organization,
                body.name,
                owner as Address,
                BigInt(Date.now()),
              ],
            ),
          )

          const model: Model = {
            modelId,
            name: body.name,
            organization: body.organization,
            owner,
            modelType,
            license,
            licenseUri: '',
            accessLevel,
            description: body.description,
            tags: body.tags || [],
            createdAt: Date.now(),
            updatedAt: Date.now(),
            isPublic: accessLevel === AccessLevel.PUBLIC,
            isVerified: false,
          }

          modelsStore.set(modelId, model)
          metricsStore.set(modelId, { downloads: 0, stars: 0, inferences: 0 })

          set.status = 201
          return model
        },
        {
          body: t.Object({
            name: t.String({ minLength: 1 }),
            organization: t.String({ minLength: 1 }),
            description: t.String(),
            modelType: t.Union([t.String(), t.Number()]),
            license: t.Optional(t.Union([t.String(), t.Number()])),
            accessLevel: t.Optional(t.Union([t.String(), t.Number()])),
            tags: t.Optional(t.Array(t.String())),
          }),
          headers: t.Object({
            'x-jeju-address': t.Optional(t.String()),
          }),
        },
      )

      // Upload model files
      .post(
        '/:org/:name/upload',
        async ({ params, body, headers, set }) => {
          const owner = headers['x-jeju-address']
          if (!owner) {
            set.status = 401
            return { error: 'Missing x-jeju-address header' }
          }

          const model = findModelByKey(`${params.org}/${params.name}`)
          if (!model) {
            set.status = 404
            return { error: 'Model not found' }
          }

          if (model.owner.toLowerCase() !== owner.toLowerCase()) {
            set.status = 403
            return { error: 'Not authorized' }
          }

          const uploadedFiles: ModelFile[] = []

          // Handle file upload - body.file could be single file or array
          const files = Array.isArray(body.file) ? body.file : [body.file]

          for (const file of files) {
            if (file) {
              const content = Buffer.from(await file.arrayBuffer())
              const sha256 = createHash('sha256').update(content).digest('hex')

              const result = await backend.upload(content, {
                filename: file.name,
              })

              const fileType: ModelFile['type'] =
                file.name.includes('weight') ||
                file.name.endsWith('.safetensors') ||
                file.name.endsWith('.bin')
                  ? 'weights'
                  : file.name.includes('config') || file.name.endsWith('.json')
                    ? 'config'
                    : file.name.includes('tokenizer')
                      ? 'tokenizer'
                      : 'other'

              uploadedFiles.push({
                filename: file.name,
                cid: result.cid,
                size: content.length,
                sha256,
                type: fileType,
              })
            }
          }

          // Append to existing files
          const existingFiles = filesStore.get(model.modelId) || []
          filesStore.set(model.modelId, [...existingFiles, ...uploadedFiles])

          // Update model timestamp
          model.updatedAt = Date.now()
          modelsStore.set(model.modelId, model)

          return { uploaded: uploadedFiles }
        },
        {
          params: t.Object({
            org: t.String({ minLength: 1 }),
            name: t.String({ minLength: 1 }),
          }),
          body: t.Object({
            file: t.Union([t.File(), t.Array(t.File())]),
          }),
          headers: t.Object({
            'x-jeju-address': t.Optional(t.String()),
          }),
        },
      )

      // Publish version
      .post(
        '/:org/:name/versions',
        ({ params, body, headers, set }) => {
          const owner = headers['x-jeju-address']
          if (!owner) {
            set.status = 401
            return { error: 'Missing x-jeju-address header' }
          }

          const model = findModelByKey(`${params.org}/${params.name}`)
          if (!model) {
            set.status = 404
            return { error: 'Model not found' }
          }

          if (model.owner.toLowerCase() !== owner.toLowerCase()) {
            set.status = 403
            return { error: 'Not authorized' }
          }

          const files = filesStore.get(model.modelId) || []
          const weightsFile = files.find((f) => f.type === 'weights')
          const configFile = files.find((f) => f.type === 'config')
          const tokenizerFile = files.find((f) => f.type === 'tokenizer')

          const versionId = keccak256(
            encodePacked(
              ['bytes32', 'string', 'uint256'],
              [model.modelId as Hex, body.version, BigInt(Date.now())],
            ),
          )

          // Mark previous versions as not latest
          const existingVersions = versionsStore.get(model.modelId) || []
          existingVersions.forEach((v) => {
            v.isLatest = false
          })

          const version: ModelVersion = {
            versionId,
            modelId: model.modelId,
            version: body.version,
            weightsUri: body.weightsUri || weightsFile?.cid || '',
            weightsHash: weightsFile?.sha256 || '',
            weightsSize: weightsFile?.size || 0,
            configUri: body.configUri || configFile?.cid || '',
            tokenizerUri: body.tokenizerUri || tokenizerFile?.cid || '',
            parameterCount: body.parameterCount || 0,
            precision: body.precision || 'fp16',
            publishedAt: Date.now(),
            isLatest: true,
          }

          versionsStore.set(model.modelId, [...existingVersions, version])

          // Update model timestamp
          model.updatedAt = Date.now()
          modelsStore.set(model.modelId, model)

          set.status = 201
          return version
        },
        {
          params: t.Object({
            org: t.String({ minLength: 1 }),
            name: t.String({ minLength: 1 }),
          }),
          body: t.Object({
            version: t.String({ minLength: 1 }),
            weightsUri: t.Optional(t.String()),
            configUri: t.Optional(t.String()),
            tokenizerUri: t.Optional(t.String()),
            parameterCount: t.Optional(t.Number()),
            precision: t.Optional(t.String()),
          }),
          headers: t.Object({
            'x-jeju-address': t.Optional(t.String()),
          }),
        },
      )

      // Get versions
      .get(
        '/:org/:name/versions',
        ({ params, set }) => {
          const model = findModelByKey(`${params.org}/${params.name}`)
          if (!model) {
            set.status = 404
            return { error: 'Model not found' }
          }

          return versionsStore.get(model.modelId) || []
        },
        {
          params: t.Object({
            org: t.String({ minLength: 1 }),
            name: t.String({ minLength: 1 }),
          }),
        },
      )

      // Get files
      .get(
        '/:org/:name/files',
        ({ params, set }) => {
          const model = findModelByKey(`${params.org}/${params.name}`)
          if (!model) {
            set.status = 404
            return { error: 'Model not found' }
          }

          return filesStore.get(model.modelId) || []
        },
        {
          params: t.Object({
            org: t.String({ minLength: 1 }),
            name: t.String({ minLength: 1 }),
          }),
        },
      )

      // Download file
      .get(
        '/:org/:name/files/:filename',
        async ({ params, set }) => {
          const model = findModelByKey(`${params.org}/${params.name}`)
          if (!model) {
            set.status = 404
            return { error: 'Model not found' }
          }

          const files = filesStore.get(model.modelId) || []
          const file = files.find((f) => f.filename === params.filename)

          if (!file) {
            set.status = 404
            return { error: 'File not found' }
          }

          // Track download
          const metrics = metricsStore.get(model.modelId) || {
            downloads: 0,
            stars: 0,
            inferences: 0,
          }
          metrics.downloads++
          metricsStore.set(model.modelId, metrics)

          const result = await backend.download(file.cid)
          const content = Buffer.isBuffer(result.content)
            ? new Uint8Array(result.content)
            : result.content
          return new Response(content, {
            headers: {
              'Content-Type': 'application/octet-stream',
              'Content-Disposition': `attachment; filename="${params.filename}"`,
            },
          })
        },
        {
          params: t.Object({
            org: t.String({ minLength: 1 }),
            name: t.String({ minLength: 1 }),
            filename: t.String({ minLength: 1 }),
          }),
        },
      )

      // Star/unstar model
      .post(
        '/:org/:name/star',
        ({ params, headers, set }) => {
          const user = headers['x-jeju-address']
          if (!user) {
            set.status = 401
            return { error: 'Missing x-jeju-address header' }
          }

          const model = findModelByKey(`${params.org}/${params.name}`)
          if (!model) {
            set.status = 404
            return { error: 'Model not found' }
          }

          const starredUsers = starredStore.get(model.modelId) || new Set()
          const metrics = metricsStore.get(model.modelId) || {
            downloads: 0,
            stars: 0,
            inferences: 0,
          }

          if (starredUsers.has(user)) {
            starredUsers.delete(user)
            metrics.stars--
          } else {
            starredUsers.add(user)
            metrics.stars++
          }

          starredStore.set(model.modelId, starredUsers)
          metricsStore.set(model.modelId, metrics)

          return { starred: starredUsers.has(user), stars: metrics.stars }
        },
        {
          params: t.Object({
            org: t.String({ minLength: 1 }),
            name: t.String({ minLength: 1 }),
          }),
          headers: t.Object({
            'x-jeju-address': t.Optional(t.String()),
          }),
        },
      )

      // Run inference (proxy to endpoint)
      .post(
        '/:org/:name/inference',
        ({ params, body, set }) => {
          const model = findModelByKey(`${params.org}/${params.name}`)
          if (!model) {
            set.status = 404
            return { error: 'Model not found' }
          }

          // Track inference
          const metrics = metricsStore.get(model.modelId) || {
            downloads: 0,
            stars: 0,
            inferences: 0,
          }
          metrics.inferences++
          metricsStore.set(model.modelId, metrics)

          // In production, would forward to actual inference endpoint
          return {
            status: 'queued',
            message: 'Inference request queued. Endpoint integration pending.',
            input: body,
          }
        },
        {
          params: t.Object({
            org: t.String({ minLength: 1 }),
            name: t.String({ minLength: 1 }),
          }),
          body: t.Object({
            inputs: t.Unknown(),
            parameters: t.Optional(t.Record(t.String(), t.Unknown())),
          }),
        },
      )
  )
}

export type ModelsRoutes = ReturnType<typeof createModelsRouter>
