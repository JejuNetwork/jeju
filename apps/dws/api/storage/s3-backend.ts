/**
 * S3-Compatible Storage Backend
 * Wraps DWS storage with AWS S3-compatible API
 */

import { keccak256, toBytes } from 'viem'
import { constantTimeHexEquals } from '../shared/utils/crypto'
import type { BackendManager } from './backends'
import type {
  CopyObjectParams,
  DeleteObjectParams,
  DeleteObjectsParams,
  DeleteObjectsResponse,
  GetObjectParams,
  GetObjectResponse,
  HeadObjectResponse,
  LifecycleRule,
  ListObjectsParams,
  ListObjectsResponse,
  MultipartPart,
  MultipartUpload,
  PresignedUrlParams,
  PresignedUrlResponse,
  PutObjectParams,
  PutObjectResponse,
  S3Bucket,
  S3Object,
} from './s3-types'

interface StoredObject {
  key: string
  cid: string
  size: number
  contentType: string
  etag: string
  lastModified: Date
  metadata: Record<string, string>
  versionId?: string
  storageClass: 'STANDARD' | 'INFREQUENT_ACCESS' | 'ARCHIVE'
}

export class S3Backend {
  private backend: BackendManager
  private buckets = new Map<string, S3Bucket>()
  private objects = new Map<string, Map<string, StoredObject>>() // bucket -> key -> object
  private multipartUploads = new Map<string, MultipartUpload>()
  private lifecycleRules = new Map<string, LifecycleRule[]>()
  private signingKey: string

  constructor(backend: BackendManager, signingKey?: string) {
    this.backend = backend
    this.signingKey = signingKey ?? crypto.randomUUID()
  }

  // Bucket Operations

  async createBucket(
    name: string,
    owner: string,
    region = 'us-east-1',
  ): Promise<S3Bucket> {
    if (this.buckets.has(name)) {
      throw new S3Error('BucketAlreadyExists', `Bucket ${name} already exists`)
    }

    if (!this.isValidBucketName(name)) {
      throw new S3Error('InvalidBucketName', `Invalid bucket name: ${name}`)
    }

    const bucket: S3Bucket = {
      name,
      creationDate: new Date(),
      owner,
      region,
      versioning: 'Disabled',
      encryption: 'AES256',
    }

    this.buckets.set(name, bucket)
    this.objects.set(name, new Map())
    return bucket
  }

  async deleteBucket(name: string): Promise<void> {
    if (!this.buckets.has(name)) {
      throw new S3Error('NoSuchBucket', `Bucket ${name} does not exist`)
    }

    const bucketObjects = this.objects.get(name)
    if (bucketObjects && bucketObjects.size > 0) {
      throw new S3Error('BucketNotEmpty', `Bucket ${name} is not empty`)
    }

    this.buckets.delete(name)
    this.objects.delete(name)
    this.lifecycleRules.delete(name)
  }

  async listBuckets(owner?: string): Promise<S3Bucket[]> {
    const buckets = Array.from(this.buckets.values())
    if (owner) {
      return buckets.filter((b) => b.owner === owner)
    }
    return buckets
  }

  async getBucket(name: string): Promise<S3Bucket | null> {
    return this.buckets.get(name) ?? null
  }

  async setBucketVersioning(name: string, enabled: boolean): Promise<void> {
    const bucket = this.buckets.get(name)
    if (!bucket) {
      throw new S3Error('NoSuchBucket', `Bucket ${name} does not exist`)
    }
    bucket.versioning = enabled ? 'Enabled' : 'Suspended'
  }

  // Object Operations

  async putObject(params: PutObjectParams): Promise<PutObjectResponse> {
    const bucketObjects = this.objects.get(params.bucket)
    if (!bucketObjects) {
      throw new S3Error(
        'NoSuchBucket',
        `Bucket ${params.bucket} does not exist`,
      )
    }

    const content =
      typeof params.body === 'string'
        ? Buffer.from(params.body)
        : Buffer.from(params.body)

    // Upload to DWS storage
    const result = await this.backend.upload(content, {
      filename: params.key.split('/').pop(),
    })

    const etag = `"${keccak256(new Uint8Array(content)).slice(2, 34)}"`
    const versionId =
      this.buckets.get(params.bucket)?.versioning === 'Enabled'
        ? crypto.randomUUID()
        : undefined

    const obj: StoredObject = {
      key: params.key,
      cid: result.cid,
      size: content.length,
      contentType: params.contentType ?? 'application/octet-stream',
      etag,
      lastModified: new Date(),
      metadata: params.metadata ?? {},
      versionId,
      storageClass: 'STANDARD',
    }

    bucketObjects.set(params.key, obj)

    return { etag, versionId }
  }

  async getObject(params: GetObjectParams): Promise<GetObjectResponse> {
    const bucketObjects = this.objects.get(params.bucket)
    if (!bucketObjects) {
      throw new S3Error(
        'NoSuchBucket',
        `Bucket ${params.bucket} does not exist`,
      )
    }

    const obj = bucketObjects.get(params.key)
    if (!obj) {
      throw new S3Error('NoSuchKey', `Key ${params.key} does not exist`)
    }

    // Conditional requests
    if (params.ifNoneMatch && obj.etag === params.ifNoneMatch) {
      throw new NotModifiedError()
    }

    if (params.ifModifiedSince && obj.lastModified <= params.ifModifiedSince) {
      throw new NotModifiedError()
    }

    // Download from DWS storage
    const result = await this.backend.download(obj.cid)
    let body = result.content

    // Handle range requests
    if (params.range) {
      const [start, end] = this.parseRange(params.range, body.length)
      body = body.subarray(start, end + 1)
    }

    return {
      body,
      contentType: obj.contentType,
      contentLength: body.length,
      etag: obj.etag,
      lastModified: obj.lastModified,
      metadata: obj.metadata,
      versionId: obj.versionId,
    }
  }

  async headObject(bucket: string, key: string): Promise<HeadObjectResponse> {
    const bucketObjects = this.objects.get(bucket)
    if (!bucketObjects) {
      throw new S3Error('NoSuchBucket', `Bucket ${bucket} does not exist`)
    }

    const obj = bucketObjects.get(key)
    if (!obj) {
      throw new S3Error('NoSuchKey', `Key ${key} does not exist`)
    }

    return {
      contentType: obj.contentType,
      contentLength: obj.size,
      etag: obj.etag,
      lastModified: obj.lastModified,
      metadata: obj.metadata,
      versionId: obj.versionId,
      storageClass: obj.storageClass,
    }
  }

  async deleteObject(params: DeleteObjectParams): Promise<void> {
    const bucketObjects = this.objects.get(params.bucket)
    if (!bucketObjects) {
      throw new S3Error(
        'NoSuchBucket',
        `Bucket ${params.bucket} does not exist`,
      )
    }

    bucketObjects.delete(params.key)
  }

  async deleteObjects(
    params: DeleteObjectsParams,
  ): Promise<DeleteObjectsResponse> {
    const bucketObjects = this.objects.get(params.bucket)
    if (!bucketObjects) {
      throw new S3Error(
        'NoSuchBucket',
        `Bucket ${params.bucket} does not exist`,
      )
    }

    const deleted: Array<{ key: string; versionId?: string }> = []
    const errors: Array<{ key: string; code: string; message: string }> = []

    for (const obj of params.objects) {
      if (bucketObjects.has(obj.key)) {
        bucketObjects.delete(obj.key)
        deleted.push({ key: obj.key, versionId: obj.versionId })
      } else {
        errors.push({
          key: obj.key,
          code: 'NoSuchKey',
          message: `Key ${obj.key} does not exist`,
        })
      }
    }

    return { deleted, errors }
  }

  async listObjects(params: ListObjectsParams): Promise<ListObjectsResponse> {
    const bucketObjects = this.objects.get(params.bucket)
    if (!bucketObjects) {
      throw new S3Error(
        'NoSuchBucket',
        `Bucket ${params.bucket} does not exist`,
      )
    }

    const prefix = params.prefix ?? ''
    const delimiter = params.delimiter
    const maxKeys = params.maxKeys ?? 1000
    const startAfter = params.startAfter ?? params.continuationToken ?? ''

    let allKeys = Array.from(bucketObjects.keys())
      .filter((key) => key.startsWith(prefix))
      .sort()

    if (startAfter) {
      allKeys = allKeys.filter((key) => key > startAfter)
    }

    const contents: S3Object[] = []
    const commonPrefixes = new Set<string>()

    for (const key of allKeys) {
      if (contents.length >= maxKeys) break

      if (delimiter) {
        const relativePath = key.slice(prefix.length)
        const delimiterIndex = relativePath.indexOf(delimiter)

        if (delimiterIndex >= 0) {
          commonPrefixes.add(prefix + relativePath.slice(0, delimiterIndex + 1))
          continue
        }
      }

      const obj = bucketObjects.get(key)
      if (!obj) continue
      contents.push({
        key: obj.key,
        size: obj.size,
        lastModified: obj.lastModified,
        etag: obj.etag,
        storageClass: obj.storageClass,
        contentType: obj.contentType,
        metadata: obj.metadata,
        versionId: obj.versionId,
      })
    }

    const isTruncated = allKeys.length > maxKeys + commonPrefixes.size
    const nextToken = isTruncated
      ? contents[contents.length - 1].key
      : undefined

    return {
      name: params.bucket,
      prefix,
      keyCount: contents.length,
      maxKeys,
      isTruncated,
      contents,
      commonPrefixes: Array.from(commonPrefixes),
      nextContinuationToken: nextToken,
    }
  }

  async copyObject(params: CopyObjectParams): Promise<PutObjectResponse> {
    const sourceObj = await this.getObject({
      bucket: params.sourceBucket,
      key: params.sourceKey,
      versionId: params.sourceVersionId,
    })

    const metadata =
      params.metadataDirective === 'REPLACE'
        ? (params.metadata ?? {})
        : sourceObj.metadata

    return this.putObject({
      bucket: params.destinationBucket,
      key: params.destinationKey,
      body: sourceObj.body,
      contentType: sourceObj.contentType,
      metadata,
    })
  }

  // Multipart Upload

  async createMultipartUpload(bucket: string, key: string): Promise<string> {
    if (!this.buckets.has(bucket)) {
      throw new S3Error('NoSuchBucket', `Bucket ${bucket} does not exist`)
    }

    const uploadId = crypto.randomUUID()
    this.multipartUploads.set(uploadId, {
      uploadId,
      bucket,
      key,
      initiatedAt: new Date(),
      parts: [],
    })

    return uploadId
  }

  async uploadPart(
    uploadId: string,
    partNumber: number,
    body: Buffer,
  ): Promise<MultipartPart> {
    const upload = this.multipartUploads.get(uploadId)
    if (!upload) {
      throw new S3Error('NoSuchUpload', `Upload ${uploadId} does not exist`)
    }

    const etag = `"${keccak256(new Uint8Array(body)).slice(2, 34)}"`
    const part: MultipartPart = {
      partNumber,
      etag,
      size: body.length,
      uploadedAt: new Date(),
    }

    // Store part data temporarily
    const partKey = `${uploadId}-${partNumber}`
    await this.backend.upload(body, { filename: partKey })

    upload.parts.push(part)
    return part
  }

  async completeMultipartUpload(
    uploadId: string,
    parts: Array<{ partNumber: number; etag: string }>,
  ): Promise<PutObjectResponse> {
    const upload = this.multipartUploads.get(uploadId)
    if (!upload) {
      throw new S3Error('NoSuchUpload', `Upload ${uploadId} does not exist`)
    }

    // Verify parts
    const sortedParts = parts.sort((a, b) => a.partNumber - b.partNumber)
    for (let i = 0; i < sortedParts.length; i++) {
      if (sortedParts[i].partNumber !== i + 1) {
        throw new S3Error(
          'InvalidPartOrder',
          'Parts are not in ascending order',
        )
      }
    }

    // Concatenate all parts
    const buffers: Buffer[] = []
    for (const part of sortedParts) {
      const partKey = `${uploadId}-${part.partNumber}`
      const result = await this.backend.download(partKey)
      if (!result) {
        throw new S3Error('InvalidPart', `Part ${part.partNumber} not found`)
      }
      buffers.push(result.content)
    }

    const combined = Buffer.concat(buffers)
    const response = await this.putObject({
      bucket: upload.bucket,
      key: upload.key,
      body: combined,
    })

    this.multipartUploads.delete(uploadId)
    return response
  }

  async abortMultipartUpload(uploadId: string): Promise<void> {
    this.multipartUploads.delete(uploadId)
  }

  // Presigned URLs

  generatePresignedUrl(params: PresignedUrlParams): PresignedUrlResponse {
    const expiresAt = new Date(Date.now() + params.expiresIn * 1000)
    const payload = {
      bucket: params.bucket,
      key: params.key,
      operation: params.operation,
      expiresAt: expiresAt.getTime(),
    }

    const signature = keccak256(
      toBytes(JSON.stringify(payload) + this.signingKey),
    ).slice(0, 18)

    const queryParams = new URLSearchParams({
      'X-DWS-Signature': signature,
      'X-DWS-Expires': expiresAt.toISOString(),
      'X-DWS-Operation': params.operation,
    })

    if (params.contentType) {
      queryParams.set('X-DWS-ContentType', params.contentType)
    }

    const url = `/s3/${params.bucket}/${params.key}?${queryParams.toString()}`

    return {
      url,
      expiresAt,
      headers:
        params.operation === 'putObject' && params.contentType
          ? { 'Content-Type': params.contentType }
          : undefined,
    }
  }

  verifyPresignedUrl(
    bucket: string,
    key: string,
    signature: string,
    expires: string,
    operation: string,
  ): boolean {
    const expiresAt = new Date(expires)
    if (expiresAt < new Date()) return false

    const payload = {
      bucket,
      key,
      operation,
      expiresAt: expiresAt.getTime(),
    }

    const expectedSig = keccak256(
      toBytes(JSON.stringify(payload) + this.signingKey),
    ).slice(0, 18)

    // Use constant-time comparison to prevent timing attacks
    return constantTimeHexEquals(signature, expectedSig)
  }

  // Lifecycle Rules

  async setLifecycleRules(
    bucket: string,
    rules: LifecycleRule[],
  ): Promise<void> {
    if (!this.buckets.has(bucket)) {
      throw new S3Error('NoSuchBucket', `Bucket ${bucket} does not exist`)
    }
    this.lifecycleRules.set(bucket, rules)
  }

  async getLifecycleRules(bucket: string): Promise<LifecycleRule[]> {
    return this.lifecycleRules.get(bucket) ?? []
  }

  // Utilities

  private isValidBucketName(name: string): boolean {
    if (name.length < 3 || name.length > 63) return false
    if (!/^[a-z0-9]/.test(name)) return false
    if (!/[a-z0-9]$/.test(name)) return false
    if (/[^a-z0-9.-]/.test(name)) return false
    if (/\.\./.test(name)) return false
    if (/^\d+\.\d+\.\d+\.\d+$/.test(name)) return false
    return true
  }

  private parseRange(range: string, totalSize: number): [number, number] {
    const match = range.match(/bytes=(\d+)-(\d*)/)
    if (!match) throw new S3Error('InvalidRequest', 'Invalid range header')

    const start = parseInt(match[1], 10)
    const end = match[2] ? parseInt(match[2], 10) : totalSize - 1

    if (start >= totalSize || end >= totalSize || start > end) {
      throw new S3Error('InvalidRequest', 'Invalid range')
    }

    return [start, end]
  }

  getStats(): { buckets: number; objects: number; totalSize: number } {
    let totalObjects = 0
    let totalSize = 0

    for (const bucketObjects of this.objects.values()) {
      for (const obj of bucketObjects.values()) {
        totalObjects++
        totalSize += obj.size
      }
    }

    return {
      buckets: this.buckets.size,
      objects: totalObjects,
      totalSize,
    }
  }
}

export class S3Error extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message)
    this.name = 'S3Error'
  }
}

export class NotModifiedError extends Error {
  constructor() {
    super('Not Modified')
    this.name = 'NotModifiedError'
  }
}
