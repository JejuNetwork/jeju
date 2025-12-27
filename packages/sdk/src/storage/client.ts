/**
 * Jeju Storage SDK - Vercel-like API for decentralized storage
 *
 * Simple, powerful API for:
 * - File uploads and downloads
 * - Signed URLs for secure access
 * - Image optimization
 * - Resumable uploads
 * - Analytics
 */

import { createHash } from 'node:crypto'
import { z } from 'zod'

// ============ Types ============

export type StorageTier = 'system' | 'popular' | 'private'
export type StorageBackend =
  | 'ipfs'
  | 'arweave'
  | 'filecoin'
  | 'webtorrent'
  | 'local'
export type ImageFormat = 'jpeg' | 'png' | 'webp' | 'avif'
export type ImageFit = 'cover' | 'contain' | 'fill' | 'inside' | 'outside'

export interface StorageConfig {
  endpoint: string
  apiKey?: string
  defaultTier?: StorageTier
  defaultBackend?: StorageBackend
  timeout?: number
}

export interface PutOptions {
  filename?: string
  contentType?: string
  tier?: StorageTier
  backends?: StorageBackend[]
  metadata?: Record<string, string>
  // Arweave-specific
  permanent?: boolean
  // Encryption
  encrypt?: boolean
  accessPolicy?: string
  // Upload settings
  resumable?: boolean
  onProgress?: (progress: UploadProgress) => void
}

export interface UploadProgress {
  loaded: number
  total: number
  percentage: number
}

export interface PutResult {
  cid: string
  url: string
  size: number
  contentType: string
  backends: StorageBackend[]
  downloadUrl: string
  // Optional based on backends
  magnetUri?: string
  arweaveTxId?: string
  filecoinDealId?: string
}

export interface GetOptions {
  timeout?: number
  decrypt?: boolean
  preferredBackend?: StorageBackend
}

export interface HeadResult {
  cid: string
  size: number
  contentType: string
  tier: StorageTier
  backends: StorageBackend[]
  createdAt: Date
  lastAccessed?: Date
  downloadCount: number
  encrypted: boolean
}

export interface ListOptions {
  prefix?: string
  limit?: number
  cursor?: string
  tier?: StorageTier
}

export interface ListResult {
  objects: ObjectInfo[]
  cursor?: string
  hasMore: boolean
}

export interface ObjectInfo {
  cid: string
  name?: string
  size: number
  contentType: string
  tier: StorageTier
  createdAt: Date
}

export interface SignedUrlOptions {
  expiresIn?: number // Seconds
  downloadFilename?: string
  allowedIps?: string[]
  maxDownloads?: number
}

export interface SignedUploadUrlOptions {
  maxSize?: number
  allowedTypes?: string[]
  expiresIn?: number
  metadata?: Record<string, string>
}

export interface SignedUploadUrl {
  url: string
  fields: Record<string, string>
  expiresAt: Date
}

export interface ImageOptions {
  width?: number
  height?: number
  fit?: ImageFit
  format?: ImageFormat
  quality?: number
  blur?: number
  grayscale?: boolean
}

export interface StorageStats {
  totalBytes: number
  objectCount: number
  bandwidthUsed24h: number
  requestCount24h: number
  costEstimate: {
    storage: string
    bandwidth: string
    total: string
  }
}

// ============ Zod Schemas ============

const PutOptionsSchema = z.object({
  filename: z.string().optional(),
  contentType: z.string().optional(),
  tier: z.enum(['system', 'popular', 'private']).optional(),
  backends: z
    .array(z.enum(['ipfs', 'arweave', 'filecoin', 'webtorrent', 'local']))
    .optional(),
  metadata: z.record(z.string(), z.string()).optional(),
  permanent: z.boolean().optional(),
  encrypt: z.boolean().optional(),
  accessPolicy: z.string().optional(),
  resumable: z.boolean().optional(),
  onProgress: z
    .custom<
      (progress: { loaded: number; total: number; percentage: number }) => void
    >()
    .optional(),
})

const ImageOptionsSchema = z.object({
  width: z.number().min(1).max(8192).optional(),
  height: z.number().min(1).max(8192).optional(),
  fit: z.enum(['cover', 'contain', 'fill', 'inside', 'outside']).optional(),
  format: z.enum(['jpeg', 'png', 'webp', 'avif']).optional(),
  quality: z.number().min(1).max(100).optional(),
  blur: z.number().min(0).max(100).optional(),
  grayscale: z.boolean().optional(),
})

// ============ Storage Client ============

export class JejuStorage {
  private config: StorageConfig
  private baseUrl: string

  constructor(config: StorageConfig) {
    this.config = {
      timeout: 30000,
      defaultTier: 'popular',
      ...config,
    }
    this.baseUrl = config.endpoint.replace(/\/$/, '')
  }

  // ============ Core Operations ============

  /**
   * Upload content to storage
   */
  async put(
    content: Buffer | Blob | ReadableStream | string,
    options?: PutOptions,
  ): Promise<PutResult> {
    const validatedOptions = options ? PutOptionsSchema.parse(options) : {}

    // Convert content to Buffer
    let data: Buffer
    if (typeof content === 'string') {
      data = Buffer.from(content, 'utf-8')
    } else if (content instanceof Blob) {
      data = Buffer.from(await content.arrayBuffer())
    } else if (content instanceof ReadableStream) {
      data = await this.streamToBuffer(content)
    } else {
      data = content
    }

    // Handle resumable upload
    if (validatedOptions.resumable) {
      return this.resumableUpload(data, validatedOptions)
    }

    const formData = new FormData()
    // Create a fresh ArrayBuffer copy to avoid SharedArrayBuffer type issues
    const freshBuffer = new ArrayBuffer(data.byteLength)
    new Uint8Array(freshBuffer).set(data)
    const blob = new Blob([freshBuffer])
    formData.append('file', blob, validatedOptions.filename ?? 'file')

    if (validatedOptions.tier) {
      formData.append('tier', validatedOptions.tier)
    }
    if (validatedOptions.backends) {
      formData.append('backends', JSON.stringify(validatedOptions.backends))
    }
    if (validatedOptions.metadata) {
      formData.append('metadata', JSON.stringify(validatedOptions.metadata))
    }
    if (validatedOptions.permanent) {
      formData.append('permanent', 'true')
    }
    if (validatedOptions.encrypt) {
      formData.append('encrypt', 'true')
    }
    if (validatedOptions.accessPolicy) {
      formData.append('accessPolicy', validatedOptions.accessPolicy)
    }

    const response = await this.fetch('/storage/upload', {
      method: 'POST',
      body: formData,
    })

    const result = await response.json()

    return {
      cid: result.cid,
      url: `${this.baseUrl}/storage/${result.cid}`,
      size: result.size,
      contentType:
        result.contentType ??
        validatedOptions.contentType ??
        'application/octet-stream',
      backends: result.backends,
      downloadUrl: `${this.baseUrl}/storage/${result.cid}/download`,
      magnetUri: result.magnetUri,
      arweaveTxId: result.arweaveTxId,
      filecoinDealId: result.filecoinDealId,
    }
  }

  /**
   * Download content from storage
   */
  async get(cid: string, options?: GetOptions): Promise<Buffer> {
    const params = new URLSearchParams()
    if (options?.decrypt) {
      params.set('decrypt', 'true')
    }
    if (options?.preferredBackend) {
      params.set('backend', options.preferredBackend)
    }

    const queryString = params.toString()
    const url = `/storage/${cid}${queryString ? `?${queryString}` : ''}`

    const response = await this.fetch(url, {
      timeout: options?.timeout,
    })

    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  }

  /**
   * Get content metadata without downloading
   */
  async head(cid: string): Promise<HeadResult> {
    const response = await this.fetch(`/storage/${cid}/metadata`)
    const data = await response.json()

    return {
      cid: data.cid,
      size: data.size,
      contentType: data.contentType,
      tier: data.tier,
      backends: data.backends,
      createdAt: new Date(data.createdAt),
      lastAccessed: data.lastAccessed ? new Date(data.lastAccessed) : undefined,
      downloadCount: data.accessCount ?? 0,
      encrypted: data.encrypted ?? false,
    }
  }

  /**
   * Delete content from storage
   */
  async del(cid: string): Promise<void> {
    await this.fetch(`/storage/${cid}`, {
      method: 'DELETE',
    })
  }

  /**
   * List stored objects
   */
  async list(options?: ListOptions): Promise<ListResult> {
    const params = new URLSearchParams()
    if (options?.prefix) params.set('prefix', options.prefix)
    if (options?.limit) params.set('limit', String(options.limit))
    if (options?.cursor) params.set('cursor', options.cursor)
    if (options?.tier) params.set('tier', options.tier)

    const response = await this.fetch(`/storage?${params.toString()}`)
    const data = await response.json()

    return {
      objects: data.objects.map((obj: Record<string, unknown>) => ({
        cid: obj.cid,
        name: obj.name,
        size: obj.size,
        contentType: obj.contentType,
        tier: obj.tier,
        createdAt: new Date(obj.createdAt as string),
      })),
      cursor: data.cursor,
      hasMore: data.hasMore,
    }
  }

  /**
   * Check if content exists
   */
  async exists(cid: string): Promise<boolean> {
    const response = await this.fetch(`/storage/${cid}/exists`)
    const data = await response.json()
    return data.exists
  }

  // ============ Signed URLs ============

  /**
   * Create a signed download URL
   */
  async createSignedUrl(
    cid: string,
    options?: SignedUrlOptions,
  ): Promise<string> {
    const response = await this.fetch('/storage/signed-url', {
      method: 'POST',
      body: JSON.stringify({
        cid,
        action: 'download',
        expiresIn: options?.expiresIn ?? 3600,
        downloadFilename: options?.downloadFilename,
        allowedIps: options?.allowedIps,
        maxDownloads: options?.maxDownloads,
      }),
    })

    const data = await response.json()
    return data.signedUrl
  }

  /**
   * Create a signed upload URL for direct browser uploads
   */
  async createUploadUrl(
    options?: SignedUploadUrlOptions,
  ): Promise<SignedUploadUrl> {
    const response = await this.fetch('/storage/upload-url', {
      method: 'POST',
      body: JSON.stringify({
        maxSize: options?.maxSize ?? 100 * 1024 * 1024, // 100MB default
        allowedTypes: options?.allowedTypes,
        expiresIn: options?.expiresIn ?? 3600,
        metadata: options?.metadata,
      }),
    })

    const data = await response.json()

    return {
      url: data.url,
      fields: data.fields,
      expiresAt: new Date(data.expiresAt),
    }
  }

  // ============ Image Optimization ============

  /**
   * Get an optimized image URL
   */
  getImageUrl(cid: string, options?: ImageOptions): string {
    const validatedOptions = options ? ImageOptionsSchema.parse(options) : {}

    const params = new URLSearchParams()
    if (validatedOptions.width) params.set('w', String(validatedOptions.width))
    if (validatedOptions.height)
      params.set('h', String(validatedOptions.height))
    if (validatedOptions.fit) params.set('fit', validatedOptions.fit)
    if (validatedOptions.format) params.set('f', validatedOptions.format)
    if (validatedOptions.quality)
      params.set('q', String(validatedOptions.quality))
    if (validatedOptions.blur) params.set('blur', String(validatedOptions.blur))
    if (validatedOptions.grayscale) params.set('grayscale', 'true')

    const queryString = params.toString()
    return `${this.baseUrl}/image/${cid}${queryString ? `?${queryString}` : ''}`
  }

  /**
   * Get optimized image as buffer
   */
  async getOptimizedImage(
    cid: string,
    options?: ImageOptions,
  ): Promise<Buffer> {
    const url = this.getImageUrl(cid, options)
    const response = await fetch(url, this.getRequestInit())
    const arrayBuffer = await response.arrayBuffer()
    return Buffer.from(arrayBuffer)
  }

  /**
   * Generate responsive image srcset
   */
  getResponsiveSrcset(
    cid: string,
    options?: { widths?: number[]; format?: ImageFormat; quality?: number },
  ): string {
    const widths = options?.widths ?? [320, 640, 960, 1280, 1920]
    const format = options?.format ?? 'webp'
    const quality = options?.quality ?? 80

    return widths
      .map((w) => {
        const url = this.getImageUrl(cid, { width: w, format, quality })
        return `${url} ${w}w`
      })
      .join(', ')
  }

  // ============ Resumable Uploads ============

  /**
   * Start a resumable upload session
   */
  async createUploadSession(
    fileSize: number,
    options?: {
      filename?: string
      contentType?: string
      metadata?: Record<string, string>
    },
  ): Promise<{
    uploadUrl: string
    uploadId: string
    expiresAt: Date
  }> {
    const response = await this.fetch('/tus', {
      method: 'POST',
      headers: {
        'Upload-Length': String(fileSize),
        'Upload-Metadata': this.encodeMetadata({
          filename: options?.filename ?? 'file',
          filetype: options?.contentType ?? 'application/octet-stream',
          ...options?.metadata,
        }),
      },
    })

    const location = response.headers.get('Location')
    const expires = response.headers.get('Upload-Expires')

    if (!location) {
      throw new Error('No upload URL returned')
    }

    const uploadId = location.split('/').pop() ?? ''

    return {
      uploadUrl: location,
      uploadId,
      expiresAt: expires ? new Date(expires) : new Date(Date.now() + 86400000),
    }
  }

  /**
   * Upload a chunk to a resumable session
   */
  async uploadChunk(
    uploadUrl: string,
    chunk: Buffer,
    offset: number,
  ): Promise<{ offset: number; completed: boolean }> {
    // Create a fresh ArrayBuffer copy to avoid SharedArrayBuffer type issues
    const freshBuffer = new ArrayBuffer(chunk.byteLength)
    new Uint8Array(freshBuffer).set(chunk)
    const response = await this.fetch(uploadUrl, {
      method: 'PATCH',
      headers: {
        'Content-Type': 'application/offset+octet-stream',
        'Upload-Offset': String(offset),
      },
      body: freshBuffer,
    })

    const newOffset = Number.parseInt(
      response.headers.get('Upload-Offset') ?? String(offset + chunk.length),
      10,
    )

    return {
      offset: newOffset,
      completed: response.status === 204,
    }
  }

  /**
   * Get upload session status
   */
  async getUploadStatus(uploadUrl: string): Promise<{
    offset: number
    total: number
    percentage: number
    completed: boolean
  }> {
    const response = await this.fetch(uploadUrl, {
      method: 'HEAD',
    })

    const offset = Number.parseInt(
      response.headers.get('Upload-Offset') ?? '0',
      10,
    )
    const total = Number.parseInt(
      response.headers.get('Upload-Length') ?? '0',
      10,
    )

    return {
      offset,
      total,
      percentage: total > 0 ? (offset / total) * 100 : 0,
      completed: offset >= total,
    }
  }

  // ============ Analytics ============

  /**
   * Get storage statistics
   */
  async getStats(): Promise<StorageStats> {
    const response = await this.fetch('/storage/stats')
    const data = await response.json()

    return {
      totalBytes: data.totalBytes,
      objectCount: data.objectCount,
      bandwidthUsed24h: data.bandwidthUsed24h,
      requestCount24h: data.requestCount24h,
      costEstimate: {
        storage: data.costEstimate?.storage ?? '0',
        bandwidth: data.costEstimate?.bandwidth ?? '0',
        total: data.costEstimate?.total ?? '0',
      },
    }
  }

  /**
   * Get content analytics
   */
  async getContentAnalytics(cid: string): Promise<{
    downloads24h: number
    downloads7d: number
    bandwidth24h: number
    bandwidth7d: number
    topRegions: Array<{ region: string; count: number }>
  }> {
    const response = await this.fetch(`/storage/${cid}/analytics`)
    return response.json()
  }

  // ============ Batch Operations ============

  /**
   * Upload multiple files
   */
  async putMany(
    files: Array<{ content: Buffer; filename: string; options?: PutOptions }>,
  ): Promise<PutResult[]> {
    return Promise.all(
      files.map(({ content, filename, options }) =>
        this.put(content, { ...options, filename }),
      ),
    )
  }

  /**
   * Download multiple files
   */
  async getMany(cids: string[]): Promise<Array<{ cid: string; data: Buffer }>> {
    return Promise.all(
      cids.map(async (cid) => ({
        cid,
        data: await this.get(cid),
      })),
    )
  }

  /**
   * Delete multiple files
   */
  async delMany(cids: string[]): Promise<void> {
    await Promise.all(cids.map((cid) => this.del(cid)))
  }

  // ============ Utility Methods ============

  /**
   * Copy content to a different tier or backend
   */
  async copy(
    sourceCid: string,
    options: { tier?: StorageTier; backends?: StorageBackend[] },
  ): Promise<PutResult> {
    const response = await this.fetch('/storage/copy', {
      method: 'POST',
      body: JSON.stringify({
        sourceCid,
        tier: options.tier,
        backends: options.backends,
      }),
    })

    return response.json()
  }

  /**
   * Pin content to ensure persistence
   */
  async pin(
    cid: string,
    options?: { backends?: StorageBackend[] },
  ): Promise<void> {
    await this.fetch(`/storage/${cid}/pin`, {
      method: 'POST',
      body: JSON.stringify({ backends: options?.backends }),
    })
  }

  /**
   * Unpin content
   */
  async unpin(cid: string): Promise<void> {
    await this.fetch(`/storage/${cid}/pin`, {
      method: 'DELETE',
    })
  }

  /**
   * Calculate content hash without uploading
   */
  calculateHash(content: Buffer): string {
    return createHash('sha256').update(content).digest('hex')
  }

  // ============ Internal Methods ============

  private async resumableUpload(
    data: Buffer,
    options: z.infer<typeof PutOptionsSchema>,
  ): Promise<PutResult> {
    const chunkSize = 5 * 1024 * 1024 // 5MB chunks

    // Create upload session
    const session = await this.createUploadSession(data.length, {
      filename: options.filename,
      contentType: options.contentType,
    })

    // Upload chunks
    let offset = 0
    while (offset < data.length) {
      const chunk = data.subarray(offset, offset + chunkSize)
      const result = await this.uploadChunk(session.uploadUrl, chunk, offset)
      offset = result.offset

      if (options.onProgress) {
        options.onProgress({
          loaded: offset,
          total: data.length,
          percentage: (offset / data.length) * 100,
        })
      }
    }

    // Get final result
    const response = await this.fetch(`${session.uploadUrl}/complete`)
    const finalResult = await response.json()

    return {
      cid: finalResult.cid,
      url: `${this.baseUrl}/storage/${finalResult.cid}`,
      size: data.length,
      contentType: options.contentType ?? 'application/octet-stream',
      backends: finalResult.backends,
      downloadUrl: `${this.baseUrl}/storage/${finalResult.cid}/download`,
    }
  }

  private async streamToBuffer(stream: ReadableStream): Promise<Buffer> {
    const chunks: Uint8Array[] = []
    const reader = stream.getReader()

    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      if (value) chunks.push(value)
    }

    return Buffer.concat(chunks)
  }

  private encodeMetadata(metadata: Record<string, string>): string {
    return Object.entries(metadata)
      .map(([key, value]) => `${key} ${Buffer.from(value).toString('base64')}`)
      .join(',')
  }

  private getRequestInit(options?: {
    method?: string
    body?: BodyInit
    headers?: Record<string, string>
    timeout?: number
  }): RequestInit {
    const headers: Record<string, string> = {
      ...options?.headers,
    }

    if (this.config.apiKey) {
      headers.Authorization = `Bearer ${this.config.apiKey}`
    }

    if (options?.body && !(options.body instanceof FormData)) {
      headers['Content-Type'] = 'application/json'
    }

    return {
      method: options?.method ?? 'GET',
      headers,
      body: options?.body,
      signal: options?.timeout
        ? AbortSignal.timeout(options.timeout)
        : AbortSignal.timeout(this.config.timeout ?? 30000),
    }
  }

  private async fetch(
    path: string,
    options?: {
      method?: string
      body?: BodyInit
      headers?: Record<string, string>
      timeout?: number
    },
  ): Promise<Response> {
    const url = path.startsWith('http') ? path : `${this.baseUrl}${path}`
    const response = await fetch(url, this.getRequestInit(options))

    if (!response.ok) {
      const errorText = await response.text()
      throw new Error(`Storage API error: ${response.status} - ${errorText}`)
    }

    return response
  }
}

// ============ Factory Function ============

export function createStorage(config: StorageConfig): JejuStorage {
  return new JejuStorage(config)
}

// ============ Default Export ============

export default JejuStorage
