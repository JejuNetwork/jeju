/**
 * Local JNS Gateway
 * Resolves JNS names to IPFS content for local development
 * Falls back to serving from local app build directories
 */

import { existsSync } from 'node:fs'
import { join } from 'node:path'
import type { JNSGatewayConfigBase } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import type { Address, Hex } from 'viem'
import { createPublicClient, http, keccak256, stringToBytes } from 'viem'
import { localnetChain } from './chain'
import { logger } from './logger'

// ABI for JNS contracts
const JNS_REGISTRY_ABI = [
  {
    name: 'resolver',
    type: 'function',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
] as const

const JNS_RESOLVER_ABI = [
  {
    name: 'contenthash',
    type: 'function',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'bytes' }],
    stateMutability: 'view',
  },
  {
    name: 'text',
    type: 'function',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
    ],
    outputs: [{ type: 'string' }],
    stateMutability: 'view',
  },
] as const

interface JNSGatewayConfig extends JNSGatewayConfigBase {
  ipfsGatewayUrl: string
  rootDir: string // Monorepo root for serving local app builds
}

interface ContentResolution {
  name: string
  node: Hex
  contenthash: Hex | null
  ipfsCid: string | null
  workerEndpoint: string | null
}

// Local worker endpoint mappings for vendor apps during development
// Maps app name to local backend URL
const LOCAL_WORKER_ENDPOINTS: Record<string, string> = {
  factory: 'http://localhost:4040',
  bazaar: 'http://localhost:4050',
  gateway: 'http://localhost:4060',
  dws: 'http://localhost:4030',
}

export class LocalJNSGateway {
  private config: JNSGatewayConfig
  private client: ReturnType<typeof createPublicClient>
  private app: ReturnType<LocalJNSGateway['createApp']>
  private cache: Map<string, ContentResolution> = new Map()

  constructor(config: JNSGatewayConfig) {
    this.config = config
    this.client = createPublicClient({
      chain: localnetChain,
      transport: http(config.rpcUrl),
    })
    this.app = this.createApp()
  }

  /**
   * Get local worker endpoint for an app (for development)
   */
  private getLocalWorkerEndpoint(appName: string): string | null {
    return LOCAL_WORKER_ENDPOINTS[appName] ?? null
  }

  private createApp() {
    return (
      new Elysia()
        .get('/health', () => ({ status: 'healthy', service: 'jns-gateway' }))

        // Resolve JNS name to content
        .get('/resolve/:name', async ({ params, set }) => {
          const resolution = await this.resolve(params.name)
          if (!resolution.ipfsCid && !resolution.workerEndpoint) {
            set.status = 404
            return { error: 'Name not found or no content' }
          }
          return resolution
        })

        // Serve content directly
        .get('/*', async ({ request, set }) => {
          const url = new URL(request.url)
          const host = request.headers.get('host') ?? ''

          // Extract name from subdomain (e.g., gateway.local.jejunetwork.org)
          const match = host.match(/^([^.]+)\.local\.jejunetwork\.org/)
          if (!match) {
            // Not a JNS request, pass through
            set.status = 404
            return { error: 'Not a JNS domain' }
          }

          const appName = match[1]
          const name = `${appName}.jeju`
          const resolution = await this.resolve(name)

          // Check for API requests that should be routed to backend
          if (
            url.pathname.startsWith('/api') ||
            url.pathname.startsWith('/health') ||
            url.pathname.startsWith('/a2a') ||
            url.pathname.startsWith('/mcp') ||
            url.pathname.startsWith('/ws')
          ) {
            // For local development, use local worker endpoint if available
            const localEndpoint = this.getLocalWorkerEndpoint(appName)
            if (localEndpoint) {
              return this.proxyToWorker(localEndpoint, request)
            }
            // If JNS has a real worker endpoint (not a tx hash), use it
            if (
              resolution.workerEndpoint &&
              !resolution.workerEndpoint.startsWith('0x')
            ) {
              return this.proxyToWorker(resolution.workerEndpoint, request)
            }
            // No local or JNS worker - return 503 for API requests
            return new Response(
              JSON.stringify({
                error: 'Backend not available',
                message: `No worker endpoint configured for ${appName}`,
              }),
              {
                status: 503,
                headers: { 'Content-Type': 'application/json' },
              },
            )
          }

          if (resolution.ipfsCid) {
            // Serve from IPFS
            return this.serveFromIPFS(resolution.ipfsCid, url.pathname)
          }

          // Fallback: serve from local app build directory (for dev)
          const localResponse = await this.serveFromLocal(appName, url.pathname)
          if (localResponse) {
            return localResponse
          }

          set.status = 404
          return { error: 'Content not found' }
        })
    )
  }

  /**
   * Resolve a JNS name
   */
  async resolve(name: string): Promise<ContentResolution> {
    // Check cache
    const cached = this.cache.get(name)
    if (cached) return cached

    const node = this.namehash(name)

    // Get resolver - catch errors for unregistered names
    let resolverAddress: `0x${string}` | null = null
    try {
      resolverAddress = await this.client.readContract({
        address: this.config.jnsRegistryAddress,
        abi: JNS_REGISTRY_ABI,
        functionName: 'resolver',
        args: [node],
      })
    } catch {
      // Registry call failed - name not registered or contract issue
      logger.debug(
        `JNS resolver lookup failed for ${name}, falling back to local`,
      )
    }

    if (
      !resolverAddress ||
      resolverAddress === '0x0000000000000000000000000000000000000000'
    ) {
      return {
        name,
        node,
        contenthash: null,
        ipfsCid: null,
        workerEndpoint: null,
      }
    }

    // Get contenthash
    let contenthash: Hex | null = null
    let ipfsCid: string | null = null

    try {
      const hash = await this.client.readContract({
        address: resolverAddress,
        abi: JNS_RESOLVER_ABI,
        functionName: 'contenthash',
        args: [node],
      })

      if (hash && hash !== '0x') {
        contenthash = hash as Hex
        ipfsCid = this.decodeContenthash(contenthash)
      }
    } catch {
      // No contenthash set
    }

    // Get worker endpoint
    let workerEndpoint: string | null = null
    try {
      workerEndpoint = await this.client.readContract({
        address: resolverAddress,
        abi: JNS_RESOLVER_ABI,
        functionName: 'text',
        args: [node, 'dws.worker'],
      })
      if (workerEndpoint === '') workerEndpoint = null
    } catch {
      // No worker endpoint set
    }

    const resolution: ContentResolution = {
      name,
      node,
      contenthash,
      ipfsCid,
      workerEndpoint,
    }

    // Cache for 60 seconds
    this.cache.set(name, resolution)
    setTimeout(() => this.cache.delete(name), 60000)

    return resolution
  }

  /**
   * Start the gateway server
   */
  async start(): Promise<void> {
    this.app.listen(this.config.port)
    logger.success(`JNS Gateway running on port ${this.config.port}`)
  }

  /**
   * Stop the gateway server
   */
  stop(): void {
    // Elysia doesn't have a built-in stop method for the simple listen()
    logger.debug('JNS Gateway stopped')
  }

  private namehash(name: string): Hex {
    const labels = name.split('.').reverse()
    let node = `0x${'0'.repeat(64)}`

    for (const label of labels) {
      const labelHash = keccak256(stringToBytes(label))
      node = keccak256(`${node}${labelHash.slice(2)}` as Hex)
    }

    return node as Hex
  }

  private decodeContenthash(hash: Hex): string | null {
    // EIP-1577 contenthash decoding
    if (!hash.startsWith('0xe3')) {
      return null // Not IPFS namespace
    }

    // Remove 0x prefix and e3 namespace byte
    const hexData = hash.slice(4)

    // Check for CIDv1 prefix (01 70 = CIDv1 dag-pb)
    if (hexData.startsWith('0170')) {
      // Extract multihash (after 01 70 prefix)
      const multihashHex = hexData.slice(4)
      const multihash = new Uint8Array(multihashHex.length / 2)
      for (let i = 0; i < multihashHex.length; i += 2) {
        multihash[i / 2] = parseInt(multihashHex.slice(i, i + 2), 16)
      }

      // Base58 encode the multihash to get CIDv0
      return this.base58Encode(multihash)
    }

    // Fallback: try to decode as text
    const bytes = new Uint8Array(hexData.length / 2)
    for (let i = 0; i < hexData.length; i += 2) {
      bytes[i / 2] = parseInt(hexData.slice(i, i + 2), 16)
    }
    return new TextDecoder().decode(bytes)
  }

  private base58Encode(bytes: Uint8Array): string {
    const BASE58_ALPHABET =
      '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'

    // Count leading zeros
    let leadingZeros = 0
    for (const byte of bytes) {
      if (byte === 0) leadingZeros++
      else break
    }

    // Convert bytes to base58
    const digits: number[] = [0]
    for (const byte of bytes) {
      let carry = byte
      for (let i = 0; i < digits.length; i++) {
        const n = digits[i] * 256 + carry
        digits[i] = n % 58
        carry = Math.floor(n / 58)
      }
      while (carry > 0) {
        digits.push(carry % 58)
        carry = Math.floor(carry / 58)
      }
    }

    // Convert to string
    let result = ''
    for (let i = 0; i < leadingZeros; i++) {
      result += '1'
    }
    for (let i = digits.length - 1; i >= 0; i--) {
      result += BASE58_ALPHABET[digits[i]]
    }

    return result
  }

  private async serveFromIPFS(cid: string, path: string): Promise<Response> {
    // Normalize path
    let requestPath = path ?? '/'
    if (requestPath === '/') requestPath = '/index.html'
    if (requestPath.startsWith('/')) requestPath = requestPath.slice(1)

    // Use IPFS API (port 5001) to cat files directly, avoiding gateway subdomain redirects
    const ipfsApiUrl = this.config.ipfsGatewayUrl.replace(':4180', ':5001')

    // Try the exact path first
    let response = await fetch(
      `${ipfsApiUrl}/api/v0/cat?arg=${cid}/${requestPath}`,
      { method: 'POST' },
    )

    // For SPA support: if path not found and not a file with extension, try index.html
    if (!response.ok && !requestPath.includes('.')) {
      response = await fetch(`${ipfsApiUrl}/api/v0/cat?arg=${cid}/index.html`, {
        method: 'POST',
      })
    }

    if (!response.ok) {
      return new Response(`Not found: ${requestPath}`, { status: 404 })
    }

    const content = await response.arrayBuffer()
    const contentType = this.guessContentType(requestPath)

    return new Response(content, {
      headers: {
        'Content-Type': contentType,
        'X-IPFS-CID': cid,
        'X-JNS-Gateway': 'local',
        'Cache-Control': 'public, max-age=31536000, immutable', // Content-addressed = immutable
      },
    })
  }

  /**
   * Serve content from local app build directory (dev fallback)
   */
  private async serveFromLocal(
    appName: string,
    path: string,
  ): Promise<Response | null> {
    // Try to find the app's build directory (check both apps/ and vendor/)
    // Try multiple possible app locations and build directories
    const appDirCandidates = [
      join(this.config.rootDir, 'apps', appName),
      join(this.config.rootDir, 'vendor', appName, 'apps', 'web'), // vendor app structure
      join(this.config.rootDir, 'vendor', appName),
    ]

    // Common build output directories (order matters - more specific first)
    const buildDirs = [
      'dist', // Most common
      'dist/web',
      'dist/client',
      'dist/static',
      'docs/dist',
      'build',
      'out',
      '.next/static',
    ]

    // Normalize path
    let requestPath = path ?? '/'
    if (requestPath === '/') requestPath = 'index.html'
    if (requestPath.startsWith('/')) requestPath = requestPath.slice(1)

    // Try each app dir + build dir combination
    for (const appDir of appDirCandidates) {
      if (!existsSync(appDir)) continue

      for (const buildDir of buildDirs) {
        const fullBuildDir = join(appDir, buildDir)
        if (!existsSync(fullBuildDir)) continue

        // Try exact path
        const filePath = join(fullBuildDir, requestPath)
        if (existsSync(filePath)) {
          const file = Bun.file(filePath)
          const content = await file.arrayBuffer()
          return new Response(content, {
            headers: {
              'Content-Type': this.guessContentType(requestPath),
              'X-Served-From': 'local-dev',
              'X-App-Dir': appDir,
            },
          })
        }

        // For SPA: try index.html for paths without extensions
        if (!requestPath.includes('.')) {
          const indexPath = join(fullBuildDir, 'index.html')
          if (existsSync(indexPath)) {
            const file = Bun.file(indexPath)
            const content = await file.arrayBuffer()
            return new Response(content, {
              headers: {
                'Content-Type': 'text/html; charset=utf-8',
                'X-Served-From': 'local-dev',
                'X-App-Dir': appDir,
              },
            })
          }
        }
      }
    }

    return null
  }

  private guessContentType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase()
    const types: Record<string, string> = {
      html: 'text/html; charset=utf-8',
      css: 'text/css; charset=utf-8',
      js: 'application/javascript; charset=utf-8',
      json: 'application/json; charset=utf-8',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      woff: 'font/woff',
      woff2: 'font/woff2',
      ttf: 'font/ttf',
      ico: 'image/x-icon',
    }
    return types[ext ?? ''] ?? 'application/octet-stream'
  }

  private async proxyToWorker(
    endpoint: string,
    request: Request,
  ): Promise<Response> {
    const url = new URL(request.url)
    const workerUrl = `${endpoint}${url.pathname}${url.search}`

    const response = await fetch(workerUrl, {
      method: request.method,
      headers: request.headers,
      body: request.method !== 'GET' ? await request.text() : undefined,
    })

    return new Response(response.body, {
      status: response.status,
      headers: {
        ...Object.fromEntries(response.headers),
        'X-DWS-Worker': endpoint,
        'X-JNS-Gateway': 'local',
      },
    })
  }
}

/**
 * Create and start the local JNS gateway
 */
export async function startLocalJNSGateway(
  rpcUrl: string,
  jnsRegistryAddress: Address,
  port = 8080,
  ipfsGatewayPort = 4180, // Default IPFS gateway port from Docker (mapped 8080 -> 4180)
  rootDir = process.cwd(), // Monorepo root for local dev fallback
): Promise<LocalJNSGateway> {
  const gateway = new LocalJNSGateway({
    port,
    rpcUrl,
    jnsRegistryAddress,
    ipfsGatewayUrl: `http://localhost:${ipfsGatewayPort}`,
    rootDir,
  })

  await gateway.start()
  return gateway
}
