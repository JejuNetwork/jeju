/**
 * S3-Compatible API Types
 * AWS S3 compatible interface for DWS storage
 */

export interface S3Bucket {
  name: string
  creationDate: Date
  owner: string
  region: string
  versioning: 'Enabled' | 'Suspended' | 'Disabled'
  encryption: 'AES256' | 'aws:kms' | 'none'
}

export interface S3Object {
  key: string
  size: number
  lastModified: Date
  etag: string
  storageClass: 'STANDARD' | 'INFREQUENT_ACCESS' | 'ARCHIVE'
  contentType: string
  metadata: Record<string, string>
  versionId?: string
}

export interface S3ObjectVersion {
  key: string
  versionId: string
  isLatest: boolean
  lastModified: Date
  etag: string
  size: number
  owner: string
}

export interface ListObjectsParams {
  bucket: string
  prefix?: string
  delimiter?: string
  maxKeys?: number
  continuationToken?: string
  startAfter?: string
}

export interface ListObjectsResponse {
  name: string
  prefix: string
  keyCount: number
  maxKeys: number
  isTruncated: boolean
  contents: S3Object[]
  commonPrefixes: string[]
  continuationToken?: string
  nextContinuationToken?: string
}

export interface PutObjectParams {
  bucket: string
  key: string
  body: Buffer | Uint8Array | string
  contentType?: string
  metadata?: Record<string, string>
  cacheControl?: string
  contentDisposition?: string
  contentEncoding?: string
  expires?: Date
  acl?: 'private' | 'public-read' | 'public-read-write'
}

export interface PutObjectResponse {
  etag: string
  versionId?: string
}

export interface GetObjectParams {
  bucket: string
  key: string
  versionId?: string
  range?: string
  ifMatch?: string
  ifNoneMatch?: string
  ifModifiedSince?: Date
  ifUnmodifiedSince?: Date
}

export interface GetObjectResponse {
  body: Buffer
  contentType: string
  contentLength: number
  etag: string
  lastModified: Date
  metadata: Record<string, string>
  versionId?: string
  cacheControl?: string
  contentDisposition?: string
  contentEncoding?: string
  expires?: Date
}

export interface HeadObjectResponse {
  contentType: string
  contentLength: number
  etag: string
  lastModified: Date
  metadata: Record<string, string>
  versionId?: string
  storageClass: string
}

export interface DeleteObjectParams {
  bucket: string
  key: string
  versionId?: string
}

export interface DeleteObjectsParams {
  bucket: string
  objects: Array<{ key: string; versionId?: string }>
}

export interface DeleteObjectsResponse {
  deleted: Array<{ key: string; versionId?: string }>
  errors: Array<{ key: string; code: string; message: string }>
}

export interface CopyObjectParams {
  sourceBucket: string
  sourceKey: string
  destinationBucket: string
  destinationKey: string
  sourceVersionId?: string
  metadata?: Record<string, string>
  metadataDirective?: 'COPY' | 'REPLACE'
}

export interface MultipartUpload {
  uploadId: string
  bucket: string
  key: string
  initiatedAt: Date
  parts: MultipartPart[]
}

export interface MultipartPart {
  partNumber: number
  etag: string
  size: number
  uploadedAt: Date
}

export interface PresignedUrlParams {
  bucket: string
  key: string
  operation: 'getObject' | 'putObject'
  expiresIn: number // seconds
  contentType?: string
  metadata?: Record<string, string>
}

export interface PresignedUrlResponse {
  url: string
  expiresAt: Date
  headers?: Record<string, string>
}

export interface LifecycleRule {
  id: string
  prefix: string
  status: 'Enabled' | 'Disabled'
  transitions?: Array<{
    days: number
    storageClass: string
  }>
  expiration?: {
    days?: number
    date?: Date
  }
  noncurrentVersionExpiration?: {
    noncurrentDays: number
  }
}

export interface S3Error {
  code: string
  message: string
  resource?: string
  requestId: string
}

// Standard S3 error codes
export const S3_ERRORS = {
  NoSuchBucket: 'The specified bucket does not exist',
  NoSuchKey: 'The specified key does not exist',
  BucketAlreadyExists: 'The requested bucket name is not available',
  BucketNotEmpty: 'The bucket you tried to delete is not empty',
  InvalidBucketName: 'The specified bucket is not valid',
  InvalidRequest: 'Invalid request',
  AccessDenied: 'Access Denied',
  EntityTooLarge:
    'Your proposed upload exceeds the maximum allowed object size',
  InvalidPart: 'One or more of the specified parts could not be found',
  InvalidPartOrder: 'The list of parts was not in ascending order',
  NoSuchUpload: 'The specified multipart upload does not exist',
} as const
