<<<<<<< HEAD
=======
/**
 * TUS Resumable Upload Protocol Implementation
 *
 * Implements the TUS protocol (https://tus.io/) for resumable uploads
 *
 * Features:
 * - Resumable file uploads with chunk-based transfer
 * - Support for parallel chunk uploads
 * - Automatic retry on failure
 * - Upload progress tracking
 * - Concatenation for multi-part uploads
 * - Metadata support
 *
 * Workerd compatible: Uses exec API for file operations.
 * State persistence: Uses EQLite for distributed upload state tracking.
 */

>>>>>>> db0e2406eef4fd899ba4a5aa090db201bcbe36bf
import { createHash, randomBytes } from 'node:crypto'
import { getLocalhostHost } from '@jejunetwork/config'
import { type EQLiteClient, getEQLite } from '@jejunetwork/db'
import type { Address } from 'viem'

// Config injection for workerd compatibility
interface TusEnvConfig {
  execUrl: string
  uploadDir: string
}

let envConfig: TusEnvConfig = {
  execUrl: `http://${getLocalhostHost()}:4020/exec`,
  uploadDir: '/tmp/dws-tus-uploads',
}

export function configureTusUpload(config: Partial<TusEnvConfig>): void {
  envConfig = { ...envConfig, ...config }
}

// DWS Exec API

interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

async function exec(
  command: string[],
  options?: { stdin?: string },
): Promise<ExecResult> {
  const response = await fetch(envConfig.execUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, ...options }),
  })
  if (!response.ok) {
    throw new Error(`Exec API error: ${response.status}`)
  }
  return response.json() as Promise<ExecResult>
}

async function fileExists(path: string): Promise<boolean> {
  const result = await exec(['test', '-e', path])
  return result.exitCode === 0
}

async function mkdir(path: string): Promise<void> {
  await exec(['mkdir', '-p', path])
}

async function readFileAsync(path: string): Promise<Buffer> {
  const result = await exec(['base64', path])
  if (result.exitCode !== 0) {
    throw new Error(`Failed to read file: ${result.stderr}`)
  }
  return Buffer.from(result.stdout.trim(), 'base64')
}

async function writeFileAsync(path: string, content: Buffer): Promise<void> {
  const base64Content = content.toString('base64')
  // Use base64 decode to write binary safely
  await exec(['sh', '-c', `echo '${base64Content}' | base64 -d > "${path}"`])
}

async function appendFileAsync(path: string, content: Buffer): Promise<void> {
  const base64Content = content.toString('base64')
  await exec(['sh', '-c', `echo '${base64Content}' | base64 -d >> "${path}"`])
}

async function rmFile(path: string): Promise<void> {
  await exec(['rm', '-f', path])
}

function joinPath(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/')
}

// ============ Types ============

export type UploadStatus =
  | 'created' // Upload created but not started
  | 'uploading' // Upload in progress
  | 'paused' // Upload paused
  | 'finalizing' // Upload complete, processing
  | 'completed' // Upload fully processed
  | 'failed' // Upload failed
  | 'expired' // Upload expired

export interface TusUpload {
  uploadId: string
  uploadUrl: string
  fileSize: number
  uploadOffset: number
  metadata: TusMetadata
  status: UploadStatus
  createdAt: number
  updatedAt: number
  expiresAt: number
  chunks: ChunkInfo[]
  owner?: Address
  finalCid?: string
  finalUrl?: string
  errorMessage?: string
}

export interface TusMetadata {
  filename?: string
  filetype?: string
  contentType?: string
  checksum?: string // Expected checksum for validation
  tier?: 'system' | 'popular' | 'private'
  category?: string
  customFields?: Record<string, string>
}

export interface ChunkInfo {
  chunkIndex: number
  offset: number
  size: number
  checksum: string
  uploadedAt: number
  verified: boolean
}

export interface TusCapabilities {
  version: string
  extensions: string[]
  maxSize: number
  checksumAlgorithms: string[]
  expirationDays: number
}

export interface TusUploadCreateRequest {
  uploadLength: number
  uploadMetadata?: string // Base64 encoded key-value pairs
  uploadConcat?: string // For concatenation extension
  uploadDeferLength?: boolean // For unknown file size
}

export interface TusUploadPatchRequest {
  uploadOffset: number
  contentLength: number
  contentType: string
  chunk: Buffer
  uploadChecksum?: string
}

export interface TusConfig {
  baseUrl: string
  uploadDir: string
  maxFileSize: number
  defaultExpiryHours: number
  maxConcurrentChunks: number
  chunkSize: number
  supportedChecksums: string[]
  onUploadComplete?: (upload: TusUpload) => Promise<void>
}

// ============ Default Configuration ============

const DEFAULT_CONFIG: TusConfig = {
  baseUrl: `http://${getLocalhostHost()}:3100`,
  uploadDir: envConfig.uploadDir,
  maxFileSize: 10 * 1024 * 1024 * 1024, // 10GB
  defaultExpiryHours: 24,
  maxConcurrentChunks: 4,
  chunkSize: 5 * 1024 * 1024, // 5MB chunks
  supportedChecksums: ['sha256', 'md5', 'crc32'],
}

// ============ TUS Protocol Version ============

const TUS_VERSION = '1.0.0'
const TUS_EXTENSIONS = [
  'creation',
  'creation-with-upload',
  'termination',
  'checksum',
  'checksum-trailer',
  'concatenation',
  'concatenation-unfinished',
  'expiration',
]

// ============ EQLite State Storage ============

const TUS_DB_ID = process.env.EQLITE_DATABASE_ID ?? 'dws-tus-uploads'

let eqliteClient: EQLiteClient | null = null
let tablesInitialized = false

async function getTusEQLiteClient(): Promise<EQLiteClient> {
  if (!eqliteClient) {
    eqliteClient = getEQLite({
      databaseId: TUS_DB_ID,
      timeout: 30000,
      debug: process.env.NODE_ENV !== 'production',
    })
  }
  return eqliteClient
}

async function ensureTusTables(): Promise<void> {
  if (tablesInitialized) return

  const client = await getTusEQLiteClient()

  await client.exec(
    `CREATE TABLE IF NOT EXISTS tus_uploads (
      upload_id TEXT PRIMARY KEY,
      upload_url TEXT NOT NULL,
      file_size INTEGER NOT NULL,
      upload_offset INTEGER NOT NULL,
      metadata TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL,
      chunks TEXT NOT NULL,
      owner TEXT,
      final_cid TEXT,
      final_url TEXT,
      error_message TEXT
    )`,
    [],
    TUS_DB_ID,
  )

  await client.exec(
    `CREATE INDEX IF NOT EXISTS idx_tus_status ON tus_uploads(status)`,
    [],
    TUS_DB_ID,
  )
  await client.exec(
    `CREATE INDEX IF NOT EXISTS idx_tus_expires ON tus_uploads(expires_at)`,
    [],
    TUS_DB_ID,
  )

  tablesInitialized = true
}

interface TusUploadRow {
  upload_id: string
  upload_url: string
  file_size: number
  upload_offset: number
  metadata: string
  status: string
  created_at: number
  updated_at: number
  expires_at: number
  chunks: string
  owner: string | null
  final_cid: string | null
  final_url: string | null
  error_message: string | null
}

function rowToUpload(row: TusUploadRow): TusUpload {
  return {
    uploadId: row.upload_id,
    uploadUrl: row.upload_url,
    fileSize: row.file_size,
    uploadOffset: row.upload_offset,
    metadata: JSON.parse(row.metadata),
    status: row.status as UploadStatus,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
    chunks: JSON.parse(row.chunks),
    owner: row.owner as Address | undefined,
    finalCid: row.final_cid ?? undefined,
    finalUrl: row.final_url ?? undefined,
    errorMessage: row.error_message ?? undefined,
  }
}

const tusState = {
  async saveUpload(upload: TusUpload): Promise<void> {
    await ensureTusTables()
    const client = await getTusEQLiteClient()
    await client.exec(
      `INSERT INTO tus_uploads (upload_id, upload_url, file_size, upload_offset, metadata, status, created_at, updated_at, expires_at, chunks, owner, final_cid, final_url, error_message)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(upload_id) DO UPDATE SET
         upload_offset = excluded.upload_offset,
         metadata = excluded.metadata,
         status = excluded.status,
         updated_at = excluded.updated_at,
         expires_at = excluded.expires_at,
         chunks = excluded.chunks,
         final_cid = excluded.final_cid,
         final_url = excluded.final_url,
         error_message = excluded.error_message`,
      [
        upload.uploadId,
        upload.uploadUrl,
        upload.fileSize,
        upload.uploadOffset,
        JSON.stringify(upload.metadata),
        upload.status,
        upload.createdAt,
        upload.updatedAt,
        upload.expiresAt,
        JSON.stringify(upload.chunks),
        upload.owner ?? null,
        upload.finalCid ?? null,
        upload.finalUrl ?? null,
        upload.errorMessage ?? null,
      ],
      TUS_DB_ID,
    )
  },

  async getUpload(uploadId: string): Promise<TusUpload | null> {
    await ensureTusTables()
    const client = await getTusEQLiteClient()
    const result = await client.query<TusUploadRow>(
      `SELECT * FROM tus_uploads WHERE upload_id = ?`,
      [uploadId],
      TUS_DB_ID,
    )
    const row = result.rows[0]
    return row ? rowToUpload(row) : null
  },

  async deleteUpload(uploadId: string): Promise<void> {
    await ensureTusTables()
    const client = await getTusEQLiteClient()
    await client.exec(
      `DELETE FROM tus_uploads WHERE upload_id = ?`,
      [uploadId],
      TUS_DB_ID,
    )
  },

  async getAllUploads(): Promise<TusUpload[]> {
    await ensureTusTables()
    const client = await getTusEQLiteClient()
    const result = await client.query<TusUploadRow>(
      `SELECT * FROM tus_uploads`,
      [],
      TUS_DB_ID,
    )
    return result.rows.map(rowToUpload)
  },

  async getActiveUploads(): Promise<TusUpload[]> {
    await ensureTusTables()
    const client = await getTusEQLiteClient()
    const result = await client.query<TusUploadRow>(
      `SELECT * FROM tus_uploads WHERE status IN ('created', 'uploading', 'paused', 'finalizing')`,
      [],
      TUS_DB_ID,
    )
    return result.rows.map(rowToUpload)
  },

  async getExpiredUploads(now: number): Promise<TusUpload[]> {
    await ensureTusTables()
    const client = await getTusEQLiteClient()
    const result = await client.query<TusUploadRow>(
      `SELECT * FROM tus_uploads WHERE expires_at < ? AND status NOT IN ('completed', 'expired')`,
      [now],
      TUS_DB_ID,
    )
    return result.rows.map(rowToUpload)
  },
}

// ============ TUS Upload Manager ============

export class TusUploadManager {
  private config: TusConfig
  private initialized = false
  private testMode = false
  private testChunks: Map<string, Buffer> = new Map() // In-memory storage for test mode only
  private testUploads: Map<string, TusUpload> = new Map() // In-memory for test mode only

  constructor(config?: Partial<TusConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    await ensureTusTables()
    await this.ensureUploadDir()
    this.startCleanupInterval()
    this.initialized = true
  }

  /**
   * Initialize for testing - runs in memory-only mode without exec API calls
   */
  async initializeForTesting(): Promise<void> {
    if (this.initialized) return
    this.testMode = true
    this.initialized = true
  }

  private async ensureUploadDir(): Promise<void> {
    const exists = await fileExists(this.config.uploadDir)
    if (!exists) {
      await mkdir(this.config.uploadDir)
    }
  }

  private startCleanupInterval(): void {
    // Clean up expired uploads every hour
    setInterval(() => {
      this.cleanupExpiredUploads()
    }, 3600000)
  }

  // ============ TUS Protocol Methods ============

  getCapabilities(): TusCapabilities {
    return {
      version: TUS_VERSION,
      extensions: TUS_EXTENSIONS,
      maxSize: this.config.maxFileSize,
      checksumAlgorithms: this.config.supportedChecksums,
      expirationDays: Math.ceil(this.config.defaultExpiryHours / 24),
    }
  }

  getTusHeaders(): Record<string, string> {
    return {
      'Tus-Resumable': TUS_VERSION,
      'Tus-Version': TUS_VERSION,
      'Tus-Extension': TUS_EXTENSIONS.join(','),
      'Tus-Max-Size': String(this.config.maxFileSize),
      'Tus-Checksum-Algorithm': this.config.supportedChecksums.join(','),
    }
  }

  // ============ Upload Creation ============

  async createUpload(
    request: TusUploadCreateRequest,
    owner?: Address,
  ): Promise<TusUpload> {
    const uploadId = `upload_${Date.now()}_${randomBytes(12).toString('hex')}`
    const now = Date.now()

    // Parse metadata
    const metadata = this.parseMetadata(request.uploadMetadata ?? '')

    // Validate file size
    if (request.uploadLength > this.config.maxFileSize) {
      throw new Error(
        `File size exceeds maximum allowed (${this.config.maxFileSize} bytes)`,
      )
    }

    const upload: TusUpload = {
      uploadId,
      uploadUrl: `${this.config.baseUrl}/tus/${uploadId}`,
      fileSize: request.uploadLength,
      uploadOffset: 0,
      metadata,
      status: 'created',
      createdAt: now,
      updatedAt: now,
      expiresAt: now + this.config.defaultExpiryHours * 3600000,
      chunks: [],
      owner,
    }

    if (!this.testMode) {
      // Create upload file
      const uploadPath = this.getUploadPath(uploadId)
      await writeFileAsync(uploadPath, Buffer.alloc(0))

      // Save upload metadata
      await this.saveUploadMetadata(upload)
      await tusState.saveUpload(upload)
    } else {
      // In test mode, initialize empty buffer and use in-memory storage
      this.testChunks.set(uploadId, Buffer.alloc(0))
      this.testUploads.set(uploadId, upload)
    }

    return upload
  }

  private parseMetadata(metadataStr: string): TusMetadata {
    if (!metadataStr) return {}

    const metadata: TusMetadata = {}
    const customFields: Record<string, string> = {}

    const pairs = metadataStr.split(',')
    for (const pair of pairs) {
      const [key, encodedValue] = pair.trim().split(' ')
      if (!key) continue

      const value = encodedValue
        ? Buffer.from(encodedValue, 'base64').toString('utf-8')
        : ''

      switch (key.toLowerCase()) {
        case 'filename':
          metadata.filename = value
          break
        case 'filetype':
        case 'type':
          metadata.filetype = value
          break
        case 'content-type':
        case 'contenttype':
          metadata.contentType = value
          break
        case 'checksum':
          metadata.checksum = value
          break
        case 'tier':
          metadata.tier = value as 'system' | 'popular' | 'private'
          break
        case 'category':
          metadata.category = value
          break
        default:
          customFields[key] = value
      }
    }

    if (Object.keys(customFields).length > 0) {
      metadata.customFields = customFields
    }

    return metadata
  }

  // ============ Upload Patching (Chunk Upload) ============

  async patchUpload(
    uploadId: string,
    request: TusUploadPatchRequest,
  ): Promise<TusUpload> {
    const upload = await this.getUpload(uploadId)
    if (!upload) {
      throw new Error('Upload not found')
    }

    if (upload.status === 'completed' || upload.status === 'failed') {
      throw new Error(`Upload is already ${upload.status}`)
    }

    if (upload.status === 'expired') {
      throw new Error('Upload has expired')
    }

    // Validate offset
    if (request.uploadOffset !== upload.uploadOffset) {
      throw new Error(
        `Offset mismatch: expected ${upload.uploadOffset}, got ${request.uploadOffset}`,
      )
    }

    // Validate checksum if provided
    if (request.uploadChecksum) {
      const [algo, expectedHash] = request.uploadChecksum.split(' ')
      const actualHash = this.calculateChecksum(request.chunk, algo)

      if (actualHash !== expectedHash) {
        throw new Error('Checksum mismatch')
      }
    }

    if (!this.testMode) {
      // Write chunk to file (append for sequential uploads)
      const uploadPath = this.getUploadPath(uploadId)
      await appendFileAsync(uploadPath, request.chunk)
    } else {
      // In test mode, append to in-memory buffer
      const existing = this.testChunks.get(uploadId) ?? Buffer.alloc(0)
      this.testChunks.set(uploadId, Buffer.concat([existing, request.chunk]))
    }

    // Update upload state
    const chunkInfo: ChunkInfo = {
      chunkIndex: upload.chunks.length,
      offset: request.uploadOffset,
      size: request.chunk.length,
      checksum: this.calculateChecksum(request.chunk, 'sha256'),
      uploadedAt: Date.now(),
      verified: !!request.uploadChecksum,
    }

    upload.chunks.push(chunkInfo)
    upload.uploadOffset += request.chunk.length
    upload.updatedAt = Date.now()
    upload.status = 'uploading'

    // Check if upload is complete
    if (upload.uploadOffset >= upload.fileSize) {
      upload.status = 'finalizing'
      if (!this.testMode) {
        await this.finalizeUpload(upload)
      } else {
        // In test mode, just mark as completed
        upload.status = 'completed'
      }
    }

    if (!this.testMode) {
      await this.saveUploadMetadata(upload)
      await tusState.saveUpload(upload)
    } else {
      this.testUploads.set(uploadId, upload)
    }
    return upload
  }

  private async finalizeUpload(upload: TusUpload): Promise<void> {
    const uploadPath = this.getUploadPath(upload.uploadId)

    // Verify final checksum if provided
    if (upload.metadata.checksum) {
      const fileData = await readFileAsync(uploadPath)
      const actualChecksum = this.calculateChecksum(fileData, 'sha256')

      if (actualChecksum !== upload.metadata.checksum) {
        upload.status = 'failed'
        upload.errorMessage = 'Final checksum verification failed'
        await this.saveUploadMetadata(upload)
        return
      }
    }

    // Calculate content CID
    const fileData = await readFileAsync(uploadPath)
    const cid = this.calculateChecksum(fileData, 'sha256')

    upload.finalCid = cid
    upload.finalUrl = `${this.config.baseUrl}/storage/${cid}`
    upload.status = 'completed'
    upload.updatedAt = Date.now()

    await this.saveUploadMetadata(upload)

    // Call completion callback if provided
    if (this.config.onUploadComplete) {
      await this.config.onUploadComplete(upload)
    }
  }

  // ============ Upload Status ============

  async getUpload(uploadId: string): Promise<TusUpload | undefined> {
    // In test mode, use in-memory storage
    if (this.testMode) {
      return this.testUploads.get(uploadId)
    }

    // Get from EQLite
    const upload = await tusState.getUpload(uploadId)
    if (!upload) return undefined

    // Check for expiration
    if (Date.now() > upload.expiresAt && upload.status !== 'completed') {
      upload.status = 'expired'
      await tusState.saveUpload(upload)
    }

    return upload
  }

  getUploadHeaders(upload: TusUpload): Record<string, string> {
    return {
      'Upload-Offset': String(upload.uploadOffset),
      'Upload-Length': String(upload.fileSize),
      'Upload-Expires': new Date(upload.expiresAt).toUTCString(),
      'Upload-Metadata': this.encodeMetadata(upload.metadata),
    }
  }

  private encodeMetadata(metadata: TusMetadata): string {
    const pairs: string[] = []

    if (metadata.filename) {
      pairs.push(
        `filename ${Buffer.from(metadata.filename).toString('base64')}`,
      )
    }
    if (metadata.filetype) {
      pairs.push(
        `filetype ${Buffer.from(metadata.filetype).toString('base64')}`,
      )
    }
    if (metadata.contentType) {
      pairs.push(
        `content-type ${Buffer.from(metadata.contentType).toString('base64')}`,
      )
    }
    if (metadata.tier) {
      pairs.push(`tier ${Buffer.from(metadata.tier).toString('base64')}`)
    }
    if (metadata.category) {
      pairs.push(
        `category ${Buffer.from(metadata.category).toString('base64')}`,
      )
    }
    if (metadata.customFields) {
      for (const [key, value] of Object.entries(metadata.customFields)) {
        pairs.push(`${key} ${Buffer.from(value).toString('base64')}`)
      }
    }

    return pairs.join(',')
  }

  // ============ Upload Termination ============

  async terminateUpload(uploadId: string): Promise<boolean> {
    const upload = await tusState.getUpload(uploadId)
    if (!upload) {
      return false
    }

    if (!this.testMode) {
      // Delete upload file
      const uploadPath = this.getUploadPath(uploadId)
      const uploadExists = await fileExists(uploadPath)
      if (uploadExists) {
        await rmFile(uploadPath)
      }

      // Delete metadata file
      const metadataPath = this.getMetadataPath(uploadId)
      const metaExists = await fileExists(metadataPath)
      if (metaExists) {
        await rmFile(metadataPath)
      }
      await tusState.deleteUpload(uploadId)
    } else {
      // In test mode, just remove from memory
      this.testChunks.delete(uploadId)
      this.testUploads.delete(uploadId)
    }

    return true
  }

  // ============ Concatenation Extension ============

  async concatenateUploads(
    uploadIds: string[],
    metadata?: TusMetadata,
    owner?: Address,
  ): Promise<TusUpload> {
    const uploads: TusUpload[] = []
    for (const id of uploadIds) {
      const upload = await this.getUpload(id)
      if (!upload) {
        throw new Error(`Upload ${id} not found`)
      }
      if (upload.status !== 'completed') {
        throw new Error(`Upload ${id} is not completed`)
      }
      uploads.push(upload)
    }

    // Calculate total size
    const totalSize = uploads.reduce((sum, u) => sum + u.fileSize, 0)

    // Create new upload for concatenated result
    const concatUpload = await this.createUpload(
      {
        uploadLength: totalSize,
        uploadMetadata: this.encodeMetadata(metadata ?? {}),
      },
      owner,
    )

    // Concatenate files using cat command
    const outputPath = this.getUploadPath(concatUpload.uploadId)
    const inputPaths = uploads.map((u) => this.getUploadPath(u.uploadId))

    // Use cat to concatenate files
    const result = await exec([
      'sh',
      '-c',
      `cat ${inputPaths.map((p) => `"${p}"`).join(' ')} > "${outputPath}"`,
    ])
    if (result.exitCode !== 0) {
      throw new Error(`Failed to concatenate files: ${result.stderr}`)
    }

    // Mark as finalizing
    concatUpload.status = 'finalizing'
    concatUpload.uploadOffset = totalSize

    // Finalize asynchronously
    await this.finalizeUpload(concatUpload)

    return concatUpload
  }

  // ============ Parallel Chunk Upload Support ============

  async getChunkUploadUrls(
    uploadId: string,
  ): Promise<Array<{ url: string; offset: number; size: number }>> {
    const upload = await this.getUpload(uploadId)
    if (!upload) {
      throw new Error('Upload not found')
    }

    const chunkUrls: Array<{ url: string; offset: number; size: number }> = []
    const chunkSize = this.config.chunkSize
    let offset = 0

    while (offset < upload.fileSize) {
      const size = Math.min(chunkSize, upload.fileSize - offset)
      chunkUrls.push({
        url: `${upload.uploadUrl}?chunk=${chunkUrls.length}&offset=${offset}`,
        offset,
        size,
      })
      offset += size
    }

    return chunkUrls
  }

  // ============ Progress and Stats ============

  async getUploadProgress(uploadId: string): Promise<{
    percent: number
    uploadedBytes: number
    totalBytes: number
    chunksUploaded: number
    estimatedTimeRemaining?: number
  }> {
    const upload = await this.getUpload(uploadId)
    if (!upload) {
      throw new Error('Upload not found')
    }

    const percent = (upload.uploadOffset / upload.fileSize) * 100

    // Estimate time remaining based on upload speed
    let estimatedTimeRemaining: number | undefined
    if (upload.chunks.length >= 2) {
      const recentChunks = upload.chunks.slice(-5)
      const firstChunk = recentChunks[0]
      const lastChunk = recentChunks[recentChunks.length - 1]

      const bytesTransferred = recentChunks.reduce((sum, c) => sum + c.size, 0)
      const timeElapsed = lastChunk.uploadedAt - firstChunk.uploadedAt

      if (timeElapsed > 0) {
        const bytesPerMs = bytesTransferred / timeElapsed
        const remainingBytes = upload.fileSize - upload.uploadOffset
        estimatedTimeRemaining = remainingBytes / bytesPerMs
      }
    }

    return {
      percent,
      uploadedBytes: upload.uploadOffset,
      totalBytes: upload.fileSize,
      chunksUploaded: upload.chunks.length,
      estimatedTimeRemaining,
    }
  }

  async getActiveUploads(): Promise<TusUpload[]> {
    if (this.testMode) {
      return Array.from(this.testUploads.values()).filter(
        (u) => u.status === 'created' || u.status === 'uploading',
      )
    }
    return await tusState.getActiveUploads()
  }

  // ============ Cleanup ============

  async cleanupExpiredUploads(): Promise<number> {
    const now = Date.now()
    let cleaned = 0

    if (this.testMode) {
      for (const [uploadId, upload] of this.testUploads) {
        if (now > upload.expiresAt && upload.status !== 'completed') {
          await this.terminateUpload(uploadId)
          cleaned++
        }
      }
    } else {
      const uploads = await tusState.getExpiredUploads(now)
      for (const upload of uploads) {
        await this.terminateUpload(upload.uploadId)
        cleaned++
      }
    }

    return cleaned
  }

  async cleanupCompletedUpload(uploadId: string): Promise<boolean> {
    const upload = await this.getUpload(uploadId)
    if (!upload || upload.status !== 'completed') {
      return false
    }

    // Only delete the temp file, keep metadata
    const uploadPath = this.getUploadPath(uploadId)
    const exists = await fileExists(uploadPath)
    if (exists) {
      await rmFile(uploadPath)
    }

    return true
  }

  // ============ File Paths ============

  private getUploadPath(uploadId: string): string {
    return joinPath(this.config.uploadDir, `${uploadId}.data`)
  }

  private getMetadataPath(uploadId: string): string {
    return joinPath(this.config.uploadDir, `${uploadId}.meta.json`)
  }

  async getCompletedFilePath(uploadId: string): Promise<string | undefined> {
    const upload = await this.getUpload(uploadId)
    if (!upload || upload.status !== 'completed') {
      return undefined
    }

    const path = this.getUploadPath(uploadId)
    const exists = await fileExists(path)
    return exists ? path : undefined
  }

  async getCompletedFileBuffer(uploadId: string): Promise<Buffer | undefined> {
    const path = await this.getCompletedFilePath(uploadId)
    if (!path) return undefined
    return readFileAsync(path)
  }

  // ============ Metadata Persistence ============

  private async saveUploadMetadata(upload: TusUpload): Promise<void> {
    const metadataPath = this.getMetadataPath(upload.uploadId)
    const content = Buffer.from(JSON.stringify(upload, null, 2), 'utf-8')
    await writeFileAsync(metadataPath, content)
  }

  // ============ Checksum Utilities ============

  private calculateChecksum(data: Buffer, algorithm: string): string {
    const hash = createHash(algorithm === 'crc32' ? 'sha256' : algorithm)
    hash.update(data)
    return hash.digest('hex')
  }

  async validateChecksum(
    uploadId: string,
    expectedChecksum: string,
    algorithm = 'sha256',
  ): Promise<boolean> {
    const filePath = this.getUploadPath(uploadId)
    const exists = await fileExists(filePath)
    if (!exists) {
      return false
    }

    const data = await readFileAsync(filePath)
    const actualChecksum = this.calculateChecksum(data, algorithm)
    return actualChecksum === expectedChecksum
  }
}

// ============ Singleton Factory ============

let tusManager: TusUploadManager | null = null

export function getTusUploadManager(
  config?: Partial<TusConfig>,
): TusUploadManager {
  if (!tusManager) {
    tusManager = new TusUploadManager(config)
  }
  return tusManager
}

/**
 * Initialize the singleton manager for testing (in-memory mode)
 */
export async function initializeTusManagerForTesting(
  config?: Partial<TusConfig>,
): Promise<TusUploadManager> {
  tusManager = new TusUploadManager(config)
  await tusManager.initializeForTesting()
  return tusManager
}

/**
 * Reset the singleton manager (for testing cleanup)
 */
export function resetTusManager(): void {
  tusManager = null
}

// ============ Express Handler Helpers ============

export function handleTusOptions(): {
  status: number
  headers: Record<string, string>
} {
  const manager = getTusUploadManager()
  return {
    status: 204,
    headers: manager.getTusHeaders(),
  }
}

export async function handleTusPost(
  body: { uploadLength: number; uploadMetadata?: string },
  owner?: Address,
): Promise<{
  status: number
  headers: Record<string, string>
  upload: TusUpload
}> {
  const manager = getTusUploadManager()
  const upload = await manager.createUpload(body, owner)

  return {
    status: 201,
    headers: {
      ...manager.getTusHeaders(),
      Location: upload.uploadUrl,
      'Upload-Offset': '0',
      'Upload-Expires': new Date(upload.expiresAt).toUTCString(),
    },
    upload,
  }
}

export async function handleTusHead(uploadId: string): Promise<{
  status: number
  headers: Record<string, string>
  upload?: TusUpload
}> {
  const manager = getTusUploadManager()
  const upload = await manager.getUpload(uploadId)

  if (!upload) {
    return { status: 404, headers: {} }
  }

  return {
    status: 200,
    headers: {
      ...manager.getTusHeaders(),
      ...manager.getUploadHeaders(upload),
      'Cache-Control': 'no-store',
    },
    upload,
  }
}

export async function handleTusPatch(
  uploadId: string,
  offset: number,
  chunk: Buffer,
  checksum?: string,
): Promise<{
  status: number
  headers: Record<string, string>
  upload?: TusUpload
  error?: string
}> {
  const manager = getTusUploadManager()

  const upload = await manager.patchUpload(uploadId, {
    uploadOffset: offset,
    contentLength: chunk.length,
    contentType: 'application/offset+octet-stream',
    chunk,
    uploadChecksum: checksum,
  })

  return {
    status: 204,
    headers: {
      ...manager.getTusHeaders(),
      'Upload-Offset': String(upload.uploadOffset),
      'Upload-Expires': new Date(upload.expiresAt).toUTCString(),
    },
    upload,
  }
}

export async function handleTusDelete(uploadId: string): Promise<{
  status: number
  headers: Record<string, string>
}> {
  const manager = getTusUploadManager()
  const success = await manager.terminateUpload(uploadId)

  return {
    status: success ? 204 : 404,
    headers: manager.getTusHeaders(),
  }
}
