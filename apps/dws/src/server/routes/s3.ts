/**
 * S3-Compatible API Routes
 * AWS S3 API compatibility layer for DWS storage
 */

import { Hono } from 'hono'
import {
  bucketParamsSchema,
  completeMultipartXmlSchema,
  objectListQuerySchema,
  objectParamsSchema,
  presignRequestSchema,
  validateBody,
  validateHeaders,
  validateParams,
  validateQuery,
  z,
} from '../../shared'
import type { BackendManager } from '../../storage/backends'
import { NotModifiedError, S3Backend, S3Error } from '../../storage/s3-backend'

export function createS3Router(backend: BackendManager): Hono {
  const router = new Hono()
  const s3 = new S3Backend(backend)

  // Error handler
  const handleError = (
    error: unknown,
  ): {
    status: 200 | 400 | 403 | 404 | 409 | 410 | 413 | 500 | 304
    body: { Error: { Code: string; Message: string; RequestId: string } } | null
  } => {
    if (error instanceof S3Error) {
      return {
        status: getStatusForError(error.code),
        body: {
          Error: {
            Code: error.code,
            Message: error.message,
            RequestId: crypto.randomUUID(),
          },
        },
      }
    }
    if (error instanceof NotModifiedError) {
      return { status: 304, body: null }
    }
    return {
      status: 500,
      body: {
        Error: {
          Code: 'InternalError',
          Message: error instanceof Error ? error.message : 'Unknown error',
          RequestId: crypto.randomUUID(),
        },
      },
    }
  }

  // ============================================================================
  // Service Operations
  // ============================================================================

  // Health check (must come before wildcard routes)
  router.get('/health', (c) => {
    const stats = s3.getStats()
    return c.json({
      status: 'healthy',
      service: 'dws-s3',
      ...stats,
    })
  })

  // List buckets
  router.get('/', async (c) => {
    const headers = validateHeaders(
      z.object({ 'x-jeju-address': z.string().optional() }),
      c,
    )
    const owner = headers['x-jeju-address']
    const buckets = await s3.listBuckets(owner)

    return c.json({
      Buckets: buckets.map((b) => ({
        Name: b.name,
        CreationDate: b.creationDate.toISOString(),
      })),
      Owner: { ID: owner || 'anonymous' },
    })
  })

  // ============================================================================
  // Bucket Operations
  // ============================================================================

  // Create bucket
  router.put('/:bucket', async (c) => {
    const { bucket } = validateParams(bucketParamsSchema, c)
    const owner = c.req.header('x-jeju-address') || 'anonymous'
    const region = c.req.header('x-amz-bucket-region') || 'us-east-1'

    await s3.createBucket(bucket, owner, region)
    return c.body(null, 200)
  })

  // Delete bucket
  router.delete('/:bucket', async (c) => {
    const { bucket } = validateParams(bucketParamsSchema, c)
    await s3.deleteBucket(bucket)
    return c.body(null, 204)
  })

  // Get bucket location
  router.get('/:bucket', async (c) => {
    const { bucket } = validateParams(bucketParamsSchema, c)
    const listType = c.req.query('list-type')

    // List objects if list-type is specified
    if (listType === '2') {
      const {
        prefix,
        delimiter,
        'max-keys': maxKeys,
        'continuation-token': continuationToken,
        'start-after': startAfter,
      } = validateQuery(
        objectListQuerySchema.extend({
          'list-type': z.literal('2'),
          'max-keys': z.coerce.number().int().positive().max(1000).optional(),
          'continuation-token': z.string().optional(),
          'start-after': z.string().optional(),
        }),
        c,
      )
      const result = await s3.listObjects({
        bucket,
        prefix,
        delimiter,
        maxKeys: maxKeys ?? 1000,
        continuationToken,
        startAfter,
      })

      return c.json({
        Name: result.name,
        Prefix: result.prefix,
        KeyCount: result.keyCount,
        MaxKeys: result.maxKeys,
        IsTruncated: result.isTruncated,
        Contents: result.contents.map((obj) => ({
          Key: obj.key,
          LastModified: obj.lastModified.toISOString(),
          ETag: obj.etag,
          Size: obj.size,
          StorageClass: obj.storageClass,
        })),
        CommonPrefixes: result.commonPrefixes.map((p) => ({ Prefix: p })),
        ContinuationToken: result.continuationToken,
        NextContinuationToken: result.nextContinuationToken,
      })
    }

    // Get bucket info
    const bucketInfo = await s3.getBucket(bucket)
    if (!bucketInfo) {
      throw new Error('Bucket does not exist')
    }

    return c.json({
      LocationConstraint: bucketInfo.region,
    })
  })

  // ============================================================================
  // Object Operations
  // ============================================================================

  // Put object
  router.put('/:bucket/:key{.+}', async (c) => {
    const { bucket, key } = validateParams(
      objectParamsSchema.extend({
        bucket: z.string().min(1),
        key: z.string().min(1),
      }),
      c,
    )

    // Check for presigned URL
    const signature = c.req.query('X-DWS-Signature')
    const expires = c.req.query('X-DWS-Expires')
    const operation = c.req.query('X-DWS-Operation')

    if (signature && expires && operation) {
      if (!s3.verifyPresignedUrl(bucket, key, signature, expires, operation)) {
        throw new Error('Invalid signature')
      }
    }

    const body = await c.req.arrayBuffer()
    const contentType = c.req.header('content-type')

    // Parse metadata headers
    const metadata: Record<string, string> = {}
    for (const [headerKey, value] of Object.entries(c.req.header())) {
      if (headerKey.toLowerCase().startsWith('x-amz-meta-')) {
        metadata[headerKey.slice(11)] = value as string
      }
    }

    const result = await s3.putObject({
      bucket,
      key,
      body: Buffer.from(body),
      contentType,
      metadata,
      cacheControl: c.req.header('cache-control'),
      contentDisposition: c.req.header('content-disposition'),
      contentEncoding: c.req.header('content-encoding'),
    })

    c.header('ETag', result.etag)
    if (result.versionId) {
      c.header('x-amz-version-id', result.versionId)
    }

    return c.body(null, 200)
  })

  // Get object (also handles HEAD via Hono routing)
  router.get('/:bucket/:key{.+}', async (c) => {
    const { bucket, key } = validateParams(
      objectParamsSchema.extend({
        bucket: z.string().min(1),
        key: z.string().min(1),
      }),
      c,
    )
    const isHead = c.req.method === 'HEAD'

    // Check for presigned URL
    const signature = c.req.query('X-DWS-Signature')
    const expires = c.req.query('X-DWS-Expires')
    const operation = c.req.query('X-DWS-Operation')

    if (signature && expires && operation) {
      if (!s3.verifyPresignedUrl(bucket, key, signature, expires, operation)) {
        throw new Error('Invalid signature')
      }
    }

    // For HEAD requests, use headObject to avoid fetching the body
    if (isHead) {
      const result = await s3.headObject(bucket, key)

      const headers = new Headers()
      headers.set('Content-Type', result.contentType)
      headers.set('Content-Length', String(result.contentLength))
      headers.set('ETag', result.etag)
      headers.set('Last-Modified', result.lastModified.toUTCString())
      headers.set('x-amz-storage-class', result.storageClass)

      if (result.versionId) {
        headers.set('x-amz-version-id', result.versionId)
      }

      for (const [metaKey, value] of Object.entries(result.metadata)) {
        headers.set(`x-amz-meta-${metaKey}`, value)
      }

      return new Response(null, { status: 200, headers })
    }

    const ifNoneMatch = c.req.header('if-none-match')
    const ifModifiedSince = c.req.header('if-modified-since')
    const range = c.req.header('range')

    try {
      const result = await s3.getObject({
        bucket,
        key,
        versionId: c.req.query('versionId'),
        range,
        ifNoneMatch,
        ifModifiedSince: ifModifiedSince
          ? new Date(ifModifiedSince)
          : undefined,
      })

      c.header('Content-Type', result.contentType)
      c.header('Content-Length', String(result.contentLength))
      c.header('ETag', result.etag)
      c.header('Last-Modified', result.lastModified.toUTCString())

      if (result.versionId) {
        c.header('x-amz-version-id', result.versionId)
      }
      if (result.cacheControl) {
        c.header('Cache-Control', result.cacheControl)
      }

      // Add metadata headers
      for (const [metaKey, value] of Object.entries(result.metadata)) {
        c.header(`x-amz-meta-${metaKey}`, value)
      }

      return new Response(new Uint8Array(result.body), {
        status: range ? 206 : 200,
        headers: c.res.headers,
      })
    } catch (error) {
      if (error instanceof NotModifiedError) {
        return c.body(null, 304)
      }
      throw error
    }
  })

  // Delete object
  router.delete('/:bucket/:key{.+}', async (c) => {
    const { bucket, key } = validateParams(
      objectParamsSchema.extend({
        bucket: z.string().min(1),
        key: z.string().min(1),
      }),
      c,
    )
    await s3.deleteObject({ bucket, key })
    return c.body(null, 204)
  })

  // ============================================================================
  // Multipart Upload
  // ============================================================================

  // Initiate multipart upload
  router.post('/:bucket/:key{.+}', async (c) => {
    const bucket = c.req.param('bucket')
    const key = c.req.param('key')
    const uploads = c.req.query('uploads')

    if (uploads !== undefined) {
      try {
        const uploadId = await s3.createMultipartUpload(bucket, key)
        return c.json({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
        })
      } catch (error) {
        const { status, body } = handleError(error)
        if (status === 304) {
          return new Response(null, { status: 304 })
        }
        return c.json(
          body,
          status as 200 | 400 | 403 | 404 | 409 | 410 | 413 | 500,
        )
      }
    }

    // Complete multipart upload
    const uploadId = c.req.query('uploadId')
    if (uploadId) {
      const body = await validateBody(completeMultipartXmlSchema, c)

      const parts = body.CompleteMultipartUpload.Part.map((p) => ({
        partNumber: p.PartNumber,
        etag: p.ETag,
      }))

      const result = await s3.completeMultipartUpload(uploadId, parts)

      return c.json({
        Location: `/${bucket}/${key}`,
        Bucket: bucket,
        Key: key,
        ETag: result.etag,
      })
    }

    return c.json(
      { Error: { Code: 'InvalidRequest', Message: 'Invalid request' } },
      400,
    )
  })

  // ============================================================================
  // Presigned URLs
  // ============================================================================

  router.post('/presign', async (c) => {
    const body = await validateBody(presignRequestSchema, c)

    const result = s3.generatePresignedUrl({
      bucket: body.bucket,
      key: body.key,
      operation: body.operation,
      expiresIn: body.expiresIn,
      contentType: body.contentType,
    })

    return c.json(result)
  })

  return router
}

function getStatusForError(
  code: string,
): 200 | 400 | 403 | 404 | 409 | 410 | 413 | 500 {
  switch (code) {
    case 'NoSuchBucket':
    case 'NoSuchKey':
    case 'NoSuchUpload':
      return 404
    case 'BucketAlreadyExists':
    case 'BucketNotEmpty':
      return 409
    case 'AccessDenied':
      return 403
    case 'InvalidBucketName':
    case 'InvalidRequest':
    case 'InvalidPart':
    case 'InvalidPartOrder':
      return 400
    case 'EntityTooLarge':
      return 413
    default:
      return 500
  }
}
