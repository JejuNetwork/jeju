/**
 * HuggingFace Hub Compatibility Layer
 *
 * Provides HuggingFace Hub-compatible API for storing and serving ML models
 * on the decentralized DWS network.
 *
 * Supports:
 * - Model uploads (safetensors, GGUF, ONNX)
 * - Model downloads with streaming
 * - Model cards and metadata
 * - Git LFS compatible endpoints
 * - Transformers auto-download integration
 *
 * Users can use `huggingface-cli` and `transformers` with:
 *   HF_ENDPOINT=https://dws.jejunetwork.org/hf
 */

import { createHash } from 'node:crypto'
import { getDWSUrl, getLocalhostHost } from '@jejunetwork/config'
import { Elysia, t } from 'elysia'
import type { Address } from 'viem'

export interface HFModelConfig {
  modelId: string
  revision: string
  files: HFModelFile[]
  cardContent?: string
  config?: Record<string, unknown>
  owner: Address
  createdAt: number
  updatedAt: number
}

export interface HFModelFile {
  filename: string
  size: number
  sha256: string
  ipfsCid: string
  lfsPointer?: string
}

export interface HFRepoInfo {
  id: string
  modelId: string
  sha: string
  lastModified: string
  tags: string[]
  pipeline_tag?: string
  library_name?: string
  siblings: HFSibling[]
  private: boolean
  disabled: boolean
  gated: boolean
  config?: Record<string, unknown>
  cardData?: {
    license?: string
    language?: string[]
    tags?: string[]
    datasets?: string[]
    model_name?: string
  }
}

interface HFSibling {
  rfilename: string
  size?: number
  blobId?: string
  lfs?: {
    oid: string
    size: number
    pointerSize: number
  }
}

interface HFLFSBatchRequest {
  operation: 'download' | 'upload'
  transfers: string[]
  objects: Array<{
    oid: string
    size: number
  }>
  ref?: { name: string }
}

interface HFLFSBatchResponse {
  transfer: string
  objects: Array<{
    oid: string
    size: number
    authenticated: boolean
    actions?: {
      download?: {
        href: string
        header?: Record<string, string>
        expires_in: number
      }
      upload?: {
        href: string
        header?: Record<string, string>
        expires_in: number
      }
    }
    error?: { code: number; message: string }
  }>
}

// In-memory model registry (in production, use on-chain or decentralized storage)
const modelRegistry = new Map<string, HFModelConfig>()
const fileRegistry = new Map<string, HFModelFile>() // oid -> file info

/**
 * Parse model ID from path
 * Supports: org/model, model (default org), org/model/revision
 * @internal Reserved for future use
 */
function parseModelPath(path: string): {
  org: string
  model: string
  revision: string
} {
  const parts = path.split('/').filter(Boolean)

  if (parts.length === 1) {
    return { org: 'jeju', model: parts[0], revision: 'main' }
  }
  if (parts.length === 2) {
    return { org: parts[0], model: parts[1], revision: 'main' }
  }
  if (parts.length >= 3) {
    return {
      org: parts[0],
      model: parts[1],
      revision: parts.slice(2).join('/'),
    }
  }

  throw new Error('Invalid model path')
}
void parseModelPath

/**
 * Generate SHA256 hash for content
 */
function sha256(content: Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Generate Git LFS pointer content
 */
function generateLFSPointer(oid: string, size: number): string {
  return `version https://git-lfs.github.com/spec/v1
oid sha256:${oid}
size ${size}
`
}

/**
 * Parse Git LFS pointer
 * @internal Reserved for future use
 */
function parseLFSPointer(
  content: string,
): { oid: string; size: number } | null {
  const oidMatch = content.match(/oid sha256:([a-f0-9]{64})/)
  const sizeMatch = content.match(/size (\d+)/)

  if (!oidMatch || !sizeMatch) return null

  return {
    oid: oidMatch[1],
    size: parseInt(sizeMatch[1], 10),
  }
}
void parseLFSPointer

/**
 * Get IPFS client URL from environment
 */
function getIPFSUrl(): string {
  const host = getLocalhostHost()
  return process.env.IPFS_API_URL ?? `http://${host}:5001`
}

/**
 * Upload file to IPFS
 */
async function uploadToIPFS(content: Uint8Array): Promise<string> {
  const ipfsUrl = getIPFSUrl()

  // Convert Uint8Array to ArrayBuffer to satisfy BlobPart type
  const buffer = content.buffer.slice(
    content.byteOffset,
    content.byteOffset + content.byteLength,
  ) as ArrayBuffer

  const formData = new FormData()
  formData.append('file', new Blob([buffer]))

  const response = await fetch(`${ipfsUrl}/api/v0/add?cid-version=1`, {
    method: 'POST',
    body: formData,
  })

  if (!response.ok) {
    throw new Error('IPFS upload failed')
  }

  const result = (await response.json()) as { Hash: string }
  return result.Hash
}

/**
 * Download file from IPFS
 */
async function downloadFromIPFS(cid: string): Promise<Uint8Array> {
  const ipfsUrl = getIPFSUrl()

  const response = await fetch(`${ipfsUrl}/api/v0/cat?arg=${cid}`, {
    method: 'POST',
  })

  if (!response.ok) {
    throw new Error('IPFS download failed')
  }

  return new Uint8Array(await response.arrayBuffer())
}

export function createHuggingFaceRouter() {
  return (
    new Elysia({ prefix: '/hf' })
      .get('/health', () => ({
        status: 'healthy',
        service: 'dws-hf-compat',
        modelsRegistered: modelRegistry.size,
      }))

      // === Model Info API ===

      // Get model info
      .get('/api/models/:org/:model', ({ params, set }) => {
        const modelId = `${params.org}/${params.model}`
        const config = modelRegistry.get(modelId)

        if (!config) {
          set.status = 404
          return { error: 'Model not found' }
        }

        const repoInfo: HFRepoInfo = {
          id: modelId,
          modelId,
          sha: config.revision,
          lastModified: new Date(config.updatedAt).toISOString(),
          tags: [],
          siblings: config.files.map((f) => ({
            rfilename: f.filename,
            size: f.size,
            blobId: f.sha256,
            lfs: f.lfsPointer
              ? {
                  oid: f.sha256,
                  size: f.size,
                  pointerSize: f.lfsPointer.length,
                }
              : undefined,
          })),
          private: false,
          disabled: false,
          gated: false,
          config: config.config,
        }

        return repoInfo
      })

      // List model files
      .get('/api/models/:org/:model/tree/:revision', ({ params, set }) => {
        const modelId = `${params.org}/${params.model}`
        const config = modelRegistry.get(modelId)

        if (!config) {
          set.status = 404
          return { error: 'Model not found' }
        }

        return config.files.map((f) => ({
          type: 'file',
          path: f.filename,
          size: f.size,
          oid: f.sha256,
          lfs: f.lfsPointer
            ? {
                oid: f.sha256,
                size: f.size,
                pointerSize: f.lfsPointer.length,
              }
            : undefined,
        }))
      })

      // Get model card
      .get('/api/models/:org/:model/readme', ({ params, set }) => {
        const modelId = `${params.org}/${params.model}`
        const config = modelRegistry.get(modelId)

        if (!config?.cardContent) {
          set.status = 404
          return { error: 'README not found' }
        }

        return new Response(config.cardContent, {
          headers: { 'Content-Type': 'text/markdown' },
        })
      })

      // === Git LFS API ===

      // LFS Batch API (main endpoint for downloads/uploads)
      .post(
        '/:org/:model/info/lfs/objects/batch',
        async ({ params, body }) => {
          void `${params.org}/${params.model}` // modelId reserved for future use
          const request = body as HFLFSBatchRequest

          const response: HFLFSBatchResponse = {
            transfer: 'basic',
            objects: [],
          }

          for (const obj of request.objects) {
            const fileInfo = fileRegistry.get(obj.oid)

            if (request.operation === 'download') {
              if (fileInfo) {
                response.objects.push({
                  oid: obj.oid,
                  size: obj.size,
                  authenticated: true,
                  actions: {
                    download: {
                      href: `${process.env.DWS_URL ?? (getDWSUrl() ?? `http://${getLocalhostHost()}:4030`)}/hf/lfs/${obj.oid}`,
                      expires_in: 3600,
                    },
                  },
                })
              } else {
                response.objects.push({
                  oid: obj.oid,
                  size: obj.size,
                  authenticated: true,
                  error: { code: 404, message: 'Object not found' },
                })
              }
            } else if (request.operation === 'upload') {
              response.objects.push({
                oid: obj.oid,
                size: obj.size,
                authenticated: true,
                actions: {
                  upload: {
                    href: `${process.env.DWS_URL ?? 'http://localhost:4030'}/hf/lfs/${obj.oid}`,
                    expires_in: 3600,
                  },
                },
              })
            }
          }

          return response
        },
        {
          body: t.Object({
            operation: t.String(),
            transfers: t.Array(t.String()),
            objects: t.Array(
              t.Object({
                oid: t.String(),
                size: t.Number(),
              }),
            ),
            ref: t.Optional(t.Object({ name: t.String() })),
          }),
        },
      )

      // LFS Object Download
      .get('/lfs/:oid', async ({ params, set }) => {
        const fileInfo = fileRegistry.get(params.oid)

        if (!fileInfo) {
          set.status = 404
          return { error: 'Object not found' }
        }

        const content = await downloadFromIPFS(fileInfo.ipfsCid)

        // Convert Uint8Array to ArrayBuffer for Response body
        const buffer = content.buffer.slice(
          content.byteOffset,
          content.byteOffset + content.byteLength,
        ) as ArrayBuffer

        return new Response(buffer, {
          headers: {
            'Content-Type': 'application/octet-stream',
            'Content-Length': String(fileInfo.size),
            'X-IPFS-CID': fileInfo.ipfsCid,
          },
        })
      })

      // LFS Object Upload
      .put('/lfs/:oid', async ({ params, body, set }) => {
        const content = new Uint8Array(body as ArrayBuffer)
        const computedOid = sha256(content)

        if (computedOid !== params.oid) {
          set.status = 400
          return { error: 'SHA256 mismatch' }
        }

        const ipfsCid = await uploadToIPFS(content)

        fileRegistry.set(params.oid, {
          filename: '', // Will be set when model is registered
          size: content.length,
          sha256: params.oid,
          ipfsCid,
          lfsPointer: generateLFSPointer(params.oid, content.length),
        })

        set.status = 200
        return { success: true, ipfsCid }
      })

      // === File Download (non-LFS) ===

      // Download model file by path
      .get('/:org/:model/resolve/:revision/*', async ({ params, set }) => {
        const modelId = `${params.org}/${params.model}`
        const config = modelRegistry.get(modelId)

        if (!config) {
          set.status = 404
          return { error: 'Model not found' }
        }

        // Get file path from wildcard
        const filePath = params['*']
        const fileInfo = config.files.find((f) => f.filename === filePath)

        if (!fileInfo) {
          set.status = 404
          return { error: 'File not found' }
        }

        const content = await downloadFromIPFS(fileInfo.ipfsCid)

        // Determine content type
        let contentType = 'application/octet-stream'
        if (filePath.endsWith('.json')) contentType = 'application/json'
        else if (filePath.endsWith('.txt')) contentType = 'text/plain'
        else if (filePath.endsWith('.md')) contentType = 'text/markdown'

        // Convert Uint8Array to ArrayBuffer for Response body
        const buffer = content.buffer.slice(
          content.byteOffset,
          content.byteOffset + content.byteLength,
        ) as ArrayBuffer

        return new Response(buffer, {
          headers: {
            'Content-Type': contentType,
            'Content-Length': String(fileInfo.size),
            'X-IPFS-CID': fileInfo.ipfsCid,
            ETag: `"${fileInfo.sha256}"`,
          },
        })
      })

      // === Model Registration API ===

      // Register/update a model
      .post(
        '/api/models/:org/:model',
        async ({ params, body }) => {
          const modelId = `${params.org}/${params.model}`

          const config: HFModelConfig = {
            modelId,
            revision: body.revision ?? 'main',
            files: body.files ?? [],
            cardContent: body.cardContent,
            config: body.config,
            owner: (body.owner ??
              '0x0000000000000000000000000000000000000000') as Address,
            createdAt: modelRegistry.get(modelId)?.createdAt ?? Date.now(),
            updatedAt: Date.now(),
          }

          // Register files
          for (const file of config.files) {
            fileRegistry.set(file.sha256, file)
          }

          modelRegistry.set(modelId, config)

          return {
            success: true,
            modelId,
            revision: config.revision,
            filesCount: config.files.length,
          }
        },
        {
          body: t.Object({
            revision: t.Optional(t.String()),
            files: t.Optional(
              t.Array(
                t.Object({
                  filename: t.String(),
                  size: t.Number(),
                  sha256: t.String(),
                  ipfsCid: t.String(),
                  lfsPointer: t.Optional(t.String()),
                }),
              ),
            ),
            cardContent: t.Optional(t.String()),
            config: t.Optional(t.Record(t.String(), t.Unknown())),
            owner: t.Optional(t.String()),
          }),
        },
      )

      // Upload a file to a model
      .post('/:org/:model/upload/:revision/*', async ({ params, body }) => {
        const modelId = `${params.org}/${params.model}`
        const filePath = params['*']
        const content = new Uint8Array(body as ArrayBuffer)

        // Upload to IPFS
        const ipfsCid = await uploadToIPFS(content)
        const fileHash = sha256(content)

        const fileInfo: HFModelFile = {
          filename: filePath,
          size: content.length,
          sha256: fileHash,
          ipfsCid,
        }

        // If file is large, use LFS
        if (content.length > 10 * 1024 * 1024) {
          fileInfo.lfsPointer = generateLFSPointer(fileHash, content.length)
        }

        // Update model config
        let config = modelRegistry.get(modelId)
        if (!config) {
          config = {
            modelId,
            revision: params.revision,
            files: [],
            owner: '0x0000000000000000000000000000000000000000' as Address,
            createdAt: Date.now(),
            updatedAt: Date.now(),
          }
        }

        // Remove existing file with same name
        config.files = config.files.filter((f) => f.filename !== filePath)
        config.files.push(fileInfo)
        config.updatedAt = Date.now()

        modelRegistry.set(modelId, config)
        fileRegistry.set(fileHash, fileInfo)

        return {
          success: true,
          filename: filePath,
          size: content.length,
          sha256: fileHash,
          ipfsCid,
        }
      })

      // === Search API ===

      // Search models
      .get(
        '/api/models',
        ({ query }) => {
          const searchTerm = query.search?.toLowerCase() ?? ''
          const limit = parseInt(query.limit ?? '20', 10)

          const results = Array.from(modelRegistry.entries())
            .filter(
              ([id]) =>
                searchTerm === '' || id.toLowerCase().includes(searchTerm),
            )
            .slice(0, limit)
            .map(([id, config]) => ({
              id,
              modelId: id,
              lastModified: new Date(config.updatedAt).toISOString(),
              tags: [],
              downloads: 0, // Not tracked yet
              likes: 0, // Not tracked yet
            }))

          return results
        },
        {
          query: t.Object({
            search: t.Optional(t.String()),
            limit: t.Optional(t.String()),
          }),
        },
      )
  )
}

export { modelRegistry, fileRegistry }
