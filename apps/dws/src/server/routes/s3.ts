/**
 * S3-Compatible API Routes
 * AWS S3 API compatibility layer for DWS storage
 */

import { Hono } from 'hono';
import { S3Backend, S3Error, NotModifiedError } from '../../storage/s3-backend';
import type { BackendManager } from '../../storage/backends';

export function createS3Router(backend: BackendManager): Hono {
  const router = new Hono();
  const s3 = new S3Backend(backend);

  // Error handler
  const handleError = (error: unknown): { status: 200 | 400 | 403 | 404 | 409 | 410 | 413 | 500 | 304; body: { Error: { Code: string; Message: string; RequestId: string } } | null } => {
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
      };
    }
    if (error instanceof NotModifiedError) {
      return { status: 304, body: null };
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
    };
  };

  // ============================================================================
  // Service Operations
  // ============================================================================

  // Health check (must come before wildcard routes)
  router.get('/health', (c) => {
    const stats = s3.getStats();
    return c.json({
      status: 'healthy',
      service: 'dws-s3',
      ...stats,
    });
  });

  // List buckets
  router.get('/', async (c) => {
    const owner = c.req.header('x-jeju-address');
    const buckets = await s3.listBuckets(owner);

    return c.json({
      Buckets: buckets.map(b => ({
        Name: b.name,
        CreationDate: b.creationDate.toISOString(),
      })),
      Owner: { ID: owner ?? 'anonymous' },
    });
  });

  // ============================================================================
  // Bucket Operations
  // ============================================================================

  // Create bucket
  router.put('/:bucket', async (c) => {
    const bucket = c.req.param('bucket');
    const owner = c.req.header('x-jeju-address') ?? 'anonymous';
    const region = c.req.header('x-amz-bucket-region') ?? 'us-east-1';

    try {
      await s3.createBucket(bucket, owner, region);
      return c.body(null, 200);
    } catch (error) {
      const { status, body } = handleError(error);
      return c.json(body, status);
    }
  });

  // Delete bucket
  router.delete('/:bucket', async (c) => {
    const bucket = c.req.param('bucket');

    try {
      await s3.deleteBucket(bucket);
      return c.body(null, 204);
    } catch (error) {
      const { status, body } = handleError(error);
      return c.json(body, status);
    }
  });

  // Get bucket location
  router.get('/:bucket', async (c) => {
    const bucket = c.req.param('bucket');
    const listType = c.req.query('list-type');

    // List objects if list-type is specified
    if (listType === '2') {
      try {
        const result = await s3.listObjects({
          bucket,
          prefix: c.req.query('prefix'),
          delimiter: c.req.query('delimiter'),
          maxKeys: parseInt(c.req.query('max-keys') ?? '1000'),
          continuationToken: c.req.query('continuation-token'),
          startAfter: c.req.query('start-after'),
        });

        return c.json({
          Name: result.name,
          Prefix: result.prefix,
          KeyCount: result.keyCount,
          MaxKeys: result.maxKeys,
          IsTruncated: result.isTruncated,
          Contents: result.contents.map(obj => ({
            Key: obj.key,
            LastModified: obj.lastModified.toISOString(),
            ETag: obj.etag,
            Size: obj.size,
            StorageClass: obj.storageClass,
          })),
          CommonPrefixes: result.commonPrefixes.map(p => ({ Prefix: p })),
          ContinuationToken: result.continuationToken,
          NextContinuationToken: result.nextContinuationToken,
        });
      } catch (error) {
        const { status, body } = handleError(error);
        return c.json(body, status);
      }
    }

    // Get bucket info
    const bucketInfo = await s3.getBucket(bucket);
    if (!bucketInfo) {
      return c.json({
        Error: { Code: 'NoSuchBucket', Message: 'Bucket does not exist' },
      }, 404);
    }

    return c.json({
      LocationConstraint: bucketInfo.region,
    });
  });

  // ============================================================================
  // Object Operations
  // ============================================================================

  // Put object
  router.put('/:bucket/:key{.+}', async (c) => {
    const bucket = c.req.param('bucket');
    const key = c.req.param('key');

    // Check for presigned URL
    const signature = c.req.query('X-DWS-Signature');
    const expires = c.req.query('X-DWS-Expires');
    const operation = c.req.query('X-DWS-Operation');

    if (signature && expires && operation) {
      if (!s3.verifyPresignedUrl(bucket, key, signature, expires, operation)) {
        return c.json({
          Error: { Code: 'SignatureDoesNotMatch', Message: 'Invalid signature' },
        }, 403);
      }
    }

    try {
      const body = await c.req.arrayBuffer();
      const contentType = c.req.header('content-type');
      
      // Parse metadata headers
      const metadata: Record<string, string> = {};
      for (const [headerKey, value] of Object.entries(c.req.header())) {
        if (headerKey.toLowerCase().startsWith('x-amz-meta-')) {
          metadata[headerKey.slice(11)] = value as string;
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
      });

      c.header('ETag', result.etag);
      if (result.versionId) {
        c.header('x-amz-version-id', result.versionId);
      }

      return c.body(null, 200);
    } catch (error) {
      const { status, body } = handleError(error);
      return c.json(body, status);
    }
  });

  // Get object
  router.get('/:bucket/:key{.+}', async (c) => {
    const bucket = c.req.param('bucket');
    const key = c.req.param('key');

    // Check for presigned URL
    const signature = c.req.query('X-DWS-Signature');
    const expires = c.req.query('X-DWS-Expires');
    const operation = c.req.query('X-DWS-Operation');

    if (signature && expires && operation) {
      if (!s3.verifyPresignedUrl(bucket, key, signature, expires, operation)) {
        return c.json({
          Error: { Code: 'SignatureDoesNotMatch', Message: 'Invalid signature' },
        }, 403);
      }
    }

    try {
      const ifNoneMatch = c.req.header('if-none-match');
      const ifModifiedSince = c.req.header('if-modified-since');
      const range = c.req.header('range');

      const result = await s3.getObject({
        bucket,
        key,
        versionId: c.req.query('versionId'),
        range,
        ifNoneMatch,
        ifModifiedSince: ifModifiedSince ? new Date(ifModifiedSince) : undefined,
      });

      c.header('Content-Type', result.contentType);
      c.header('Content-Length', String(result.contentLength));
      c.header('ETag', result.etag);
      c.header('Last-Modified', result.lastModified.toUTCString());

      if (result.versionId) {
        c.header('x-amz-version-id', result.versionId);
      }
      if (result.cacheControl) {
        c.header('Cache-Control', result.cacheControl);
      }

      // Add metadata headers
      for (const [metaKey, value] of Object.entries(result.metadata)) {
        c.header(`x-amz-meta-${metaKey}`, value);
      }

      return new Response(new Uint8Array(result.body), {
        status: range ? 206 : 200,
        headers: c.res.headers,
      });
    } catch (error) {
      if (error instanceof NotModifiedError) {
        return c.body(null, 304);
      }
      const { status, body } = handleError(error);
      return c.json(body, status);
    }
  });

  // Head object
  router.on('HEAD', '/:bucket/:key{.+}', async (c) => {
    const bucket = c.req.param('bucket');
    const key = c.req.param('key');

    try {
      const result = await s3.headObject(bucket, key);

      c.header('Content-Type', result.contentType);
      c.header('Content-Length', String(result.contentLength));
      c.header('ETag', result.etag);
      c.header('Last-Modified', result.lastModified.toUTCString());
      c.header('x-amz-storage-class', result.storageClass);

      if (result.versionId) {
        c.header('x-amz-version-id', result.versionId);
      }

      for (const [metaKey, value] of Object.entries(result.metadata)) {
        c.header(`x-amz-meta-${metaKey}`, value);
      }

      return c.body(null, 200);
    } catch (error) {
      const { status, body } = handleError(error);
      return c.json(body, status);
    }
  });

  // Delete object
  router.delete('/:bucket/:key{.+}', async (c) => {
    const bucket = c.req.param('bucket');
    const key = c.req.param('key');

    try {
      await s3.deleteObject({ bucket, key });
      return c.body(null, 204);
    } catch (error) {
      const { status, body } = handleError(error);
      return c.json(body, status);
    }
  });

  // ============================================================================
  // Multipart Upload
  // ============================================================================

  // Initiate multipart upload
  router.post('/:bucket/:key{.+}', async (c) => {
    const bucket = c.req.param('bucket');
    const key = c.req.param('key');
    const uploads = c.req.query('uploads');

    if (uploads !== undefined) {
      try {
        const uploadId = await s3.createMultipartUpload(bucket, key);
        return c.json({
          Bucket: bucket,
          Key: key,
          UploadId: uploadId,
        });
      } catch (error) {
        const { status, body } = handleError(error);
        return c.json(body, status);
      }
    }

    // Complete multipart upload
    const uploadId = c.req.query('uploadId');
    if (uploadId) {
      try {
        const body = await c.req.json<{
          CompleteMultipartUpload: {
            Part: Array<{ PartNumber: number; ETag: string }>;
          };
        }>();

        const parts = body.CompleteMultipartUpload.Part.map(p => ({
          partNumber: p.PartNumber,
          etag: p.ETag,
        }));

        const result = await s3.completeMultipartUpload(uploadId, parts);

        return c.json({
          Location: `/${bucket}/${key}`,
          Bucket: bucket,
          Key: key,
          ETag: result.etag,
        });
      } catch (error) {
        const { status, body } = handleError(error);
        return c.json(body, status);
      }
    }

    return c.json({ Error: { Code: 'InvalidRequest', Message: 'Invalid request' } }, 400);
  });

  // ============================================================================
  // Presigned URLs
  // ============================================================================

  router.post('/presign', async (c) => {
    const body = await c.req.json<{
      bucket: string;
      key: string;
      operation: 'getObject' | 'putObject';
      expiresIn: number;
      contentType?: string;
    }>();

    const result = s3.generatePresignedUrl({
      bucket: body.bucket,
      key: body.key,
      operation: body.operation,
      expiresIn: body.expiresIn,
      contentType: body.contentType,
    });

    return c.json(result);
  });

  return router;
}

function getStatusForError(code: string): 200 | 400 | 403 | 404 | 409 | 410 | 413 | 500 {
  switch (code) {
    case 'NoSuchBucket':
    case 'NoSuchKey':
    case 'NoSuchUpload':
      return 404;
    case 'BucketAlreadyExists':
    case 'BucketNotEmpty':
      return 409;
    case 'AccessDenied':
      return 403;
    case 'InvalidBucketName':
    case 'InvalidRequest':
    case 'InvalidPart':
    case 'InvalidPartOrder':
      return 400;
    case 'EntityTooLarge':
      return 413;
    default:
      return 500;
  }
}

