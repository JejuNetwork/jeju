import { cors } from '@elysiajs/cors'
import { getRpcUrl } from '@jejunetwork/config'
import { getCacheClient, readContract } from '@jejunetwork/shared'
import { Elysia } from 'elysia'
import {
  type Address,
  type Chain,
  createPublicClient,
  type Hex,
  http,
  type PublicClient,
  type Transport,
  toHex,
  keccak256 as viemKeccak256,
} from 'viem'
import { base, baseSepolia } from 'viem/chains'
import { normalize } from 'viem/ens'
import { ResolvedContentSchema } from '../lib/validation'
import {
  isDevModeEnabled,
  printDevProxyStatus,
  proxyToDevServer,
  resolveDevProxy,
} from './dev-proxy'

const JNS_RESOLVER_ABI = [
  {
    name: 'contenthash',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'bytes' }],
  },
  {
    name: 'addr',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
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
  {
    name: 'getAppInfo',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [
      { name: 'appContract', type: 'address' },
      { name: 'appId', type: 'bytes32' },
      { name: 'agentId', type: 'uint256' },
      { name: 'endpoint', type: 'string' },
      { name: 'a2aEndpoint', type: 'string' },
      { name: 'contenthash_', type: 'bytes' },
    ],
  },
] as const

const JNS_REGISTRY_ABI = [
  {
    name: 'resolver',
    type: 'function',
    stateMutability: 'view',
    inputs: [{ name: 'node', type: 'bytes32' }],
    outputs: [{ name: '', type: 'address' }],
  },
] as const

import type { JNSGatewayConfigBase } from '@jejunetwork/types'

interface JNSGatewayConfig extends JNSGatewayConfigBase {
  ipfsGatewayUrl: string
  defaultResolver?: Address
}

interface ResolvedContent {
  cid: string
  codec: 'ipfs' | 'ipns' | 'swarm' | 'arweave'
}

function decodeContenthash(contenthash: Hex): ResolvedContent | null {
  if (!contenthash || contenthash === '0x' || contenthash.length < 4) {
    return null
  }

  const bytes = Buffer.from(contenthash.slice(2), 'hex')
  if (bytes.length < 2) return null

  const codec = bytes[0]
  const hashFn = bytes[1]

  if (codec === 0xe3) {
    if (bytes[1] === 0x01 && bytes[2] === 0x70 && bytes[3] === 0x12) {
      const cid = Buffer.from(bytes.slice(1)).toString('base64url')
      return { cid: `b${cid}`, codec: 'ipfs' }
    }
    if (hashFn === 0x12) {
      const multihash = bytes.slice(1)
      const cid = `Qm${Buffer.from(multihash.slice(2)).toString('hex')}`
      return { cid, codec: 'ipfs' }
    }
    const cid = bytes.slice(1).toString('hex')
    return { cid, codec: 'ipfs' }
  }

  if (codec === 0xe5) {
    const cid = Buffer.from(bytes.slice(1)).toString('base64url')
    return { cid: `k${cid}`, codec: 'ipns' }
  }

  if (codec === 0xe4) {
    const hash = bytes.slice(1).toString('hex')
    return { cid: hash, codec: 'swarm' }
  }

  if (codec === 0x90) {
    const txId = Buffer.from(bytes.slice(1)).toString('base64url')
    return { cid: txId, codec: 'arweave' }
  }

  return null
}

const ZERO_BYTES32: Hex =
  '0x0000000000000000000000000000000000000000000000000000000000000000'

function namehash(name: string): Hex {
  let node: Hex = ZERO_BYTES32

  if (name === '') return node

  const labels = normalize(name).split('.')

  for (let i = labels.length - 1; i >= 0; i--) {
    const label = labels[i]
    if (!label) continue
    const labelHash = hashBytes(Buffer.from(label, 'utf8'))
    node = hashBytes(
      Buffer.concat([
        Buffer.from(node.slice(2), 'hex'),
        Buffer.from(labelHash.slice(2), 'hex'),
      ]),
    )
  }

  return node
}

function hashBytes(data: Buffer): Hex {
  return viemKeccak256(toHex(data))
}

function getMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase()
  const mimeTypes: Record<string, string> = {
    html: 'text/html',
    htm: 'text/html',
    css: 'text/css',
    js: 'application/javascript',
    mjs: 'application/javascript',
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
    txt: 'text/plain',
    md: 'text/markdown',
    xml: 'application/xml',
    wasm: 'application/wasm',
  }
  return mimeTypes[ext ?? ''] ?? 'application/octet-stream'
}

export class JNSGateway {
  private app: Elysia
  private config: JNSGatewayConfig
  private client: PublicClient<Transport, Chain>
  private localCache: Map<
    string,
    { content: ResolvedContent; expiry: number }
  > = new Map()
  private readonly CACHE_TTL = 300_000
  private decentralizedCache: import('@jejunetwork/shared').CacheClient | null =
    null

  constructor(config: JNSGatewayConfig) {
    this.config = config
    this.app = new Elysia()

    const chain =
      config.rpcUrl.includes('sepolia') || config.rpcUrl.includes('testnet')
        ? baseSepolia
        : base

    this.client = createPublicClient({
      chain,
      transport: http(config.rpcUrl),
    }) as PublicClient<Transport, Chain>

    this.setupRoutes()
  }

  private setupRoutes(): void {
    this.app.use(cors())

    this.app.get('/health', () => ({
      status: 'healthy',
      service: 'jns-gateway',
    }))

    this.app.get('/ipfs/:cid', async ({ params, request, set }) => {
      const cid = params.cid
      const url = new URL(request.url)
      const path = url.pathname.replace(`/ipfs/${cid}`, '') ?? '/'
      return this.serveIpfsContent(cid, path, set)
    })

    this.app.get('/api/resolve/:name', async ({ params, set }) => {
      const name = params.name
      const content = await this.resolveJNS(name)

      if (!content) {
        set.status = 404
        return { error: 'Name not found or no contenthash' }
      }

      return {
        name,
        cid: content.cid,
        codec: content.codec,
        gatewayUrl: this.getGatewayUrl(content),
      }
    })

    // Helper to handle host-based JNS routing
    const handleHostBasedRouting = async (
      request: Request,
      set: { status?: number | string; headers: Record<string, string | number> },
    ): Promise<Response | string | object | null> => {
      const host = request.headers.get('host') ?? ''
      // Match various JNS patterns:
      // - name.jeju.network, name.jeju.io, name.jeju.local
      // - name.local.jejunetwork.org (local development)
      // - name.jejunetwork.org (production)
      const jnsMatch =
        host.match(/^([a-z0-9-]+)\.jeju\.(network|io|local)/) ||
        host.match(/^([a-z0-9-]+)\.local\.jejunetwork\.org/) ||
        host.match(/^([a-z0-9-]+)\.jejunetwork\.org/)
      if (jnsMatch?.[1]) {
        const name = `${jnsMatch[1]}.jeju`
        const url = new URL(request.url)
        const path = url.pathname === '/' ? '/index.html' : url.pathname
        return this.serveJNSContent(name, path, set, request)
      }
      return null
    }

    this.app.get('/:name/*', async ({ params, request, set }) => {
      const name = params.name
      // If the name doesn't look like a JNS name (name.jeju), try host-based routing
      if (!/^[a-z0-9-]+\.jeju$/.test(name)) {
        const hostResult = await handleHostBasedRouting(request, set)
        if (hostResult !== null) return hostResult
        set.status = 404
        return { error: 'Invalid JNS name' }
      }
      const url = new URL(request.url)
      const path = url.pathname.replace(`/${name}`, '') || '/index.html'
      return this.serveJNSContent(name, path, set, request)
    })

    this.app.get('*', async ({ request, set }) => {
      const hostResult = await handleHostBasedRouting(request, set)
      if (hostResult !== null) return hostResult
      return 'JNS Gateway - Use *.jejunetwork.org for name resolution'
    })
  }

  private async initDecentralizedCache(): Promise<void> {
    if (this.decentralizedCache) return

    try {
      this.decentralizedCache = getCacheClient('jns-gateway')
      console.log('[JNS Gateway] Decentralized cache initialized')
    } catch {
      console.log(
        '[JNS Gateway] Decentralized cache not available, using local cache',
      )
    }
  }

  private async getFromCache(name: string): Promise<ResolvedContent | null> {
    if (this.decentralizedCache) {
      const cached = await this.decentralizedCache.get(`jns:${name}`)
      if (cached) {
        const parsed = ResolvedContentSchema.safeParse(JSON.parse(cached))
        if (parsed.success) {
          return parsed.data
        }
      }
    }

    const localCached = this.localCache.get(name)
    if (localCached && localCached.expiry > Date.now()) {
      return localCached.content
    }

    return null
  }

  private async setToCache(
    name: string,
    content: ResolvedContent,
  ): Promise<void> {
    if (this.decentralizedCache) {
      try {
        await this.decentralizedCache.set(
          `jns:${name}`,
          JSON.stringify(content),
          Math.floor(this.CACHE_TTL / 1000),
        )
      } catch (e) {
        console.debug(`Failed to write to decentralized cache for ${name}:`, e)
      }
    }

    this.localCache.set(name, { content, expiry: Date.now() + this.CACHE_TTL })
  }

  async resolveJNS(name: string): Promise<ResolvedContent | null> {
    const cached = await this.getFromCache(name)
    if (cached) {
      return cached
    }

    const node = namehash(name)

    let resolverAddr: Address
    if (this.config.defaultResolver) {
      resolverAddr = this.config.defaultResolver
    } else {
      resolverAddr = await readContract(this.client, {
        address: this.config.jnsRegistryAddress,
        abi: JNS_REGISTRY_ABI,
        functionName: 'resolver',
        args: [node],
      })
    }

    if (resolverAddr === '0x0000000000000000000000000000000000000000') {
      return null
    }

    const contenthash = (await readContract(this.client, {
      address: resolverAddr,
      abi: JNS_RESOLVER_ABI,
      functionName: 'contenthash',
      args: [node],
    })) as Hex

    const content = decodeContenthash(contenthash)

    if (content) {
      await this.setToCache(name, content)
    }

    return content
  }

  private async serveJNSContent(
    name: string,
    path: string,
    set: { status?: number | string; headers: Record<string, string | number> },
    request?: Request,
  ): Promise<Response | string | object> {
    // Check for dev mode proxy first (enables HMR during local development)
    if (isDevModeEnabled()) {
      const devResolution = await resolveDevProxy(name, this.client)
      if (devResolution.isDevMode && devResolution.proxyUrl && request) {
        console.log(
          `[JNS Gateway] Dev proxy: ${name} → ${devResolution.proxyUrl} (${devResolution.source})`,
        )
        return proxyToDevServer(devResolution.proxyUrl, request, path)
      }
    }

    // Normal production flow: resolve contenthash from JNS, fetch from IPFS
    const content = await this.resolveJNS(name)

    if (!content) {
      // In dev mode, provide helpful error message
      if (isDevModeEnabled()) {
        set.status = 503
        return {
          error: `JNS name "${name}" not found and no dev proxy configured`,
          hint: `Start the dev server for this app, or set DEV_PROXY_${name.toUpperCase().replace(/-/g, '_')}_URL`,
          devMode: true,
        }
      }
      set.status = 404
      return `JNS name "${name}" not found or has no contenthash`
    }

    return this.serveIpfsContent(content.cid, path, set)
  }

  private async serveIpfsContent(
    cid: string,
    path: string,
    set: { status?: number | string; headers: Record<string, string | number> },
  ): Promise<Response | object> {
    const gateway = this.config.ipfsGatewayUrl
    const url = `${gateway}/ipfs/${cid}${path}`

    const response = await fetch(url, {
      headers: { Accept: '*/*' },
      signal: AbortSignal.timeout(30000),
    }).catch((e: Error | TypeError): null => {
      console.error(`[JNS Gateway] IPFS fetch failed: ${e}`)
      return null
    })

    if (response?.ok) {
      const contentType =
        response.headers.get('content-type') ?? getMimeType(path)

      return new Response(response.body, {
        status: 200,
        headers: {
          'Content-Type': contentType,
          'Cache-Control': 'public, max-age=31536000, immutable',
          'X-Content-CID': cid,
          'X-Gateway': gateway,
        },
      })
    }

    if (response?.status === 404 && !path.includes('.')) {
      const indexUrl = `${gateway}/ipfs/${cid}/index.html`
      const indexResponse = await fetch(indexUrl, {
        signal: AbortSignal.timeout(30000),
      })

      if (indexResponse.ok) {
        return new Response(indexResponse.body, {
          status: 200,
          headers: {
            'Content-Type': 'text/html',
            'Cache-Control': 'public, max-age=3600',
            'X-Content-CID': cid,
            'X-Gateway': gateway,
            'X-SPA-Index': 'true',
          },
        })
      }
    }

    set.status = 502
    return {
      error: 'Content not available',
      cid,
      gateway,
      status: response?.status ?? 'connection_failed',
      message:
        'IPFS content not found. Ensure content is pinned to the network.',
    }
  }

  private getGatewayUrl(content: ResolvedContent): string {
    switch (content.codec) {
      case 'ipfs':
        return `${this.config.ipfsGatewayUrl}/ipfs/${content.cid}`
      case 'ipns':
        return `${this.config.ipfsGatewayUrl}/ipns/${content.cid}`
      case 'arweave':
        return `https://arweave.net/${content.cid}`
      case 'swarm':
        return `https://gateway.ethswarm.org/bzz/${content.cid}`
      default:
        return `${this.config.ipfsGatewayUrl}/ipfs/${content.cid}`
    }
  }

  getApp(): Elysia {
    return this.app
  }

  async start(): Promise<void> {
    await this.initDecentralizedCache()

    const devMode = isDevModeEnabled()
    const modeStr = devMode ? '🔄 DEV MODE (HMR enabled)' : '🏭 PRODUCTION'

    console.log(`
╔═══════════════════════════════════════════════════════════╗
║                      JNS Gateway                           ║
║          Decentralized Frontend Serving via JNS            ║
╠═══════════════════════════════════════════════════════════╣
║  Mode:          ${modeStr.padEnd(38)}║
║  RPC:           ${this.config.rpcUrl.slice(0, 38).padEnd(38)}║
║  Registry:      ${this.config.jnsRegistryAddress.slice(0, 38).padEnd(38)}║
║  IPFS Gateway:  ${this.config.ipfsGatewayUrl.slice(0, 38).padEnd(38)}║
║  Port:          ${this.config.port.toString().padEnd(38)}║
╚═══════════════════════════════════════════════════════════╝
`)

    // Print dev proxy status if in dev mode
    if (devMode) {
      printDevProxyStatus()
    }

    this.app.listen(this.config.port)

    console.log(`JNS Gateway listening on port ${this.config.port}`)
  }
}

export async function startJNSGateway(): Promise<JNSGateway> {
  const ipfsGatewayUrl = process.env.IPFS_GATEWAY_URL

  if (!ipfsGatewayUrl) {
    throw new Error(
      'JNS Gateway requires IPFS_GATEWAY_URL environment variable. ' +
        'Start local IPFS: docker compose up -d ipfs',
    )
  }

  const jnsRegistryAddress = process.env.JNS_REGISTRY_ADDRESS
  if (
    !jnsRegistryAddress ||
    jnsRegistryAddress === '0x0000000000000000000000000000000000000000'
  ) {
    console.warn(
      '[JNS Gateway] JNS_REGISTRY_ADDRESS not set - name resolution will fail until contracts are deployed',
    )
  }

  const jnsResolverEnv = process.env.JNS_RESOLVER_ADDRESS
  const defaultResolver: Address | undefined =
    jnsResolverEnv?.startsWith('0x') && jnsResolverEnv.length === 42
      ? (jnsResolverEnv as Address)
      : undefined

  const registryAddress: Address =
    jnsRegistryAddress?.startsWith('0x') && jnsRegistryAddress.length === 42
      ? (jnsRegistryAddress as Address)
      : '0x0000000000000000000000000000000000000000'

  const config: JNSGatewayConfig = {
    port: parseInt(process.env.JNS_GATEWAY_PORT ?? '4005', 10),
    rpcUrl: getRpcUrl(),
    jnsRegistryAddress: registryAddress,
    ipfsGatewayUrl,
    defaultResolver,
  }

  const gateway = new JNSGateway(config)
  await gateway.start()
  return gateway
}

if (import.meta.main) {
  startJNSGateway()
}
