/**
 * DNS Gateway
 *
 * eth.link-compatible gateway for JNS domain resolution.
 * Handles requests like: app.jeju.link -> IPFS content for app.jeju
 *
 * Resolution flow:
 * 1. Extract JNS name from subdomain
 * 2. Resolve content hash from JNS Registry
 * 3. Fetch content from IPFS/CDN
 * 4. Return with proper caching headers
 */

import type { Address, Hex } from 'viem'
import { createPublicClient, http, namehash } from 'viem'

// Configuration
export interface DNSGatewayConfig {
  rpcUrl: string
  jnsRegistryAddress: Address
  jnsResolverAddress: Address
  gatewayDomain: string // e.g., "jeju.link"
  ipfsGatewayUrl: string
  cacheEnabled: boolean
  cacheTtl: number
}

// Resolution result
interface ResolutionResult {
  name: string
  contentHash: string | null
  address: Address | null
  appEndpoint: string | null
  ttl: number
}

// Contract ABIs
const JNS_REGISTRY_ABI = [
  {
    name: 'resolver',
    type: 'function',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
    stateMutability: 'view',
  },
  {
    name: 'recordExists',
    type: 'function',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'bool' }],
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
    name: 'addr',
    type: 'function',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ type: 'address' }],
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

/**
 * DNS Gateway for JNS resolution
 */
export class DNSGateway {
  private config: DNSGatewayConfig
  private publicClient
  private cache: Map<string, { result: ResolutionResult; expiresAt: number }> =
    new Map()

  constructor(config: DNSGatewayConfig) {
    this.config = config
    this.publicClient = createPublicClient({
      transport: http(config.rpcUrl),
    })
  }

  /**
   * Handle incoming HTTP request to the gateway
   */
  async handleRequest(request: Request): Promise<Response> {
    const url = new URL(request.url)
    const host = request.headers.get('host') ?? url.host

    // Extract JNS name from host
    // Format: name.jeju.link -> name.jeju
    const jnsName = this.extractJNSName(host)
    if (!jnsName) {
      return new Response('Invalid JNS name', { status: 400 })
    }

    // Resolve the JNS name
    const resolution = await this.resolve(jnsName)
    if (!resolution) {
      return new Response(`JNS name not found: ${jnsName}`, { status: 404 })
    }

    // If this is a DNS-over-HTTPS query, handle it
    if (url.pathname === '/dns-query' || url.searchParams.has('dns')) {
      return this.handleDoHQuery(request, jnsName, resolution)
    }

    // If there's an app endpoint, proxy to it
    if (resolution.appEndpoint) {
      return this.proxyToEndpoint(request, resolution.appEndpoint, url.pathname)
    }

    // If there's a content hash, fetch from IPFS
    if (resolution.contentHash) {
      return this.fetchFromIPFS(resolution.contentHash, url.pathname)
    }

    // If there's just an address, return info page
    if (resolution.address) {
      return this.returnAddressInfo(jnsName, resolution)
    }

    return new Response('No content configured for this name', { status: 404 })
  }

  /**
   * Extract JNS name from hostname
   */
  private extractJNSName(host: string): string | null {
    // Handle: app.jeju.link -> app.jeju
    // Handle: sub.app.jeju.link -> sub.app.jeju
    const gatewayDomain = this.config.gatewayDomain.toLowerCase()

    if (
      !host.toLowerCase().endsWith(`.${gatewayDomain}`) &&
      host.toLowerCase() !== gatewayDomain
    ) {
      return null
    }

    // Remove gateway domain
    let name = host.slice(0, -gatewayDomain.length - 1)

    // Add .jeju TLD if not present
    if (!name.includes('.') || !name.endsWith('.jeju')) {
      name = `${name}.jeju`
    }

    return name.toLowerCase()
  }

  /**
   * Resolve JNS name to content
   */
  async resolve(name: string): Promise<ResolutionResult | null> {
    // Check cache
    const cached = this.cache.get(name)
    if (cached && Date.now() < cached.expiresAt) {
      return cached.result
    }

    const node = namehash(name)

    // Check if record exists
    const exists = await this.publicClient
      .readContract({
        address: this.config.jnsRegistryAddress,
        abi: JNS_REGISTRY_ABI,
        functionName: 'recordExists',
        args: [node],
      })
      .catch(() => false)

    if (!exists) return null

    // Get resolver
    const resolverAddr = await this.publicClient
      .readContract({
        address: this.config.jnsRegistryAddress,
        abi: JNS_REGISTRY_ABI,
        functionName: 'resolver',
        args: [node],
      })
      .catch(() => null)

    const resolver = (resolverAddr || this.config.jnsResolverAddress) as Address

    // Resolve content hash
    const contentHashBytes = await this.publicClient
      .readContract({
        address: resolver,
        abi: JNS_RESOLVER_ABI,
        functionName: 'contenthash',
        args: [node],
      })
      .catch(() => null)

    const contentHash = contentHashBytes
      ? this.decodeContentHash(contentHashBytes as Hex)
      : null

    // Resolve address
    const address = await this.publicClient
      .readContract({
        address: resolver,
        abi: JNS_RESOLVER_ABI,
        functionName: 'addr',
        args: [node],
      })
      .catch(() => null)

    // Resolve app endpoint
    const appEndpoint = await this.publicClient
      .readContract({
        address: resolver,
        abi: JNS_RESOLVER_ABI,
        functionName: 'text',
        args: [node, 'app.endpoint'],
      })
      .catch(() => null)

    const result: ResolutionResult = {
      name,
      contentHash,
      address:
        address && address !== '0x0000000000000000000000000000000000000000'
          ? address
          : null,
      appEndpoint: appEndpoint ?? null,
      ttl: this.config.cacheTtl,
    }

    // Cache result
    if (this.config.cacheEnabled) {
      this.cache.set(name, {
        result,
        expiresAt: Date.now() + this.config.cacheTtl * 1000,
      })
    }

    return result
  }

  /**
   * Decode content hash from bytes
   */
  private decodeContentHash(bytes: Hex): string | null {
    if (!bytes || bytes === '0x' || bytes.length < 6) {
      return null
    }

    // IPFS CIDv1: 0xe3010170 or 0xe5010172 prefix
    if (bytes.startsWith('0xe3010170') || bytes.startsWith('0xe5010172')) {
      const hashBytes = bytes.slice(10)
      // Convert to base58 CID
      return `ipfs://${this.hexToBase58(hashBytes)}`
    }

    // Swarm: 0xe4010170 prefix
    if (bytes.startsWith('0xe4010170')) {
      const hashBytes = bytes.slice(10)
      return `bzz://${hashBytes.slice(2)}`
    }

    // Legacy IPFS (CIDv0): starts with 0x1220
    if (bytes.startsWith('0x1220')) {
      return `ipfs://Qm${this.hexToBase58(bytes.slice(2))}`
    }

    return null
  }

  /**
   * Convert hex to base58 (simplified)
   */
  private hexToBase58(hex: string): string {
    // Note: Full implementation would use proper base58 encoding
    // For now, return hex for compatibility
    return hex.replace(/^0x/, '')
  }

  /**
   * Fetch content from IPFS
   */
  private async fetchFromIPFS(
    contentHash: string,
    path: string,
  ): Promise<Response> {
    // Convert ipfs:// to gateway URL
    let ipfsPath = contentHash.replace('ipfs://', '')

    // Append path
    if (path && path !== '/') {
      ipfsPath = `${ipfsPath}${path}`
    } else {
      // Default to index.html for root
      ipfsPath = `${ipfsPath}/index.html`
    }

    const ipfsUrl = `${this.config.ipfsGatewayUrl}/ipfs/${ipfsPath}`

    const response = await fetch(ipfsUrl, {
      headers: {
        Accept: '*/*',
      },
    }).catch((err: Error) => {
      console.error(`[Gateway] IPFS fetch error: ${err.message}`)
      return null
    })

    if (!response?.ok) {
      return new Response('Content not found', { status: 404 })
    }

    // Return with proper headers
    const contentType =
      response.headers.get('content-type') ?? 'application/octet-stream'
    const body = await response.arrayBuffer()

    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Cache-Control': `public, max-age=${this.config.cacheTtl}`,
        'X-Content-Source': 'ipfs',
        'X-IPFS-Path': `/ipfs/${ipfsPath}`,
      },
    })
  }

  /**
   * Proxy request to app endpoint
   */
  private async proxyToEndpoint(
    request: Request,
    endpoint: string,
    path: string,
  ): Promise<Response> {
    const targetUrl = new URL(path, endpoint)

    // Copy original headers
    const headers = new Headers(request.headers)
    headers.delete('host')

    const response = await fetch(targetUrl.toString(), {
      method: request.method,
      headers,
      body: request.body,
      redirect: 'manual',
    }).catch((err: Error) => {
      console.error(`[Gateway] Proxy error: ${err.message}`)
      return null
    })

    if (!response) {
      return new Response('Upstream unavailable', { status: 502 })
    }

    // Return proxied response
    return new Response(response.body, {
      status: response.status,
      headers: response.headers,
    })
  }

  /**
   * Return address info page
   */
  private returnAddressInfo(
    name: string,
    resolution: ResolutionResult,
  ): Response {
    const html = `<!DOCTYPE html>
<html>
<head>
  <title>${name}</title>
  <style>
    body { font-family: system-ui; max-width: 600px; margin: 50px auto; padding: 20px; }
    h1 { color: #333; }
    .address { font-family: monospace; background: #f5f5f5; padding: 10px; border-radius: 4px; }
  </style>
</head>
<body>
  <h1>${name}</h1>
  <p>This JNS name resolves to:</p>
  <p class="address">${resolution.address}</p>
  <p>No website content is configured for this name.</p>
</body>
</html>`

    return new Response(html, {
      status: 200,
      headers: {
        'Content-Type': 'text/html',
        'Cache-Control': `public, max-age=${this.config.cacheTtl}`,
      },
    })
  }

  /**
   * Handle DNS-over-HTTPS query
   */
  private async handleDoHQuery(
    request: Request,
    name: string,
    resolution: ResolutionResult,
  ): Promise<Response> {
    const url = new URL(request.url)
    const queryType = url.searchParams.get('type') ?? 'A'

    const answers: Array<{
      name: string
      type: number
      TTL: number
      data: string
    }> = []

    if (queryType === 'A' && resolution.address) {
      answers.push({
        name,
        type: 1,
        TTL: resolution.ttl,
        data: resolution.address,
      })
    }

    if (queryType === 'TXT') {
      if (resolution.contentHash) {
        answers.push({
          name,
          type: 16,
          TTL: resolution.ttl,
          data: `"contenthash=${resolution.contentHash}"`,
        })
      }
      if (resolution.appEndpoint) {
        answers.push({
          name,
          type: 16,
          TTL: resolution.ttl,
          data: `"app.endpoint=${resolution.appEndpoint}"`,
        })
      }
    }

    return new Response(
      JSON.stringify({
        Status: answers.length > 0 ? 0 : 3, // 0 = NOERROR, 3 = NXDOMAIN
        TC: false,
        RD: true,
        RA: true,
        AD: true,
        CD: false,
        Question: [{ name, type: this.typeToNumber(queryType) }],
        Answer: answers,
      }),
      {
        status: 200,
        headers: {
          'Content-Type': 'application/dns-json',
          'Cache-Control': `max-age=${resolution.ttl}`,
        },
      },
    )
  }

  private typeToNumber(type: string): number {
    const types: Record<string, number> = {
      A: 1,
      NS: 2,
      CNAME: 5,
      TXT: 16,
      AAAA: 28,
    }
    return types[type] ?? 1
  }

  /**
   * Clear resolution cache
   */
  clearCache(): void {
    this.cache.clear()
  }
}
