/**
 * Datasets Registry Routes - HuggingFace-compatible API
 *
 * Compatible with:
 * - huggingface_hub datasets library
 * - datasets.load_dataset()
 * - Custom jeju-hub CLI
 */

import { createHash } from 'node:crypto'
import { expectValid } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import { encodePacked, keccak256 } from 'viem'
import { z } from 'zod'
import {
  datasetConfigSchema,
  datasetCreationSchema,
  jejuAddressHeaderSchema,
} from '../../shared'
import type { BackendManager } from '../../storage/backends'

// Extended schemas for HuggingFace-compatible API
const hfDatasetsQuerySchema = z.object({
  search: z.string().optional(),
  author: z.string().optional(),
  filter: z.string().optional(),
  sort: z.enum(['downloads', 'modified', 'created']).default('downloads'),
  limit: z.coerce.number().int().positive().max(100).default(30),
  offset: z.coerce.number().int().nonnegative().default(0),
})

const nativeDatasetsQuerySchema = z.object({
  org: z.string().optional(),
  q: z.string().optional(),
  format: z.string().optional(),
  limit: z.coerce.number().int().positive().max(100).default(50),
  offset: z.coerce.number().int().nonnegative().default(0),
})

// ============================================================================
// Types
// ============================================================================

export const DatasetFormat = {
  PARQUET: 0,
  CSV: 1,
  JSON: 2,
  JSONL: 3,
  ARROW: 4,
  TEXT: 5,
  IMAGEFOLDER: 6,
  AUDIOFOLDER: 7,
  OTHER: 8,
} as const
export type DatasetFormat = (typeof DatasetFormat)[keyof typeof DatasetFormat]

export const DatasetLicense = {
  MIT: 0,
  APACHE_2: 1,
  CC_BY_4: 2,
  CC_BY_SA_4: 3,
  CC_BY_NC_4: 4,
  CC0: 5,
  ODC_BY: 6,
  OTHER: 7,
} as const
export type DatasetLicense =
  (typeof DatasetLicense)[keyof typeof DatasetLicense]

export interface Dataset {
  datasetId: string
  name: string
  organization: string
  owner: string
  description: string
  format: DatasetFormat
  license: DatasetLicense
  licenseUri: string
  tags: string[]
  size: number
  numRows: number
  numFiles: number
  createdAt: number
  updatedAt: number
  isPublic: boolean
}

export interface DatasetFile {
  filename: string
  cid: string
  size: number
  sha256: string
  split?: string // train, test, validation
  numRows?: number
}

export interface DatasetConfig {
  name: string
  description: string
  splits: {
    name: string
    numRows: number
    numBytes: number
  }[]
  features: Record<string, { dtype: string }>
}

interface DatasetsContext {
  backend: BackendManager
}

// In-memory store
const datasetsStore = new Map<string, Dataset>()
const filesStore = new Map<string, DatasetFile[]>()
const configsStore = new Map<string, DatasetConfig>()
const metricsStore = new Map<string, { downloads: number; views: number }>()

function extractHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value
  })
  return headers
}

// ============================================================================
// Router
// ============================================================================

export function createDatasetsRouter(ctx: DatasetsContext) {
  const { backend } = ctx

  return (
    new Elysia({ prefix: '/datasets' })
      // Health check
      .get('/health', () => ({ service: 'dws-datasets', status: 'healthy' }))

      // ============================================================================
      // HuggingFace Hub API Compatibility
      // ============================================================================

      // List datasets (HF Hub compatible)
      .get('/api/datasets', async ({ query, set }) => {
        const { search, author, sort, limit, offset } = expectValid(
          hfDatasetsQuerySchema,
          query,
        )

        let datasets = Array.from(datasetsStore.values())

        // Filter by author/organization
        if (author) {
          datasets = datasets.filter(
            (d) => d.organization.toLowerCase() === author.toLowerCase(),
          )
        }

        // Filter by search term
        if (search) {
          const searchLower = search.toLowerCase()
          datasets = datasets.filter(
            (d) =>
              d.name.toLowerCase().includes(searchLower) ||
              d.description.toLowerCase().includes(searchLower) ||
              d.tags.some((t) => t.toLowerCase().includes(searchLower)),
          )
        }

        // Sort
        datasets.sort((a, b) => {
          const metricsA = metricsStore.get(a.datasetId) || {
            downloads: 0,
            views: 0,
          }
          const metricsB = metricsStore.get(b.datasetId) || {
            downloads: 0,
            views: 0,
          }

          if (sort === 'downloads')
            return metricsB.downloads - metricsA.downloads
          if (sort === 'modified') return b.updatedAt - a.updatedAt
          return b.createdAt - a.createdAt
        })

        const total = datasets.length
        datasets = datasets.slice(offset, offset + limit)

        // Convert to HF format
        const result = datasets.map((d) => {
          const metrics = metricsStore.get(d.datasetId) || {
            downloads: 0,
            views: 0,
          }
          return {
            _id: d.datasetId,
            id: `${d.organization}/${d.name}`,
            author: d.organization,
            sha: d.datasetId.slice(0, 40),
            lastModified: new Date(d.updatedAt).toISOString(),
            private: !d.isPublic,
            disabled: false,
            tags: d.tags,
            downloads: metrics.downloads,
            createdAt: new Date(d.createdAt).toISOString(),
          }
        })

        set.headers['X-Total-Count'] = total.toString()
        return result
      })

      // Get single dataset (HF Hub compatible)
      .get('/api/datasets/:org/:name', async ({ params }) => {
        const { org, name } = params

        const dataset = findDatasetByKey(`${org}/${name}`)
        if (!dataset) {
          throw new Error('Dataset not found')
        }

        const files = filesStore.get(dataset.datasetId) || []
        const config = configsStore.get(dataset.datasetId)
        const metrics = metricsStore.get(dataset.datasetId) || {
          downloads: 0,
          views: 0,
        }

        return {
          _id: dataset.datasetId,
          id: `${org}/${name}`,
          author: dataset.organization,
          sha: dataset.datasetId.slice(0, 40),
          lastModified: new Date(dataset.updatedAt).toISOString(),
          private: !dataset.isPublic,
          disabled: false,
          tags: dataset.tags,
          downloads: metrics.downloads,
          createdAt: new Date(dataset.createdAt).toISOString(),
          cardData: {
            license:
              (Object.keys(DatasetLicense) as (keyof typeof DatasetLicense)[])
                .find((key) => DatasetLicense[key] === dataset.license)
                ?.toLowerCase()
                .replace('_', '-') ?? 'other',
            tags: dataset.tags,
            size_categories: getSizeCategory(dataset.size),
          },
          siblings: files.map((f) => ({
            rfilename: f.filename,
            size: f.size,
            blobId: f.cid,
          })),
          config: config || null,
        }
      })

      // Get dataset files/tree (HF Hub compatible)
      .get('/api/datasets/:org/:name/tree/:revision', async ({ params }) => {
        const { org, name } = params

        const dataset = findDatasetByKey(`${org}/${name}`)
        if (!dataset) {
          throw new Error('Dataset not found')
        }

        const files = filesStore.get(dataset.datasetId) || []

        return files.map((f) => ({
          type: 'file',
          oid: f.cid,
          size: f.size,
          path: f.filename,
        }))
      })

      // Download file (HF Hub compatible)
      .get(
        '/api/datasets/:org/:name/resolve/:revision/*',
        async ({ params, request }) => {
          const { org, name } = params
          const url = new URL(request.url)
          const filename = url.pathname
            .split('/resolve/')[1]
            ?.split('/')
            .slice(1)
            .join('/')

          const dataset = findDatasetByKey(`${org}/${name}`)
          if (!dataset) {
            throw new Error('Dataset not found')
          }

          const files = filesStore.get(dataset.datasetId) || []
          const file = files.find((f) => f.filename === filename)

          if (!file) {
            return new Response(JSON.stringify({ error: 'File not found' }), {
              status: 404,
              headers: { 'Content-Type': 'application/json' },
            })
          }

          // Track download
          const metrics = metricsStore.get(dataset.datasetId) || {
            downloads: 0,
            views: 0,
          }
          metrics.downloads++
          metricsStore.set(dataset.datasetId, metrics)

          const result = await backend.download(file.cid).catch(() => null)
          if (!result) {
            throw new Error('File not available')
          }

          const content = Buffer.isBuffer(result.content)
            ? new Uint8Array(result.content)
            : result.content
          return new Response(content, {
            headers: {
              'Content-Type': getContentType(filename),
              'Content-Disposition': `attachment; filename="${filename}"`,
              'X-Sha256': file.sha256,
            },
          })
        },
      )

      // Parquet files info (for datasets library)
      .get('/api/datasets/:org/:name/parquet', async ({ params }) => {
        const { org, name } = params

        const dataset = findDatasetByKey(`${org}/${name}`)
        if (!dataset) {
          throw new Error('Dataset not found')
        }

        const files = filesStore.get(dataset.datasetId) || []
        const parquetFiles = files.filter((f) =>
          f.filename.endsWith('.parquet'),
        )

        // Group by split
        const splits: Record<string, string[]> = {}
        for (const file of parquetFiles) {
          const split = file.split || 'train'
          if (!splits[split]) splits[split] = []
          splits[split].push(`/storage/download/${file.cid}`)
        }

        return {
          parquet_files: splits,
          features: configsStore.get(dataset.datasetId)?.features || {},
        }
      })

      // ============================================================================
      // Jeju Native API
      // ============================================================================

      // List all datasets
      .get('/', async ({ query }) => {
        const {
          org,
          q: search,
          format,
          limit,
          offset,
        } = expectValid(nativeDatasetsQuerySchema, query)

        let datasets = Array.from(datasetsStore.values())

        if (org) {
          datasets = datasets.filter(
            (d) => d.organization.toLowerCase() === org.toLowerCase(),
          )
        }

        if (search) {
          const searchLower = search.toLowerCase()
          datasets = datasets.filter(
            (d) =>
              d.name.toLowerCase().includes(searchLower) ||
              d.description.toLowerCase().includes(searchLower),
          )
        }

        if (format) {
          const formatNum =
            DatasetFormat[format.toUpperCase() as keyof typeof DatasetFormat]
          if (formatNum !== undefined) {
            datasets = datasets.filter((d) => d.format === formatNum)
          }
        }

        const total = datasets.length
        datasets = datasets.slice(offset, offset + limit)

        return {
          datasets: datasets.map((d) => ({
            ...d,
            metrics: metricsStore.get(d.datasetId) || {
              downloads: 0,
              views: 0,
            },
          })),
          total,
          limit,
          offset,
        }
      })

      // Get dataset details
      .get('/:org/:name', async ({ params }) => {
        const { org, name } = params

        const dataset = findDatasetByKey(`${org}/${name}`)
        if (!dataset) {
          throw new Error('Dataset not found')
        }

        const files = filesStore.get(dataset.datasetId) || []
        const config = configsStore.get(dataset.datasetId)
        const metrics = metricsStore.get(dataset.datasetId) || {
          downloads: 0,
          views: 0,
        }

        return {
          ...dataset,
          files,
          config,
          metrics,
        }
      })

      // Create dataset
      .post('/', async ({ body, request, set }) => {
        const headers = extractHeaders(request)
        const { 'x-jeju-address': owner } = expectValid(
          jejuAddressHeaderSchema,
          headers,
        )
        const validBody = expectValid(
          datasetCreationSchema.extend({
            isPublic: z.boolean().optional(),
          }),
          body,
        )

        const format: DatasetFormat =
          typeof validBody.format === 'string'
            ? (DatasetFormat[
                validBody.format.toUpperCase() as keyof typeof DatasetFormat
              ] ?? DatasetFormat.PARQUET)
            : ((validBody.format as DatasetFormat) ?? DatasetFormat.PARQUET)
        const license: DatasetLicense =
          typeof validBody.license === 'string'
            ? (DatasetLicense[
                validBody.license
                  .toUpperCase()
                  .replace('-', '_') as keyof typeof DatasetLicense
              ] ?? DatasetLicense.CC_BY_4)
            : ((validBody.license as DatasetLicense) ?? DatasetLicense.CC_BY_4)

        const org = validBody.organization ?? owner
        const datasetId = keccak256(
          encodePacked(
            ['string', 'string', 'address', 'uint256'],
            [org, validBody.name, owner, BigInt(Date.now())],
          ),
        )

        const dataset: Dataset = {
          datasetId,
          name: validBody.name,
          organization: org,
          owner,
          description: validBody.description,
          format,
          license,
          licenseUri: '',
          tags: validBody.tags || [],
          size: 0,
          numRows: 0,
          numFiles: 0,
          createdAt: Date.now(),
          updatedAt: Date.now(),
          isPublic: validBody.isPublic ?? true,
        }

        datasetsStore.set(datasetId, dataset)
        metricsStore.set(datasetId, { downloads: 0, views: 0 })

        set.status = 201
        return dataset
      })

      // Upload dataset files
      .post('/:org/:name/upload', async ({ params, request }) => {
        const headers = extractHeaders(request)
        const { 'x-jeju-address': owner } = expectValid(
          jejuAddressHeaderSchema,
          headers,
        )
        const { org, name } = params

        const dataset = findDatasetByKey(`${org}/${name}`)
        if (!dataset) {
          throw new Error('Dataset not found')
        }

        if (dataset.owner.toLowerCase() !== owner.toLowerCase()) {
          throw new Error('Not authorized')
        }

        const formData = await request.formData()
        const split = formData.get('split') as string | null
        const uploadedFiles: DatasetFile[] = []
        let totalSize = 0
        let totalRows = 0

        for (const [, value] of formData.entries()) {
          if (typeof value !== 'string') {
            const file = value as File
            const content = Buffer.from(await file.arrayBuffer())
            const sha256 = createHash('sha256').update(content).digest('hex')

            const result = await backend.upload(content, {
              filename: file.name,
            })

            // Estimate row count for parquet/jsonl files
            const estimatedRows = estimateRows(content, file.name)

            uploadedFiles.push({
              filename: file.name,
              cid: result.cid,
              size: content.length,
              sha256,
              split: split || getSplitFromFilename(file.name),
              numRows: estimatedRows,
            })

            totalSize += content.length
            totalRows += estimatedRows
          }
        }

        // Append to existing files
        const existingFiles = filesStore.get(dataset.datasetId) || []
        filesStore.set(dataset.datasetId, [...existingFiles, ...uploadedFiles])

        // Update dataset metadata
        dataset.size += totalSize
        dataset.numRows += totalRows
        dataset.numFiles += uploadedFiles.length
        dataset.updatedAt = Date.now()
        datasetsStore.set(dataset.datasetId, dataset)

        return { uploaded: uploadedFiles }
      })

      // Set dataset config
      .put('/:org/:name/config', async ({ params, body, request }) => {
        const headers = extractHeaders(request)
        const { 'x-jeju-address': owner } = expectValid(
          jejuAddressHeaderSchema,
          headers,
        )
        const { org, name } = params

        const dataset = findDatasetByKey(`${org}/${name}`)
        if (!dataset) {
          throw new Error('Dataset not found')
        }

        if (dataset.owner.toLowerCase() !== owner.toLowerCase()) {
          throw new Error('Not authorized')
        }

        const config = expectValid(datasetConfigSchema, body)
        configsStore.set(dataset.datasetId, config)

        return config
      })

      // Get files
      .get('/:org/:name/files', async ({ params }) => {
        const { org, name } = params

        const dataset = findDatasetByKey(`${org}/${name}`)
        if (!dataset) {
          throw new Error('Dataset not found')
        }

        const files = filesStore.get(dataset.datasetId) || []
        return files
      })

      // Download file
      .get('/:org/:name/files/:filename', async ({ params, set }) => {
        const { org, name, filename } = params

        const dataset = findDatasetByKey(`${org}/${name}`)
        if (!dataset) {
          throw new Error('Dataset not found')
        }

        const files = filesStore.get(dataset.datasetId) || []
        const file = files.find((f) => f.filename === filename)

        if (!file) {
          set.status = 404
          return { error: 'File not found' }
        }

        // Track download
        const metrics = metricsStore.get(dataset.datasetId) || {
          downloads: 0,
          views: 0,
        }
        metrics.downloads++
        metricsStore.set(dataset.datasetId, metrics)

        const result = await backend.download(file.cid)
        const content = Buffer.isBuffer(result.content)
          ? new Uint8Array(result.content)
          : result.content
        return new Response(content, {
          headers: {
            'Content-Type': getContentType(filename),
            'Content-Disposition': `attachment; filename="${filename}"`,
          },
        })
      })
  )
}

export type DatasetsRoutes = ReturnType<typeof createDatasetsRouter>

// ============================================================================
// Helpers
// ============================================================================

function findDatasetByKey(key: string): Dataset | null {
  for (const dataset of datasetsStore.values()) {
    if (`${dataset.organization}/${dataset.name}` === key) {
      return dataset
    }
  }
  return null
}

function getSizeCategory(bytes: number): string[] {
  if (bytes < 1_000_000) return ['n<1K']
  if (bytes < 10_000_000) return ['1K<n<10K']
  if (bytes < 100_000_000) return ['10K<n<100K']
  if (bytes < 1_000_000_000) return ['100K<n<1M']
  if (bytes < 10_000_000_000) return ['1M<n<10M']
  return ['n>10M']
}

function getSplitFromFilename(filename: string): string {
  const lower = filename.toLowerCase()
  if (lower.includes('train')) return 'train'
  if (lower.includes('test')) return 'test'
  if (lower.includes('valid') || lower.includes('val') || lower.includes('dev'))
    return 'validation'
  return 'train'
}

function estimateRows(content: Buffer, filename: string): number {
  // Simple estimation - in production would parse the actual file
  if (filename.endsWith('.jsonl')) {
    return content
      .toString()
      .split('\n')
      .filter((l) => l.trim()).length
  }
  if (filename.endsWith('.csv')) {
    return (
      content
        .toString()
        .split('\n')
        .filter((l) => l.trim()).length - 1
    )
  }
  // For parquet, would use actual parsing
  return 0
}

function getContentType(filename: string): string {
  if (filename.endsWith('.parquet')) return 'application/octet-stream'
  if (filename.endsWith('.csv')) return 'text/csv'
  if (filename.endsWith('.json') || filename.endsWith('.jsonl'))
    return 'application/json'
  if (filename.endsWith('.arrow')) return 'application/octet-stream'
  if (filename.endsWith('.txt')) return 'text/plain'
  return 'application/octet-stream'
}
