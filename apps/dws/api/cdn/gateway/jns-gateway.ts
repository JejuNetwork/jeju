/**
 * JNS Gateway
 * Resolves JNS names to content hashes and serves content from IPFS/Arweave
 */

import { Elysia } from 'elysia'
import {
  createPublicClient,
  type Hex,
  http,
  namehash,
  type PublicClient,
} from 'viem'
import { mainnet } from 'viem/chains'
import type { JNSGatewayConfig } from '../../../lib/types'

export type { JNSGatewayConfig }

// ABI for JNS Resolver contenthash function
const JNS_RESOLVER_ABI = [
  {
    name: 'contenthash',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bytes' }],
  },
  {
    name: 'text',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'node', type: 'bytes32' },
      { name: 'key', type: 'string' },
    ],
    outputs: [{ name: '', type: 'string' }],
  },
] as const

// JNSGatewayConfig imported from lib/types above

export interface ContentHash {
  protocol: 'ipfs' | 'ipns' | 'arweave' | 'http' | 'https'
  hash: string
}

export class JNSGateway {
  private config: JNSGatewayConfig
  private client: PublicClient
  private app!: ReturnType<JNSGateway['createApp']>
  private contentHashCache = new Map<
    string,
    { hash: ContentHash | null; expiresAt: number }
  >()

  constructor(config: JNSGatewayConfig) {
    this.config = config
    this.client = createPublicClient({
      chain: mainnet,
      transport: http(config.rpcUrl),
    })
    this.app = this.createApp()
  }

  /**
   * Decode contenthash bytes to protocol and hash
   * Supports IPFS (0xe3), IPNS (0xe5), Arweave (custom), and Swarm (0xe4)
   */
  private decodeContenthash(contenthash: Hex): ContentHash | null {
    if (!contenthash || contenthash === '0x' || contenthash.length < 6) {
      return null
    }

    const bytes = Buffer.from(contenthash.slice(2), 'hex')

    // IPFS: starts with 0xe3 0x01 (ipfs-ns, protobuf)
    if (bytes[0] === 0xe3 && bytes[1] === 0x01) {
      // Skip namespace (0xe3) and codec indicator (0x01)
      // Next byte is codec: 0x70 = dag-pb, 0x71 = dag-cbor, 0x72 = raw
      const codec = bytes[2]
      let hashStart = 3

      // Handle different IPFS CID versions
      if (codec === 0x70 || codec === 0x55) {
        // dag-pb or raw codec
        hashStart = 3
      }

      // Rest is the multihash
      const multihash = bytes.slice(hashStart)
      const cid = this.base58Encode(
        Buffer.concat([Buffer.from([0x12, 0x20]), multihash]),
      )

      return { protocol: 'ipfs', hash: cid }
    }

    // IPNS: starts with 0xe5
    if (bytes[0] === 0xe5) {
      const multihash = bytes.slice(2)
      return { protocol: 'ipns', hash: this.base58Encode(multihash) }
    }

    // Arweave: custom encoding starting with 0x90 (arbitrary choice)
    if (bytes[0] === 0x90) {
      const hash = bytes.slice(1).toString('utf8')
      return { protocol: 'arweave', hash }
    }

    return null
  }

  /**
   * Base58 encode for IPFS CID
   */
  private base58Encode(bytes: Buffer): string {
    const ALPHABET =
      '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz'
    let result = ''
    let num = BigInt(`0x${bytes.toString('hex')}`)

    while (num > 0n) {
      const remainder = Number(num % 58n)
      num = num / 58n
      result = ALPHABET[remainder] + result
    }

    // Handle leading zeros
    for (const byte of bytes) {
      if (byte === 0) result = `1${result}`
      else break
    }

    return result
  }

  /**
   * Resolve a JNS name to its content hash
   */
  async resolveJNS(name: string): Promise<ContentHash | null> {
    const normalized = name.toLowerCase().replace(/\.jns$/, '')
    const node = namehash(normalized) as Hex

    // Check cache (5 minute TTL)
    const cached = this.contentHashCache.get(normalized)
    if (cached && cached.expiresAt > Date.now()) {
      return cached.hash
    }

    try {
      const contenthash = (await this.client.readContract({
        address: this.config.jnsResolverAddress,
        abi: JNS_RESOLVER_ABI,
        functionName: 'contenthash',
        args: [node],
      })) as Hex

      const decoded = this.decodeContenthash(contenthash)

      // Cache result
      this.contentHashCache.set(normalized, {
        hash: decoded,
        expiresAt: Date.now() + 5 * 60 * 1000,
      })

      return decoded
    } catch (error) {
      console.error(`Failed to resolve JNS ${name}:`, error)
      return null
    }
  }

  /**
   * Resolve a text record from JNS
   */
  async resolveText(name: string, key: string): Promise<string | null> {
    const normalized = name.toLowerCase().replace(/\.jns$/, '')
    const node = namehash(normalized) as Hex

    try {
      const text = await this.client.readContract({
        address: this.config.jnsResolverAddress,
        abi: JNS_RESOLVER_ABI,
        functionName: 'text',
        args: [node, key],
      })

      return text || null
    } catch {
      return null
    }
  }

  /**
   * Fetch content from IPFS
   */
  private async fetchIPFS(cid: string, path: string): Promise<Response> {
    // Use IPFS API for reliable retrieval
    const ipfsApiUrl = process.env.IPFS_API_URL || 'http://localhost:5001'
    const fullPath = path === '/' ? '' : path

    try {
      // Try API first
      const apiUrl = `${ipfsApiUrl}/api/v0/cat?arg=${cid}${fullPath}`
      const response = await fetch(apiUrl, { method: 'POST' })

      if (response.ok) {
        const contentType = this.getContentType(path)
        return new Response(response.body, {
          headers: {
            'Content-Type': contentType,
            'Cache-Control': 'public, max-age=31536000, immutable',
            'X-Content-Source': 'ipfs-api',
          },
        })
      }

      // Fallback to gateway
      const gatewayUrl = `${this.config.ipfsGateway}/ipfs/${cid}${fullPath}`
      const gatewayResponse = await fetch(gatewayUrl)

      if (!gatewayResponse.ok) {
        return new Response('Content not found', { status: 404 })
      }

      return new Response(gatewayResponse.body, {
        headers: {
          'Content-Type':
            gatewayResponse.headers.get('Content-Type') ||
            this.getContentType(path),
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Content-Source': 'ipfs-gateway',
        },
      })
    } catch (error) {
      console.error(`IPFS fetch error for ${cid}${path}:`, error)
      return new Response('Failed to fetch content', { status: 502 })
    }
  }

  /**
   * Fetch content from Arweave
   */
  private async fetchArweave(txId: string, path: string): Promise<Response> {
    const url =
      path === '/'
        ? `${this.config.arweaveGateway}/${txId}`
        : `${this.config.arweaveGateway}/${txId}${path}`

    try {
      const response = await fetch(url)
      if (!response.ok) {
        return new Response('Content not found', { status: 404 })
      }

      return new Response(response.body, {
        headers: {
          'Content-Type':
            response.headers.get('Content-Type') || this.getContentType(path),
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Content-Source': 'arweave',
        },
      })
    } catch (error) {
      console.error(`Arweave fetch error for ${txId}${path}:`, error)
      return new Response('Failed to fetch content', { status: 502 })
    }
  }

  /**
   * Get content type from path extension
   */
  private getContentType(path: string): string {
    const ext = path.split('.').pop()?.toLowerCase()
    const types: Record<string, string> = {
      html: 'text/html',
      css: 'text/css',
      js: 'application/javascript',
      json: 'application/json',
      png: 'image/png',
      jpg: 'image/jpeg',
      jpeg: 'image/jpeg',
      gif: 'image/gif',
      svg: 'image/svg+xml',
      webp: 'image/webp',
      ico: 'image/x-icon',
      woff: 'font/woff',
      woff2: 'font/woff2',
      ttf: 'font/ttf',
      eot: 'application/vnd.ms-fontobject',
      mp4: 'video/mp4',
      webm: 'video/webm',
      mp3: 'audio/mpeg',
      wav: 'audio/wav',
      pdf: 'application/pdf',
      xml: 'application/xml',
      txt: 'text/plain',
    }
    return types[ext ?? ''] ?? 'text/html' // Default to HTML for SPA routing
  }

  /**
   * Create the Elysia app for handling JNS requests
   */
  private createApp() {
    return new Elysia()
      .get('/jns/:name', async ({ params, set }) => {
        const { name } = params
        const contentHash = await this.resolveJNS(name)

        if (!contentHash) {
          set.status = 404
          return { error: `No content found for ${name}` }
        }

        return { name, contentHash }
      })
      .get('/jns/:name/*', async ({ params, request }) => {
        const { name } = params
        const url = new URL(request.url)
        const pathMatch = url.pathname.match(/\/jns\/[^/]+(.*)/)
        const path = pathMatch?.[1] ?? '/'

        const contentHash = await this.resolveJNS(name)
        if (!contentHash) {
          return new Response(`No content found for ${name}`, { status: 404 })
        }

        if (contentHash.protocol === 'ipfs') {
          return this.fetchIPFS(contentHash.hash, path)
        } else if (contentHash.protocol === 'arweave') {
          return this.fetchArweave(contentHash.hash, path)
        } else if (contentHash.protocol === 'ipns') {
          // For IPNS, resolve through gateway
          const response = await fetch(
            `${this.config.ipfsGateway}/ipns/${contentHash.hash}${path}`,
          )
          return response
        }

        return new Response('Unsupported protocol', { status: 400 })
      })
  }

  /**
   * Get the Elysia app instance
   */
  getApp() {
    return this.app
  }

  /**
   * Handle an incoming request
   */
  async handleRequest(request: Request): Promise<Response> {
    return this.app.fetch(request)
  }
}
