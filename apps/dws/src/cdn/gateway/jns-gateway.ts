/**
 * JNS Gateway
 *
 * Resolves JNS names to content hashes and serves content.
 * Similar to eth.link / eth.limo for ENS, but for JNS.
 *
 * URL patterns:
 * - myapp.jns.jejunetwork.org -> Resolve myapp.jns to contenthash
 * - ipfs.jejunetwork.org/ipfs/CID -> Direct IPFS access
 * - storage.jejunetwork.org/api/... -> Storage API
 */

import { cors } from '@elysiajs/cors'
import { Elysia } from 'elysia'
import {
  type Address,
  createPublicClient,
  http,
  keccak256,
  type PublicClient,
  parseAbi,
  stringToBytes,
} from 'viem'
import { base, baseSepolia, localhost } from 'viem/chains'
import { type EdgeCache, getEdgeCache } from '../cache/edge-cache'
import { getOriginFetcher, type OriginFetcher } from '../cache/origin-fetcher'

function inferChainFromRpcUrl(rpcUrl: string) {
  if (rpcUrl.includes('base-sepolia') || rpcUrl.includes('84532')) {
    return baseSepolia
  }
  if (rpcUrl.includes('base') && !rpcUrl.includes('localhost')) {
    return base
  }
  return localhost
}

// ============================================================================
// Types
// ============================================================================

export interface JNSGatewayConfig {
  port: number
  rpcUrl: string
  jnsRegistryAddress: Address
  jnsResolverAddress: Address
  ipfsGateway: string
  arweaveGateway: string
  domain: string // e.g., "jejunetwork.org"
}

interface ContentHash {
  protocol: 'ipfs' | 'ipns' | 'arweave' | 'http' | 'https'
  hash: string
}

// ============================================================================
// ABI
// ============================================================================

const JNS_REGISTRY_ABI = parseAbi([
  'function resolver(bytes32 node) view returns (address)',
  'function owner(bytes32 node) view returns (address)',
])

const JNS_RESOLVER_ABI = parseAbi([
  'function contenthash(bytes32 node) view returns (bytes)',
  'function text(bytes32 node, string key) view returns (string)',
  'function addr(bytes32 node) view returns (address)',
])

// ============================================================================
// JNS Gateway
// ============================================================================

export class JNSGateway {
  private app: Elysia
  private config: JNSGatewayConfig
  private cache: EdgeCache
  private originFetcher: OriginFetcher
  private publicClient!: PublicClient
  private registryAddress: Address
  private defaultResolverAddress: Address

  // Content hash cache (JNS name -> content hash)
  private contentHashCache: Map<
    string,
    { hash: ContentHash; expiresAt: number }
  > = new Map()

  constructor(config: JNSGatewayConfig) {
    this.config = config
    this.app = new Elysia()
    this.cache = getEdgeCache()
    this.originFetcher = getOriginFetcher([
      {
        name: 'ipfs',
        type: 'ipfs',
        endpoint: config.ipfsGateway,
        timeout: 30000,
        retries: 2,
      },
      {
        name: 'arweave',
        type: 'arweave',
        endpoint: config.arweaveGateway,
        timeout: 30000,
        retries: 2,
      },
    ])

    const chain = inferChainFromRpcUrl(config.rpcUrl)
    this.publicClient = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    }) as PublicClient
    this.registryAddress = config.jnsRegistryAddress
    this.defaultResolverAddress = config.jnsResolverAddress

    this.setupRoutes()
  }

  // ============================================================================
  // Routes
  // ============================================================================

  private setupRoutes(): void {
    this.app.use(cors({ origin: '*' }))

    // Health check
    this.app.get('/health', () => {
      return { status: 'healthy', service: 'jns-gateway' }
    })

    // Direct IPFS access: /ipfs/CID/path
    this.app.get('/ipfs/:cid/*', async ({ params, path, set }) => {
      const cid = params.cid
      const subpath = path.replace(`/ipfs/${cid}`, '') || '/'
      return this.serveIPFS(cid, subpath, set)
    })

    // Direct IPNS access: /ipns/name/path
    this.app.get('/ipns/:name/*', async ({ params, path, set }) => {
      const name = params.name
      const subpath = path.replace(`/ipns/${name}`, '') || '/'
      return this.serveIPNS(name, subpath, set)
    })

    // JNS resolution: /jns/name/path
    this.app.get('/jns/:name/*', async ({ params, path, set }) => {
      const name = params.name
      const subpath = path.replace(`/jns/${name}`, '') || '/'
      return this.serveJNS(name, subpath, set)
    })

    // Resolve endpoint
    this.app.get('/resolve/:name', async ({ params, set }) => {
      const name = params.name
      const fullName = name.endsWith('.jns') ? name : `${name}.jns`

      const contentHash = await this.resolveJNS(fullName)
      if (!contentHash) {
        set.status = 404
        return { error: 'Name not found' }
      }

      return {
        name: fullName,
        contentHash: {
          protocol: contentHash.protocol,
          hash: contentHash.hash,
        },
        resolvedAt: Date.now(),
      }
    })

    // Wildcard subdomain handling (for *.jns.jejunetwork.org)
    this.app.get('/*', async ({ request, path, set }) => {
      const host = request.headers.get('host') ?? ''

      // Check if this is a JNS subdomain request
      // e.g., myapp.jns.jejunetwork.org
      const jnsMatch = host.match(/^([^.]+)\.jns\./)
      if (jnsMatch?.[1]) {
        const name = `${jnsMatch[1]}.jns`
        return this.serveJNS(name, path, set)
      }

      // Default 404
      set.status = 404
      return 'Not Found'
    })
  }

  // ============================================================================
  // JNS Resolution
  // ============================================================================

  /**
   * Resolve JNS name to content hash
   */
  async resolveJNS(name: string): Promise<ContentHash | null> {
    // Check cache first
    const cached = this.contentHashCache.get(name)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.hash
    }

    // Compute namehash
    const node = this.namehash(name)

    // Get resolver
    const resolverAddress = await this.publicClient
      .readContract({
        address: this.registryAddress,
        abi: JNS_REGISTRY_ABI,
        functionName: 'resolver',
        args: [node as `0x${string}`],
      })
      .catch((err: Error) => {
        console.warn(
          `[JNS Gateway] Failed to get resolver for ${name}: ${err.message}`,
        )
        return null as Address | null
      })

    const resolverAddr =
      resolverAddress &&
      resolverAddress !== '0x0000000000000000000000000000000000000000'
        ? resolverAddress
        : this.defaultResolverAddress

    // Get content hash
    const contenthashBytes = await this.publicClient
      .readContract({
        address: resolverAddr,
        abi: JNS_RESOLVER_ABI,
        functionName: 'contenthash',
        args: [node as `0x${string}`],
      })
      .catch((err: Error) => {
        console.warn(
          `[JNS Gateway] Failed to get contenthash for ${name}: ${err.message}`,
        )
        return null as `0x${string}` | null
      })

    if (!contenthashBytes || contenthashBytes === '0x') {
      return null
    }

    const contentHash = this.decodeContentHash(contenthashBytes)

    if (contentHash) {
      // Cache for 5 minutes
      this.contentHashCache.set(name, {
        hash: contentHash,
        expiresAt: Date.now() + 300000,
      })
    }

    return contentHash
  }

  /**
   * Compute namehash for JNS name
   */
  private namehash(name: string): string {
    // Standard ENS namehash algorithm
    let node =
      '0x0000000000000000000000000000000000000000000000000000000000000000'

    if (name) {
      const labels = name.split('.').reverse()
      for (const label of labels) {
        const labelHash = this.keccak256(label)
        node = this.keccak256Buffer(
          Buffer.concat([
            Buffer.from(node.slice(2), 'hex'),
            Buffer.from(labelHash.slice(2), 'hex'),
          ]),
        )
      }
    }

    return node
  }

  private keccak256(str: string): string {
    return keccak256(stringToBytes(str))
  }

  private keccak256Buffer(buf: Buffer): string {
    return keccak256(`0x${buf.toString('hex')}` as `0x${string}`)
  }

  /**
   * Decode content hash bytes to protocol + hash
   */
  private decodeContentHash(bytes: string): ContentHash | null {
    // Content hash format: https://eips.ethereum.org/EIPS/eip-1577
    // IPFS: 0xe3... (CIDv0/v1)
    // IPNS: 0xe5...
    // Swarm: 0xe4...

    if (!bytes || bytes.length < 6) {
      return null
    }

    const codec = bytes.slice(0, 6)
    const data = bytes.slice(6)

    // IPFS (0xe3 = ipfs-ns)
    if (codec === '0xe3010170' || codec === '0xe3010172') {
      // CIDv0 or CIDv1
      const cid = this.bytesToMultihash(data)
      return { protocol: 'ipfs', hash: cid }
    }

    // IPNS (0xe5 = ipns-ns)
    if (codec === '0xe5010172') {
      const name = this.bytesToMultihash(data)
      return { protocol: 'ipns', hash: name }
    }

    // Fallback: try to decode as raw IPFS CID
    if (bytes.startsWith('0x')) {
      const cid = Buffer.from(bytes.slice(2), 'hex').toString()
      if (cid.startsWith('Qm') || cid.startsWith('bafy')) {
        return { protocol: 'ipfs', hash: cid }
      }
    }

    return null
  }

  private bytesToMultihash(hex: string): string {
    // Convert hex to base58 multihash (CID)
    // Simplified - in production use proper multibase/multicodec libraries
    const bytes = Buffer.from(hex, 'hex')
    return this.base58Encode(bytes)
  }

  private base58Encode(buffer: Buffer): string {
    const ALPHABET =
      '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    let num = BigInt(`0x${buffer.toString('hex')}`)
    let result = ''

    while (num > 0n) {
      const remainder = Number(num % 58n)
      num = num / 58n
      result = ALPHABET[remainder] + result
    }

    // Handle leading zeros
    for (const byte of buffer) {
      if (byte === 0) {
        result = `1${result}`
      } else {
        break
      }
    }

    return result
  }

  // ============================================================================
  // Content Serving
  // ============================================================================

  /**
   * Serve content from IPFS
   */
  private async serveIPFS(
    cid: string,
    path: string,
    set: { status?: number | string },
  ): Promise<Response | { error: string }> {
    const fullPath = `/ipfs/${cid}${path}`

    // Try cache first
    const { entry, status } = this.cache.get(fullPath)
    if (entry && status === 'HIT') {
      return this.buildResponse(entry.data, entry.metadata.headers, 200, status)
    }

    // Fetch from IPFS gateway
    const result = await this.originFetcher.fetch(fullPath, 'ipfs')

    if (!result.success) {
      set.status = result.status || 502
      const errorMsg: string = result.error || 'Unknown error'
      return { error: errorMsg }
    }

    // Cache immutable IPFS content
    this.cache.set(fullPath, result.body, {
      contentType: result.headers['content-type'],
      headers: result.headers,
      origin: 'ipfs',
      immutable: true, // IPFS CIDs are immutable
    })

    return this.buildResponse(result.body, result.headers, 200, 'MISS')
  }

  /**
   * Serve content from IPNS
   */
  private async serveIPNS(
    name: string,
    path: string,
    set: { status?: number | string },
  ): Promise<Response | { error: string }> {
    const fullPath = `/ipns/${name}${path}`

    // Shorter cache for IPNS (can change)
    const { entry, status } = this.cache.get(fullPath)
    if (entry && status === 'HIT') {
      return this.buildResponse(entry.data, entry.metadata.headers, 200, status)
    }

    const result = await this.originFetcher.fetch(fullPath, 'ipfs')

    if (!result.success) {
      set.status = result.status || 502
      const errorMsg: string = result.error || 'Unknown error'
      return { error: errorMsg }
    }

    // Cache IPNS content with shorter TTL
    this.cache.set(fullPath, result.body, {
      contentType: result.headers['content-type'],
      headers: result.headers,
      cacheControl: 'public, max-age=300', // 5 minutes
      origin: 'ipns',
      immutable: false,
    })

    return this.buildResponse(result.body, result.headers, 200, 'MISS')
  }

  /**
   * Serve content from JNS name
   */
  private async serveJNS(
    name: string,
    path: string,
    set: { status?: number | string },
  ): Promise<Response | { error: string }> {
    // Resolve JNS name to content hash
    const fullName = name.endsWith('.jns') ? name : `${name}.jns`
    const contentHash = await this.resolveJNS(fullName)

    if (!contentHash) {
      set.status = 404
      return { error: `JNS name not found: ${fullName}` }
    }

    // Serve based on protocol
    switch (contentHash.protocol) {
      case 'ipfs':
        return this.serveIPFS(contentHash.hash, path, set)
      case 'ipns':
        return this.serveIPNS(contentHash.hash, path, set)
      case 'arweave':
        return this.serveArweave(contentHash.hash, path, set)
      default:
        set.status = 400
        return { error: `Unsupported protocol: ${contentHash.protocol}` }
    }
  }

  /**
   * Serve content from Arweave
   */
  private async serveArweave(
    txId: string,
    path: string,
    set: { status?: number | string },
  ): Promise<Response | { error: string }> {
    const fullPath = `/${txId}${path}`

    const { entry, status } = this.cache.get(fullPath)
    if (entry && status === 'HIT') {
      return this.buildResponse(entry.data, entry.metadata.headers, 200, status)
    }

    const result = await this.originFetcher.fetch(fullPath, 'arweave')

    if (!result.success) {
      set.status = result.status || 502
      const errorMsg: string = result.error || 'Unknown error'
      return { error: errorMsg }
    }

    // Arweave is permanent
    this.cache.set(fullPath, result.body, {
      contentType: result.headers['content-type'],
      headers: result.headers,
      origin: 'arweave',
      immutable: true,
    })

    return this.buildResponse(result.body, result.headers, 200, 'MISS')
  }

  /**
   * Build response with CDN headers
   */
  private buildResponse(
    body: Buffer,
    headers: Record<string, string>,
    status: number,
    cacheStatus: string,
  ): Response {
    return new Response(new Uint8Array(body), {
      status,
      headers: {
        ...headers,
        'X-Cache': cacheStatus,
        'X-Served-By': 'jns-gateway',
        'Access-Control-Allow-Origin': '*',
      },
    })
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  start(): void {
    console.log(`
╔═══════════════════════════════════════════════════════════════╗
║                    JNS Gateway                                 ║
║              JNS Name Resolution + Content Serving             ║
╠═══════════════════════════════════════════════════════════════╣
║  Port:          ${this.config.port.toString().padEnd(42)}   ║
║  Domain:        ${this.config.domain.padEnd(42)}   ║
║  IPFS Gateway:  ${this.config.ipfsGateway.slice(0, 42).padEnd(42)}   ║
╚═══════════════════════════════════════════════════════════════╝
`)

    this.app.listen(this.config.port)

    console.log(`[JNS Gateway] Listening on port ${this.config.port}`)
  }

  getApp(): Elysia {
    return this.app
  }
}

// ============================================================================
// Factory
// ============================================================================

export async function startJNSGateway(): Promise<JNSGateway> {
  const config: JNSGatewayConfig = {
    port: parseInt(process.env.JNS_GATEWAY_PORT ?? '4022', 10),
    rpcUrl: process.env.RPC_URL ?? 'http://localhost:6546',
    jnsRegistryAddress: (process.env.JNS_REGISTRY_ADDRESS ??
      '0x0000000000000000000000000000000000000000') as Address,
    jnsResolverAddress: (process.env.JNS_RESOLVER_ADDRESS ??
      '0x0000000000000000000000000000000000000000') as Address,
    ipfsGateway: process.env.IPFS_GATEWAY_URL ?? 'https://ipfs.io',
    arweaveGateway: process.env.ARWEAVE_GATEWAY_URL ?? 'https://arweave.net',
    domain: process.env.JNS_DOMAIN ?? 'jejunetwork.org',
  }

  const gateway = new JNSGateway(config)
  gateway.start()
  return gateway
}

// CLI entry point
if (import.meta.main) {
  startJNSGateway().catch(console.error)
}
