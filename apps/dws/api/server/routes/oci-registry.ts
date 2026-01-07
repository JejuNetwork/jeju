/**
 * OCI Distribution API Server
 *
 * Implements Docker Registry HTTP API V2 specification for DWS Container Registry.
 * Allows `docker pull registry.jeju/image:tag` to work transparently.
 *
 * Architecture:
 * 1. Manifests: Resolved from on-chain ContainerRegistry contract or proxied from upstream
 * 2. Blobs/Layers: Served from IPFS via DWS Storage
 * 3. Fallback: Proxies to Docker Hub for official images not yet in DWS
 *
 * @see https://distribution.github.io/distribution/spec/api/
 */

import {
  getCurrentNetwork,
  getDWSUrl,
  getIpfsGatewayUrl,
  getRpcUrl,
  getServiceUrl,
  tryGetContract,
} from '@jejunetwork/config'
import { Elysia } from 'elysia'
import type { Address } from 'viem'
import { createPublicClient, http } from 'viem'

const network = getCurrentNetwork()

// Storage endpoints
const IPFS_GATEWAY = process.env.IPFS_GATEWAY_URL || getIpfsGatewayUrl(network)

const STORAGE_ENDPOINT =
  process.env.DWS_STORAGE_URL ||
  getServiceUrl('storage', 'api', network) ||
  `${getDWSUrl(network)}/storage`

// ContainerRegistry contract
const CONTAINER_REGISTRY_ADDRESS =
  (process.env.CONTAINER_REGISTRY_ADDRESS as Address | undefined) ??
  (tryGetContract('dws', 'containerRegistry', network) as Address | undefined)

const RPC_URL = process.env.RPC_URL || getRpcUrl(network)

// Registry ABI
const CONTAINER_REGISTRY_ABI = [
  {
    name: 'getRepoByName',
    type: 'function',
    inputs: [
      { name: 'namespace', type: 'string' },
      { name: 'name', type: 'string' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'repoId', type: 'bytes32' },
          { name: 'name', type: 'string' },
          { name: 'namespace', type: 'string' },
          { name: 'owner', type: 'address' },
          { name: 'ownerAgentId', type: 'uint256' },
          { name: 'description', type: 'string' },
          { name: 'visibility', type: 'uint8' },
          { name: 'tags', type: 'string[]' },
          { name: 'createdAt', type: 'uint256' },
          { name: 'updatedAt', type: 'uint256' },
          { name: 'pullCount', type: 'uint256' },
          { name: 'starCount', type: 'uint256' },
          { name: 'isVerified', type: 'bool' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getManifestByTag',
    type: 'function',
    inputs: [
      { name: 'repoId', type: 'bytes32' },
      { name: 'tag', type: 'string' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'manifestId', type: 'bytes32' },
          { name: 'repoId', type: 'bytes32' },
          { name: 'tag', type: 'string' },
          { name: 'digest', type: 'string' },
          { name: 'manifestUri', type: 'string' },
          { name: 'manifestHash', type: 'bytes32' },
          { name: 'size', type: 'uint256' },
          { name: 'architectures', type: 'string[]' },
          { name: 'layers', type: 'string[]' },
          { name: 'publishedAt', type: 'uint256' },
          { name: 'publisher', type: 'address' },
          { name: 'buildInfo', type: 'string' },
        ],
      },
    ],
    stateMutability: 'view',
  },
  {
    name: 'getManifestByDigest',
    type: 'function',
    inputs: [
      { name: 'repoId', type: 'bytes32' },
      { name: 'digest', type: 'string' },
    ],
    outputs: [
      {
        name: '',
        type: 'tuple',
        components: [
          { name: 'manifestId', type: 'bytes32' },
          { name: 'repoId', type: 'bytes32' },
          { name: 'tag', type: 'string' },
          { name: 'digest', type: 'string' },
          { name: 'manifestUri', type: 'string' },
          { name: 'manifestHash', type: 'bytes32' },
          { name: 'size', type: 'uint256' },
          { name: 'architectures', type: 'string[]' },
          { name: 'layers', type: 'string[]' },
          { name: 'publishedAt', type: 'uint256' },
          { name: 'publisher', type: 'address' },
          { name: 'buildInfo', type: 'string' },
        ],
      },
    ],
    stateMutability: 'view',
  },
] as const

// Explicit types for contract return values
interface ContainerRepo {
  repoId: `0x${string}`
  name: string
  namespace: string
  owner: `0x${string}`
  ownerAgentId: bigint
  description: string
  visibility: number
  tags: readonly string[]
  createdAt: bigint
  updatedAt: bigint
  pullCount: bigint
  starCount: bigint
  isVerified: boolean
}

interface ContainerManifest {
  manifestId: `0x${string}`
  repoId: `0x${string}`
  tag: string
  digest: string
  manifestUri: string
  manifestHash: `0x${string}`
  size: bigint
  architectures: readonly string[]
  layers: readonly string[]
  publishedAt: bigint
  publisher: `0x${string}`
  buildInfo: string
}

let publicClient: ReturnType<typeof createPublicClient> | null = null

function getPublicClient() {
  if (!publicClient) {
    publicClient = createPublicClient({ transport: http(RPC_URL) })
  }
  return publicClient
}

// OCI Distribution spec constants
const OCI_MANIFEST_MEDIA_TYPE = 'application/vnd.oci.image.manifest.v1+json'
const DOCKER_MANIFEST_MEDIA_TYPE =
  'application/vnd.docker.distribution.manifest.v2+json'
const DOCKER_MANIFEST_LIST_MEDIA_TYPE =
  'application/vnd.docker.distribution.manifest.list.v2+json'

// Proxy cache for upstream images
interface CachedManifest {
  digest: string
  mediaType: string
  content: string
  size: number
  cachedAt: number
}

interface CachedBlob {
  digest: string
  size: number
  cid: string
  cachedAt: number
}

const manifestCache = new Map<string, CachedManifest>()
const blobCache = new Map<string, CachedBlob>()

// Official images to proxy from Docker Hub when not in DWS
const PROXY_UPSTREAMS: Record<string, string> = {
  library: 'https://registry-1.docker.io',
  docker: 'https://registry-1.docker.io',
}

// Images that should be proxied and cached from upstream
const PROXY_IMAGES = new Set([
  'postgres',
  'redis',
  'rabbitmq',
  'minio/minio',
  'nginx',
  'alpine',
  'ubuntu',
  'node',
  'python',
  'golang',
])

/**
 * Get Docker Hub auth token for public image pulls
 */
async function getDockerHubToken(
  namespace: string,
  name: string,
): Promise<string> {
  const scope = `repository:${namespace}/${name}:pull`
  const response = await fetch(
    `https://auth.docker.io/token?service=registry.docker.io&scope=${encodeURIComponent(scope)}`,
  )
  if (!response.ok) {
    throw new Error(`Failed to get Docker Hub token: ${response.status}`)
  }
  const data = (await response.json()) as { token: string }
  return data.token
}

/**
 * Proxy manifest from upstream registry
 */
async function proxyManifest(
  namespace: string,
  name: string,
  reference: string,
): Promise<{ manifest: string; digest: string; mediaType: string } | null> {
  const cacheKey = `${namespace}/${name}:${reference}`
  const cached = manifestCache.get(cacheKey)
  if (cached && Date.now() - cached.cachedAt < 3600000) {
    // 1 hour cache
    return {
      manifest: cached.content,
      digest: cached.digest,
      mediaType: cached.mediaType,
    }
  }

  const upstream = PROXY_UPSTREAMS[namespace]
  if (!upstream) return null

  const fullName = namespace === 'library' ? name : `${namespace}/${name}`

  const token = await getDockerHubToken(
    namespace === 'library' ? 'library' : namespace,
    name,
  )

  const response = await fetch(
    `${upstream}/v2/${fullName}/manifests/${reference}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: [
          DOCKER_MANIFEST_LIST_MEDIA_TYPE,
          DOCKER_MANIFEST_MEDIA_TYPE,
          OCI_MANIFEST_MEDIA_TYPE,
        ].join(', '),
      },
    },
  )

  if (!response.ok) return null

  const manifest = await response.text()
  const digest = response.headers.get('Docker-Content-Digest')
  if (!digest) {
    console.warn(
      `[OCI] No Docker-Content-Digest header for ${namespace}/${name}:${reference}`,
    )
    return null
  }
  const mediaType =
    response.headers.get('Content-Type') || DOCKER_MANIFEST_MEDIA_TYPE

  manifestCache.set(cacheKey, {
    digest,
    mediaType,
    content: manifest,
    size: manifest.length,
    cachedAt: Date.now(),
  })

  return { manifest, digest, mediaType }
}

async function proxyBlob(
  namespace: string,
  name: string,
  digest: string,
): Promise<{ size: number; stream: ReadableStream<Uint8Array> } | null> {
  // Check if already cached in IPFS
  const cached = blobCache.get(digest)
  if (cached) {
    const response = await fetch(`${IPFS_GATEWAY}/ipfs/${cached.cid}`)
    if (response.ok && response.body) {
      return { size: cached.size, stream: response.body }
    }
    // Cache entry invalid - remove it
    blobCache.delete(digest)
  }

  const upstream = PROXY_UPSTREAMS[namespace]
  if (!upstream) return null

  const fullName = namespace === 'library' ? name : `${namespace}/${name}`

  const token = await getDockerHubToken(
    namespace === 'library' ? 'library' : namespace,
    name,
  )

  const response = await fetch(`${upstream}/v2/${fullName}/blobs/${digest}`, {
    headers: { Authorization: `Bearer ${token}` },
  })

  if (!response.ok || !response.body) return null

  const contentLength = response.headers.get('Content-Length')
  if (!contentLength) {
    console.warn(`[OCI] No Content-Length for blob ${digest}`)
  }
  const size = contentLength ? parseInt(contentLength, 10) : 0

  // Cache to IPFS in background while streaming to client
  const [streamForClient, streamForCache] = response.body.tee()

  // Background cache - don't await
  cacheToIPFS(digest, streamForCache, size).catch((err) => {
    console.warn(
      `[OCI] Failed to cache blob ${digest}: ${err instanceof Error ? err.message : String(err)}`,
    )
  })

  return { size, stream: streamForClient }
}

async function cacheToIPFS(
  digest: string,
  stream: ReadableStream<Uint8Array>,
  size: number,
): Promise<void> {
  const chunks: Uint8Array[] = []
  const reader = stream.getReader()

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    if (value) chunks.push(value)
  }

  // Concatenate chunks into a single ArrayBuffer
  const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0)
  const combined = new Uint8Array(totalLength)
  let offset = 0
  for (const chunk of chunks) {
    combined.set(chunk, offset)
    offset += chunk.length
  }

  const blob = new Blob([combined.buffer])
  const formData = new FormData()
  formData.append('file', blob, `blob-${digest.slice(7, 19)}`)

  const uploadResponse = await fetch(`${STORAGE_ENDPOINT}/upload`, {
    method: 'POST',
    body: formData,
  })

  if (!uploadResponse.ok) {
    throw new Error(`Upload failed: ${uploadResponse.status}`)
  }

  const result = (await uploadResponse.json()) as { cid: string }
  blobCache.set(digest, { digest, cid: result.cid, size, cachedAt: Date.now() })
  console.log(`[OCI] Cached blob ${digest.slice(0, 16)}... -> ${result.cid}`)
}

/**
 * Resolve image from DWS ContainerRegistry contract
 */
async function resolveFromDWS(
  namespace: string,
  name: string,
  reference: string,
): Promise<{
  manifest: string
  digest: string
  mediaType: string
  layers: string[]
} | null> {
  if (!CONTAINER_REGISTRY_ADDRESS) return null

  const client = getPublicClient()

  // Get repository
  let repo: ContainerRepo | null = null
  try {
    repo = (await client.readContract({
      address: CONTAINER_REGISTRY_ADDRESS,
      abi: CONTAINER_REGISTRY_ABI,
      functionName: 'getRepoByName',
      args: [namespace, name],
    })) as ContainerRepo
  } catch (err) {
    console.debug(
      `[OCI] getRepoByName failed for ${namespace}/${name}: ${err instanceof Error ? err.message : String(err)}`,
    )
    return null
  }

  if (
    !repo ||
    repo.repoId ===
      '0x0000000000000000000000000000000000000000000000000000000000000000'
  ) {
    return null
  }

  // Get manifest by tag or digest
  const isDigest = reference.startsWith('sha256:')
  let manifestData: ContainerManifest | null = null
  try {
    manifestData = (await client.readContract({
      address: CONTAINER_REGISTRY_ADDRESS,
      abi: CONTAINER_REGISTRY_ABI,
      functionName: isDigest ? 'getManifestByDigest' : 'getManifestByTag',
      args: [repo.repoId, reference],
    })) as ContainerManifest
  } catch (err) {
    console.debug(
      `[OCI] getManifest failed for ${namespace}/${name}:${reference}: ${err instanceof Error ? err.message : String(err)}`,
    )
    return null
  }

  if (
    !manifestData ||
    manifestData.manifestId ===
      '0x0000000000000000000000000000000000000000000000000000000000000000'
  ) {
    return null
  }

  // Fetch manifest from IPFS
  const manifestResponse = await fetch(
    `${IPFS_GATEWAY}/ipfs/${manifestData.manifestUri}`,
  )
  if (!manifestResponse.ok) return null

  const manifest = await manifestResponse.text()

  return {
    manifest,
    digest: manifestData.digest,
    mediaType: DOCKER_MANIFEST_MEDIA_TYPE,
    layers: [...manifestData.layers],
  }
}

/**
 * Serve blob from DWS Storage (IPFS)
 */
async function serveBlobFromDWS(
  cid: string,
): Promise<{ size: number; stream: ReadableStream<Uint8Array> } | null> {
  const response = await fetch(`${STORAGE_ENDPOINT}/download/${cid}`)
  if (!response.ok || !response.body) {
    // Try direct IPFS gateway
    const ipfsResponse = await fetch(`${IPFS_GATEWAY}/ipfs/${cid}`)
    if (!ipfsResponse.ok || !ipfsResponse.body) return null
    return {
      size: parseInt(ipfsResponse.headers.get('Content-Length') || '0', 10),
      stream: ipfsResponse.body,
    }
  }
  return {
    size: parseInt(response.headers.get('Content-Length') || '0', 10),
    stream: response.body,
  }
}

/**
 * Create OCI Distribution API router
 */
export function createOCIRegistryRouter() {
  return (
    new Elysia({ prefix: '/v2' })
      .onError(({ error, set }) => {
        console.error('[OCI Registry]', error)
        set.status = 500
        return {
          errors: [
            {
              code: 'UNKNOWN',
              message: error instanceof Error ? error.message : 'Unknown error',
            },
          ],
        }
      })

      // API Version Check - Required by OCI spec
      .get('/', ({ set }) => {
        set.headers['Docker-Distribution-Api-Version'] = 'registry/2.0'
        return {}
      })

      // Get Manifest
      .get(
        '/:namespace/:name/manifests/:reference',
        async ({ params, set }) => {
          const { namespace, name, reference } = params

          set.headers['Docker-Distribution-Api-Version'] = 'registry/2.0'

          // Try DWS first
          const dwsResult = await resolveFromDWS(namespace, name, reference)
          if (dwsResult) {
            set.headers['Content-Type'] = dwsResult.mediaType
            set.headers['Docker-Content-Digest'] = dwsResult.digest
            set.headers['X-DWS-Source'] = 'dws-registry'
            return new Response(dwsResult.manifest)
          }

          // Check if this is a proxyable image
          const fullName =
            namespace === 'library' ? name : `${namespace}/${name}`
          const shouldProxy =
            PROXY_IMAGES.has(name) ||
            PROXY_IMAGES.has(fullName) ||
            namespace === 'library'

          if (shouldProxy) {
            const proxyResult = await proxyManifest(namespace, name, reference)
            if (proxyResult) {
              set.headers['Content-Type'] = proxyResult.mediaType
              set.headers['Docker-Content-Digest'] = proxyResult.digest
              set.headers['X-DWS-Source'] = 'proxy-dockerhub'
              return new Response(proxyResult.manifest)
            }
          }

          set.status = 404
          return {
            errors: [
              {
                code: 'MANIFEST_UNKNOWN',
                message: `manifest unknown: ${namespace}/${name}:${reference}`,
              },
            ],
          }
        },
      )

      // Head Manifest (for existence check)
      .head(
        '/:namespace/:name/manifests/:reference',
        async ({ params, set }) => {
          const { namespace, name, reference } = params

          set.headers['Docker-Distribution-Api-Version'] = 'registry/2.0'

          // Try DWS first
          const dwsResult = await resolveFromDWS(namespace, name, reference)
          if (dwsResult) {
            set.headers['Content-Type'] = dwsResult.mediaType
            set.headers['Docker-Content-Digest'] = dwsResult.digest
            set.headers['Content-Length'] = String(dwsResult.manifest.length)
            return new Response(null, { status: 200 })
          }

          // Check proxy
          const shouldProxy =
            PROXY_IMAGES.has(name) ||
            PROXY_IMAGES.has(`${namespace}/${name}`) ||
            namespace === 'library'

          if (shouldProxy) {
            const proxyResult = await proxyManifest(namespace, name, reference)
            if (proxyResult) {
              set.headers['Content-Type'] = proxyResult.mediaType
              set.headers['Docker-Content-Digest'] = proxyResult.digest
              set.headers['Content-Length'] = String(
                proxyResult.manifest.length,
              )
              return new Response(null, { status: 200 })
            }
          }

          set.status = 404
          return new Response(null)
        },
      )

      // Get Blob
      .get('/:namespace/:name/blobs/:digest', async ({ params, set }) => {
        const { namespace, name, digest } = params

        set.headers['Docker-Distribution-Api-Version'] = 'registry/2.0'

        // Check if digest is a CID (DWS-native)
        if (digest.startsWith('bafy') || digest.startsWith('Qm')) {
          const dwsResult = await serveBlobFromDWS(digest)
          if (dwsResult) {
            set.headers['Content-Type'] = 'application/octet-stream'
            set.headers['Content-Length'] = String(dwsResult.size)
            set.headers['Docker-Content-Digest'] = digest
            set.headers['X-DWS-Source'] = 'dws-storage'
            return new Response(dwsResult.stream)
          }
        }

        // Try DWS blob lookup by digest
        // The digest IS the content hash - check if we have it stored directly
        const blobResult = await serveBlobFromDWS(digest)
        if (blobResult) {
          set.headers['Content-Type'] = 'application/octet-stream'
          set.headers['Content-Length'] = String(blobResult.size)
          set.headers['Docker-Content-Digest'] = digest
          set.headers['X-DWS-Source'] = 'dws-storage'
          return new Response(blobResult.stream)
        }

        // Proxy from upstream
        const shouldProxy =
          PROXY_IMAGES.has(name) ||
          PROXY_IMAGES.has(`${namespace}/${name}`) ||
          namespace === 'library'

        if (shouldProxy) {
          const proxyResult = await proxyBlob(namespace, name, digest)
          if (proxyResult) {
            set.headers['Content-Type'] = 'application/octet-stream'
            set.headers['Content-Length'] = String(proxyResult.size)
            set.headers['Docker-Content-Digest'] = digest
            set.headers['X-DWS-Source'] = 'proxy-dockerhub'
            return new Response(proxyResult.stream)
          }
        }

        set.status = 404
        return {
          errors: [
            {
              code: 'BLOB_UNKNOWN',
              message: `blob unknown: ${digest}`,
            },
          ],
        }
      })

      // Head Blob
      .head('/:namespace/:name/blobs/:digest', async ({ params, set }) => {
        const { digest } = params

        set.headers['Docker-Distribution-Api-Version'] = 'registry/2.0'

        // Similar logic but just check existence
        const cached = blobCache.get(digest)
        if (cached) {
          set.headers['Content-Length'] = String(cached.size)
          set.headers['Docker-Content-Digest'] = digest
          return new Response(null, { status: 200 })
        }

        set.status = 404
        return new Response(null)
      })

      // List Tags
      .get('/:namespace/:name/tags/list', async ({ params, set }) => {
        const { namespace, name } = params

        set.headers['Docker-Distribution-Api-Version'] = 'registry/2.0'

        // Try DWS ContainerRegistry first
        if (CONTAINER_REGISTRY_ADDRESS) {
          const client = getPublicClient()
          let repo: ContainerRepo | null = null
          try {
            repo = (await client.readContract({
              address: CONTAINER_REGISTRY_ADDRESS,
              abi: CONTAINER_REGISTRY_ABI,
              functionName: 'getRepoByName',
              args: [namespace, name],
            })) as ContainerRepo
          } catch (err) {
            console.debug(
              `[OCI] getRepoByName for tags failed: ${err instanceof Error ? err.message : String(err)}`,
            )
          }

          if (repo?.tags && repo.tags.length > 0) {
            return {
              name: `${namespace}/${name}`,
              tags: [...repo.tags],
            }
          }
        }

        // Proxy from Docker Hub for known images
        const shouldProxy =
          PROXY_IMAGES.has(name) ||
          PROXY_IMAGES.has(`${namespace}/${name}`) ||
          namespace === 'library'

        if (shouldProxy) {
          const token = await getDockerHubToken(
            namespace === 'library' ? 'library' : namespace,
            name,
          )
          const fullName =
            namespace === 'library' ? name : `${namespace}/${name}`
          const response = await fetch(
            `https://registry-1.docker.io/v2/${fullName}/tags/list`,
            { headers: { Authorization: `Bearer ${token}` } },
          )
          if (response.ok) {
            const data = (await response.json()) as {
              name: string
              tags: string[]
            }
            return { name: data.name, tags: data.tags }
          }
        }

        set.status = 404
        return {
          errors: [
            {
              code: 'NAME_UNKNOWN',
              message: `repository unknown: ${namespace}/${name}`,
            },
          ],
        }
      })

      // Catalog (list repositories)
      .get('/_catalog', async ({ set }) => {
        set.headers['Docker-Distribution-Api-Version'] = 'registry/2.0'

        // Query ContainerRegistry contract for all repos
        // This requires iterating - for now return empty if no contract
        if (!CONTAINER_REGISTRY_ADDRESS) {
          set.status = 501
          return {
            errors: [
              {
                code: 'UNSUPPORTED',
                message:
                  'Catalog not available without ContainerRegistry contract',
              },
            ],
          }
        }

        // Return empty - full catalog requires enumeration which is expensive
        // Clients should know what repos they want
        return { repositories: [] }
      })

      // Push endpoints - not implemented yet
      // Use build-images-dws.ts script to push images to DWS
      .post('/:namespace/:name/blobs/uploads/', async ({ set }) => {
        set.status = 501
        return {
          errors: [
            {
              code: 'UNSUPPORTED',
              message:
                'Push not implemented. Use build-images-dws.ts --push to upload images.',
            },
          ],
        }
      })

      .put('/:namespace/:name/manifests/:reference', async ({ set }) => {
        set.status = 501
        return {
          errors: [
            {
              code: 'UNSUPPORTED',
              message:
                'Push not implemented. Use build-images-dws.ts --push to upload images.',
            },
          ],
        }
      })
  )
}

export type OCIRegistryRoutes = ReturnType<typeof createOCIRegistryRouter>
