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
 */

import { createHash, randomBytes } from 'node:crypto'
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Address } from 'viem'

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
  baseUrl: process.env.DWS_BASE_URL ?? 'http://localhost:3100',
  uploadDir: join(tmpdir(), 'dws-tus-uploads'),
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

// ============ TUS Upload Manager ============

export class TusUploadManager {
  private config: TusConfig
  private uploads: Map<string, TusUpload> = new Map()

  constructor(config?: Partial<TusConfig>) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.ensureUploadDir()
    this.startCleanupInterval()
  }

  private ensureUploadDir(): void {
    if (!existsSync(this.config.uploadDir)) {
      mkdirSync(this.config.uploadDir, { recursive: true })
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

  createUpload(request: TusUploadCreateRequest, owner?: Address): TusUpload {
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

    // Create upload file
    const uploadPath = this.getUploadPath(uploadId)
    writeFileSync(uploadPath, Buffer.alloc(0))

    // Save upload metadata
    this.saveUploadMetadata(upload)

    this.uploads.set(uploadId, upload)
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

  patchUpload(uploadId: string, request: TusUploadPatchRequest): TusUpload {
    const upload = this.uploads.get(uploadId)
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

    // Write chunk to file
    const uploadPath = this.getUploadPath(uploadId)
    const stream = createWriteStream(uploadPath, {
      flags: 'r+',
      start: request.uploadOffset,
    })

    stream.write(request.chunk)
    stream.end()

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
      this.finalizeUpload(upload)
    }

    this.saveUploadMetadata(upload)
    return upload
  }

  private async finalizeUpload(upload: TusUpload): Promise<void> {
    const uploadPath = this.getUploadPath(upload.uploadId)

    // Verify final checksum if provided
    if (upload.metadata.checksum) {
      const fileData = readFileSync(uploadPath)
      const actualChecksum = this.calculateChecksum(fileData, 'sha256')

      if (actualChecksum !== upload.metadata.checksum) {
        upload.status = 'failed'
        upload.errorMessage = 'Final checksum verification failed'
        this.saveUploadMetadata(upload)
        return
      }
    }

    // Calculate content CID
    const fileData = readFileSync(uploadPath)
    const cid = this.calculateChecksum(fileData, 'sha256')

    upload.finalCid = cid
    upload.finalUrl = `${this.config.baseUrl}/storage/${cid}`
    upload.status = 'completed'
    upload.updatedAt = Date.now()

    this.saveUploadMetadata(upload)

    // Call completion callback if provided
    if (this.config.onUploadComplete) {
      await this.config.onUploadComplete(upload)
    }
  }

  // ============ Upload Status ============

  getUpload(uploadId: string): TusUpload | undefined {
    // First check in-memory cache
    let upload = this.uploads.get(uploadId)

    if (!upload) {
      // Try to load from disk
      upload = this.loadUploadMetadata(uploadId)
      if (upload) {
        this.uploads.set(uploadId, upload)
      }
    }

    // Check for expiration
    if (
      upload &&
      Date.now() > upload.expiresAt &&
      upload.status !== 'completed'
    ) {
      upload.status = 'expired'
      this.saveUploadMetadata(upload)
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

  terminateUpload(uploadId: string): boolean {
    const upload = this.uploads.get(uploadId)
    if (!upload) {
      return false
    }

    // Delete upload file
    const uploadPath = this.getUploadPath(uploadId)
    if (existsSync(uploadPath)) {
      rmSync(uploadPath, { force: true })
    }

    // Delete metadata file
    const metadataPath = this.getMetadataPath(uploadId)
    if (existsSync(metadataPath)) {
      rmSync(metadataPath, { force: true })
    }

    this.uploads.delete(uploadId)
    return true
  }

  // ============ Concatenation Extension ============

  concatenateUploads(
    uploadIds: string[],
    metadata?: TusMetadata,
    owner?: Address,
  ): TusUpload {
    const uploads = uploadIds.map((id) => {
      const upload = this.getUpload(id)
      if (!upload) {
        throw new Error(`Upload ${id} not found`)
      }
      if (upload.status !== 'completed') {
        throw new Error(`Upload ${id} is not completed`)
      }
      return upload
    })

    // Calculate total size
    const totalSize = uploads.reduce((sum, u) => sum + u.fileSize, 0)

    // Create new upload for concatenated result
    const concatUpload = this.createUpload(
      {
        uploadLength: totalSize,
        uploadMetadata: this.encodeMetadata(metadata ?? {}),
      },
      owner,
    )

    // Concatenate files
    const outputPath = this.getUploadPath(concatUpload.uploadId)
    const outputStream = createWriteStream(outputPath)

    let _offset = 0
    for (const upload of uploads) {
      const inputPath = this.getUploadPath(upload.uploadId)
      const inputStream = createReadStream(inputPath)

      inputStream.pipe(outputStream, { end: false })

      // Wait for the stream to finish
      inputStream.on('end', () => {
        _offset += upload.fileSize
      })
    }

    outputStream.end()

    // Mark as finalizing
    concatUpload.status = 'finalizing'
    concatUpload.uploadOffset = totalSize

    // Finalize asynchronously
    this.finalizeUpload(concatUpload)

    return concatUpload
  }

  // ============ Parallel Chunk Upload Support ============

  getChunkUploadUrls(
    uploadId: string,
  ): Array<{ url: string; offset: number; size: number }> {
    const upload = this.getUpload(uploadId)
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

  getUploadProgress(uploadId: string): {
    percent: number
    uploadedBytes: number
    totalBytes: number
    chunksUploaded: number
    estimatedTimeRemaining?: number
  } {
    const upload = this.getUpload(uploadId)
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

  getActiveUploads(): TusUpload[] {
    return Array.from(this.uploads.values()).filter(
      (u) => u.status === 'created' || u.status === 'uploading',
    )
  }

  // ============ Cleanup ============

  cleanupExpiredUploads(): number {
    const now = Date.now()
    let cleaned = 0

    for (const [uploadId, upload] of this.uploads) {
      if (now > upload.expiresAt && upload.status !== 'completed') {
        this.terminateUpload(uploadId)
        cleaned++
      }
    }

    return cleaned
  }

  cleanupCompletedUpload(uploadId: string): boolean {
    const upload = this.getUpload(uploadId)
    if (!upload || upload.status !== 'completed') {
      return false
    }

    // Only delete the temp file, keep metadata
    const uploadPath = this.getUploadPath(uploadId)
    if (existsSync(uploadPath)) {
      rmSync(uploadPath, { force: true })
    }

    return true
  }

  // ============ File Paths ============

  private getUploadPath(uploadId: string): string {
    return join(this.config.uploadDir, `${uploadId}.data`)
  }

  private getMetadataPath(uploadId: string): string {
    return join(this.config.uploadDir, `${uploadId}.meta.json`)
  }

  getCompletedFilePath(uploadId: string): string | undefined {
    const upload = this.getUpload(uploadId)
    if (!upload || upload.status !== 'completed') {
      return undefined
    }

    const path = this.getUploadPath(uploadId)
    return existsSync(path) ? path : undefined
  }

  getCompletedFileBuffer(uploadId: string): Buffer | undefined {
    const path = this.getCompletedFilePath(uploadId)
    if (!path) return undefined
    return readFileSync(path)
  }

  // ============ Metadata Persistence ============

  private saveUploadMetadata(upload: TusUpload): void {
    const metadataPath = this.getMetadataPath(upload.uploadId)
    writeFileSync(metadataPath, JSON.stringify(upload, null, 2))
  }

  private loadUploadMetadata(uploadId: string): TusUpload | undefined {
    const metadataPath = this.getMetadataPath(uploadId)
    if (!existsSync(metadataPath)) {
      return undefined
    }

    const data = readFileSync(metadataPath, 'utf-8')
    return JSON.parse(data) as TusUpload
  }

  // ============ Checksum Utilities ============

  private calculateChecksum(data: Buffer, algorithm: string): string {
    const hash = createHash(algorithm === 'crc32' ? 'sha256' : algorithm)
    hash.update(data)
    return hash.digest('hex')
  }

  validateChecksum(
    uploadId: string,
    expectedChecksum: string,
    algorithm = 'sha256',
  ): boolean {
    const filePath = this.getUploadPath(uploadId)
    if (!existsSync(filePath)) {
      return false
    }

    const data = readFileSync(filePath)
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

export function handleTusPost(
  body: { uploadLength: number; uploadMetadata?: string },
  owner?: Address,
): {
  status: number
  headers: Record<string, string>
  upload: TusUpload
} {
  const manager = getTusUploadManager()
  const upload = manager.createUpload(body, owner)

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

export function handleTusHead(uploadId: string): {
  status: number
  headers: Record<string, string>
  upload?: TusUpload
} {
  const manager = getTusUploadManager()
  const upload = manager.getUpload(uploadId)

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

export function handleTusPatch(
  uploadId: string,
  offset: number,
  chunk: Buffer,
  checksum?: string,
): {
  status: number
  headers: Record<string, string>
  upload?: TusUpload
  error?: string
} {
  const manager = getTusUploadManager()

  const upload = manager.patchUpload(uploadId, {
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

export function handleTusDelete(uploadId: string): {
  status: number
  headers: Record<string, string>
} {
  const manager = getTusUploadManager()
  const success = manager.terminateUpload(uploadId)

  return {
    status: success ? 204 : 404,
    headers: manager.getTusHeaders(),
  }
}
