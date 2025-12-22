/**
 * S3-Compatible API Routes
 * AWS S3 API compatibility layer for DWS storage
 */

import { Elysia, t } from 'elysia'
import type { BackendManager } from '../../storage/backends'
import { NotModifiedError, S3Backend, S3Error } from '../../storage/s3-backend'

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

export function createS3Router(backend: BackendManager): Elysia {
  const s3 = new S3Backend(backend)

  const router = new Elysia({ name: 's3', prefix: '/s3' })

    // Error handler
    .onError(({ error, set }) => {
      if (error instanceof S3Error) {
        set.status = getStatusForError(error.code)
        return {
          Error: {
            Code: error.code,
            Message: error.message,
            RequestId: crypto.randomUUID(),
          },
        }
      }
      if (error instanceof NotModifiedError) {
        set.status = 304
        return null
      }
      set.status = 500
      return {
        Error: {
          Code: 'InternalError',
          Message: error instanceof Error ? error.message : 'Unknown error',
          RequestId: crypto.randomUUID(),
        },
      }
    })

    // ============================================================================
    // Service Operations
    // ============================================================================

    // Health check (must come before wildcard routes)
    .get('/health', () => {
      const stats = s3.getStats()
      return {
        status: 'healthy',
        service: 'dws-s3',
        ...stats,
      }
    })

    // List buckets
    .get(
      '/',
      async ({ headers }) => {
        const owner = headers['x-jeju-address']
        const buckets = await s3.listBuckets(owner)

        return {
          Buckets: buckets.map((b) => ({
            Name: b.name,
            CreationDate: b.creationDate.toISOString(),
          })),
          Owner: { ID: owner || 'anonymous' },
        }
      },
      {
        headers: t.Object({
          'x-jeju-address': t.Optional(t.String()),
        }),
      },
    )

    // ============================================================================
    // Bucket Operations
    // ============================================================================

    // Create bucket
    .put(
      '/:bucket',
      async ({ params, headers }) => {
        const owner = headers['x-jeju-address'] || 'anonymous'
        const region = headers['x-amz-bucket-region'] || 'us-east-1'

        await s3.createBucket(params.bucket, owner, region)
        return null
      },
      {
        params: t.Object({
          bucket: t.String(),
        }),
        headers: t.Object({
          'x-jeju-address': t.Optional(t.String()),
          'x-amz-bucket-region': t.Optional(t.String()),
        }),
      },
    )

    // Delete bucket
    .delete(
      '/:bucket',
      async ({ params, set }) => {
        await s3.deleteBucket(params.bucket)
        set.status = 204
        return null
      },
      {
        params: t.Object({
          bucket: t.String(),
        }),
      },
    )

    // Get bucket location or list objects
    .get(
      '/:bucket',
      async ({ params, query, set }) => {
        const listType = query['list-type']

        // List objects if list-type is specified
        if (listType === '2') {
          const maxKeys = query['max-keys']
            ? parseInt(query['max-keys'], 10)
            : 1000

          const result = await s3.listObjects({
            bucket: params.bucket,
            prefix: query.prefix,
            delimiter: query.delimiter,
            maxKeys,
            continuationToken: query['continuation-token'],
            startAfter: query['start-after'],
          })

          return {
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
          }
        }

        // Get bucket info
        const bucketInfo = await s3.getBucket(params.bucket)
        if (!bucketInfo) {
          set.status = 404
          return { error: 'Bucket does not exist' }
        }

        return {
          LocationConstraint: bucketInfo.region,
        }
      },
      {
        params: t.Object({
          bucket: t.String(),
        }),
        query: t.Object({
          'list-type': t.Optional(t.String()),
          prefix: t.Optional(t.String()),
          delimiter: t.Optional(t.String()),
          'max-keys': t.Optional(t.String()),
          'continuation-token': t.Optional(t.String()),
          'start-after': t.Optional(t.String()),
        }),
      },
    )

    // ============================================================================
    // Object Operations
    // ============================================================================

    // Put object
    .put(
      '/:bucket/:key',
      async ({ params, query, headers, body, set }) => {
        // Check for presigned URL
        const signature = query['X-DWS-Signature']
        const expires = query['X-DWS-Expires']
        const operation = query['X-DWS-Operation']

        if (signature && expires && operation) {
          if (
            !s3.verifyPresignedUrl(
              params.bucket,
              params.key,
              signature,
              expires,
              operation,
            )
          ) {
            set.status = 403
            return { error: 'Invalid signature' }
          }
        }

        // Parse metadata headers
        const metadata: Record<string, string> = {}
        for (const [headerKey, value] of Object.entries(headers)) {
          if (headerKey.toLowerCase().startsWith('x-amz-meta-')) {
            metadata[headerKey.slice(11)] = value as string
          }
        }

        const bodyBuffer =
          body instanceof ArrayBuffer
            ? Buffer.from(body)
            : typeof body === 'string'
              ? Buffer.from(body)
              : Buffer.from(body as Uint8Array)

        const result = await s3.putObject({
          bucket: params.bucket,
          key: params.key,
          body: bodyBuffer,
          contentType: headers['content-type'],
          metadata,
          cacheControl: headers['cache-control'],
          contentDisposition: headers['content-disposition'],
          contentEncoding: headers['content-encoding'],
        })

        set.headers.ETag = result.etag
        if (result.versionId) {
          set.headers['x-amz-version-id'] = result.versionId
        }

        return null
      },
      {
        params: t.Object({
          bucket: t.String(),
          key: t.String(),
        }),
        query: t.Object({
          'X-DWS-Signature': t.Optional(t.String()),
          'X-DWS-Expires': t.Optional(t.String()),
          'X-DWS-Operation': t.Optional(t.String()),
        }),
        headers: t.Object({
          'content-type': t.Optional(t.String()),
          'cache-control': t.Optional(t.String()),
          'content-disposition': t.Optional(t.String()),
          'content-encoding': t.Optional(t.String()),
        }),
      },
    )

    // Get object
    .get(
      '/:bucket/:key',
      async ({ params, query, headers, set, request }) => {
        const isHead = request.method === 'HEAD'

        // Check for presigned URL
        const signature = query['X-DWS-Signature']
        const expires = query['X-DWS-Expires']
        const operation = query['X-DWS-Operation']

        if (signature && expires && operation) {
          if (
            !s3.verifyPresignedUrl(
              params.bucket,
              params.key,
              signature,
              expires,
              operation,
            )
          ) {
            set.status = 403
            return { error: 'Invalid signature' }
          }
        }

        // For HEAD requests, use headObject to avoid fetching the body
        if (isHead) {
          const result = await s3.headObject(params.bucket, params.key)

          const responseHeaders = new Headers()
          responseHeaders.set('Content-Type', result.contentType)
          responseHeaders.set('Content-Length', String(result.contentLength))
          responseHeaders.set('ETag', result.etag)
          responseHeaders.set(
            'Last-Modified',
            result.lastModified.toUTCString(),
          )
          responseHeaders.set('x-amz-storage-class', result.storageClass)

          if (result.versionId) {
            responseHeaders.set('x-amz-version-id', result.versionId)
          }

          for (const [metaKey, value] of Object.entries(result.metadata)) {
            responseHeaders.set(`x-amz-meta-${metaKey}`, value)
          }

          return new Response(null, { status: 200, headers: responseHeaders })
        }

        const ifNoneMatch = headers['if-none-match']
        const ifModifiedSince = headers['if-modified-since']
        const range = headers.range

        const result = await s3.getObject({
          bucket: params.bucket,
          key: params.key,
          versionId: query.versionId,
          range,
          ifNoneMatch,
          ifModifiedSince: ifModifiedSince
            ? new Date(ifModifiedSince)
            : undefined,
        })

        const responseHeaders = new Headers()
        responseHeaders.set('Content-Type', result.contentType)
        responseHeaders.set('Content-Length', String(result.contentLength))
        responseHeaders.set('ETag', result.etag)
        responseHeaders.set('Last-Modified', result.lastModified.toUTCString())

        if (result.versionId) {
          responseHeaders.set('x-amz-version-id', result.versionId)
        }
        if (result.cacheControl) {
          responseHeaders.set('Cache-Control', result.cacheControl)
        }

        // Add metadata headers
        for (const [metaKey, value] of Object.entries(result.metadata)) {
          responseHeaders.set(`x-amz-meta-${metaKey}`, value)
        }

        return new Response(new Uint8Array(result.body), {
          status: range ? 206 : 200,
          headers: responseHeaders,
        })
      },
      {
        params: t.Object({
          bucket: t.String(),
          key: t.String(),
        }),
        query: t.Object({
          'X-DWS-Signature': t.Optional(t.String()),
          'X-DWS-Expires': t.Optional(t.String()),
          'X-DWS-Operation': t.Optional(t.String()),
          versionId: t.Optional(t.String()),
        }),
        headers: t.Object({
          'if-none-match': t.Optional(t.String()),
          'if-modified-since': t.Optional(t.String()),
          range: t.Optional(t.String()),
        }),
      },
    )

    // Delete object
    .delete(
      '/:bucket/:key',
      async ({ params, set }) => {
        await s3.deleteObject({ bucket: params.bucket, key: params.key })
        set.status = 204
        return null
      },
      {
        params: t.Object({
          bucket: t.String(),
          key: t.String(),
        }),
      },
    )

    // ============================================================================
    // Multipart Upload
    // ============================================================================

    // Initiate or complete multipart upload
    .post(
      '/:bucket/:key',
      async ({ params, query, body, set }) => {
        const uploads = query.uploads

        if (uploads !== undefined) {
          const uploadId = await s3.createMultipartUpload(
            params.bucket,
            params.key,
          )
          return {
            Bucket: params.bucket,
            Key: params.key,
            UploadId: uploadId,
          }
        }

        // Complete multipart upload
        const uploadId = query.uploadId
        if (
          uploadId &&
          body &&
          typeof body === 'object' &&
          'CompleteMultipartUpload' in body
        ) {
          const completeBody = body as {
            CompleteMultipartUpload: {
              Part: Array<{ PartNumber: number; ETag: string }>
            }
          }

          const parts = completeBody.CompleteMultipartUpload.Part.map((p) => ({
            partNumber: p.PartNumber,
            etag: p.ETag,
          }))

          const result = await s3.completeMultipartUpload(uploadId, parts)

          return {
            Location: `/${params.bucket}/${params.key}`,
            Bucket: params.bucket,
            Key: params.key,
            ETag: result.etag,
          }
        }

        set.status = 400
        return { Error: { Code: 'InvalidRequest', Message: 'Invalid request' } }
      },
      {
        params: t.Object({
          bucket: t.String(),
          key: t.String(),
        }),
        query: t.Object({
          uploads: t.Optional(t.String()),
          uploadId: t.Optional(t.String()),
        }),
      },
    )

    // ============================================================================
    // Presigned URLs
    // ============================================================================

    .post(
      '/presign',
      async ({ body }) => {
        const result = s3.generatePresignedUrl({
          bucket: body.bucket,
          key: body.key,
          operation: body.operation,
          expiresIn: body.expiresIn,
          contentType: body.contentType,
        })

        return result
      },
      {
        body: t.Object({
          bucket: t.String(),
          key: t.String(),
          operation: t.Union([t.Literal('GET'), t.Literal('PUT')]),
          expiresIn: t.Optional(t.Number()),
          contentType: t.Optional(t.String()),
        }),
      },
    )

  return router
}

export type S3Routes = ReturnType<typeof createS3Router>
