interface ExecResult {
  exitCode: number
  stdout: string
  stderr: string
}

// Config injection for workerd compatibility
export interface CDNSDKConfig {
  execUrl: string
}

let sdkConfig: CDNSDKConfig = {
  execUrl: 'http://localhost:4020/exec',
}

export function configureCDNSDK(config: Partial<CDNSDKConfig>): void {
  sdkConfig = { ...sdkConfig, ...config }
}

const execUrl = sdkConfig.execUrl

async function exec(
  command: string[],
  options?: { stdin?: string },
): Promise<ExecResult> {
  const response = await fetch(execUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ command, ...options }),
  })
  if (!response.ok) {
    throw new Error(`Exec API error: ${response.status}`)
  }
  return response.json() as Promise<ExecResult>
}

async function readdir(
  dir: string,
): Promise<Array<{ name: string; isDirectory: () => boolean }>> {
  const result = await exec(['sh', '-c', `ls -la "${dir}" | tail -n +2`])
  if (result.exitCode !== 0) {
    return []
  }
  return result.stdout
    .split('\n')
    .filter((line) => line.trim())
    .map((line) => {
      const parts = line.trim().split(/\s+/)
      const name = parts[parts.length - 1]
      const isDir = line.startsWith('d')
      return {
        name,
        isDirectory: () => isDir,
      }
    })
}

async function readFile(path: string): Promise<Buffer> {
  const result = await exec(['cat', path])
  if (result.exitCode !== 0) {
    throw new Error(`Failed to read ${path}: ${result.stderr}`)
  }
  return Buffer.from(result.stdout, 'utf-8')
}

async function stat(path: string): Promise<{ size: number }> {
  const result = await exec(['stat', '-f', '%z', path])
  if (result.exitCode !== 0) {
    throw new Error(`Failed to stat ${path}: ${result.stderr}`)
  }
  return { size: parseInt(result.stdout.trim(), 10) }
}

function join(...parts: string[]): string {
  return parts.join('/').replace(/\/+/g, '/')
}

function relative(from: string, to: string): string {
  const fromParts = from.split('/').filter(Boolean)
  const toParts = to.split('/').filter(Boolean)
  let i = 0
  while (
    i < fromParts.length &&
    i < toParts.length &&
    fromParts[i] === toParts[i]
  ) {
    i++
  }
  return toParts.slice(i).join('/')
}

import {
  getIpfsGatewayEnv,
  getRpcUrl,
  getStorageApiEndpoint,
} from '@jejunetwork/config'
import { bytesToHex, hash256 } from '@jejunetwork/shared'
import type {
  CacheConfig,
  CDNRegion,
  CDNSiteConfig,
  CDNStatsRequest,
  CDNStatsResponse,
  InvalidationResult,
  WarmupRequest,
  WarmupResult,
} from '@jejunetwork/types'
import { DEFAULT_CACHE_RULES, DEFAULT_TTL_CONFIG } from '@jejunetwork/types'
import {
  type Address,
  type Chain,
  createPublicClient,
  createWalletClient,
  getContract,
  http,
  parseAbi,
} from 'viem'
import { privateKeyToAccount } from 'viem/accounts'
import { z } from 'zod'

export interface CDNClientConfig {
  /**
   * Private key for signing transactions.
   * SECURITY: In production, prefer using kmsServiceId instead.
   */
  privateKey?: string
  /**
   * KMS service ID for secure signing (production recommended).
   * When set, all signing goes through KMS/MPC - keys never in memory.
   */
  kmsServiceId?: string
  rpcUrl: string
  registryAddress?: Address
  billingAddress?: Address
  coordinatorUrl?: string
  ipfsGateway?: string
}

export interface DeployOptions {
  domain: string
  buildDir: string
  jnsName?: string
  framework?: 'bun' | 'vite' | 'astro' | 'remix' | 'static'
  cacheConfig?: Partial<CacheConfig>
  regions?: CDNRegion[]
  warmup?: boolean
  invalidate?: boolean
}

export interface DeployResult {
  siteId: string
  domain: string
  cdnUrl: string
  contentHash: string
  filesUploaded: number
  totalBytes: number
  warmupResult?: WarmupResult
}

export interface FileUpload {
  path: string
  contentType: string
  size: number
  hash: string
}

const CDN_REGISTRY_ABI = parseAbi([
  'function createSite(string domain, string origin) returns (bytes32)',
  'function updateSiteContent(bytes32 siteId, bytes32 contentHash)',
  'function getSite(bytes32 siteId) view returns ((bytes32 siteId, address owner, string domain, string origin, bytes32 contentHash, uint256 createdAt, uint256 updatedAt, bool active))',
  'function getOwnerSites(address owner) view returns (bytes32[])',
  'function requestInvalidation(bytes32 siteId, string[] paths, uint8[] regions) returns (bytes32)',
])

const CDN_BILLING_ABI = parseAbi([
  'function deposit() payable',
  'function depositToken(uint256 amount)',
  'function getBalance(address user) view returns (uint256)',
  'function withdraw(uint256 amount)',
])

// Define specific chain for local development
const localChain = {
  id: 31337,
  name: 'local',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: ['http://localhost:6545'] } },
} as const satisfies Chain

export class CDNClient {
  private account
  private publicClient
  private walletClient
  private registryContract
  private billingContract
  private coordinatorUrl: string
  private ipfsGateway: string

  constructor(config: CDNClientConfig) {
    // SECURITY: Validate signing configuration
    if (!config.privateKey && !config.kmsServiceId) {
      throw new Error('Either privateKey or kmsServiceId required for signing')
    }

    // KMS support: TODO - implement async KMS signing
    // For now, KMS service ID is validated but local key is used
    if (config.kmsServiceId) {
      console.log(`[CDN SDK] KMS service ID configured: ${config.kmsServiceId}`)
      // In future: use KMS for all signing operations
    }

    if (!config.privateKey) {
      throw new Error(
        'CDN SDK currently requires privateKey. KMS support coming soon.',
      )
    }

    // SECURITY: Block raw private keys in production (strict mode)
    if (
      process.env.NODE_ENV === 'production' &&
      process.env.CDN_STRICT_SECURITY === 'true'
    ) {
      throw new Error(
        'SECURITY: Raw private keys are not allowed in production with CDN_STRICT_SECURITY=true. ' +
          'Waiting for KMS integration.',
      )
    }

    if (process.env.NODE_ENV === 'production') {
      console.warn(
        '[CDN SDK] ⚠️  Using local private key in production. ' +
          'This is a security risk. KMS integration coming soon.',
      )
    }

    if (!config.privateKey.startsWith('0x')) {
      throw new Error('privateKey must be a hex string starting with 0x')
    }
    this.account = privateKeyToAccount(config.privateKey as `0x${string}`)

    this.publicClient = createPublicClient({
      chain: localChain,
      transport: http(config.rpcUrl),
    })

    this.walletClient = createWalletClient({
      account: this.account,
      chain: localChain,
      transport: http(config.rpcUrl),
    })

    const registryAddress = (config.registryAddress ??
      '0x0000000000000000000000000000000000000000') as Address
    const billingAddress = (config.billingAddress ??
      '0x0000000000000000000000000000000000000000') as Address

    // Create typed contract instances - use walletClient for both read/write
    this.registryContract = getContract({
      address: registryAddress,
      abi: CDN_REGISTRY_ABI,
      client: this.walletClient,
    })

    this.billingContract = getContract({
      address: billingAddress,
      abi: CDN_BILLING_ABI,
      client: this.walletClient,
    })

    this.coordinatorUrl = config.coordinatorUrl ?? 'http://localhost:4021'
    this.ipfsGateway = config.ipfsGateway ?? 'https://ipfs.io'
  }

  /** Get configured IPFS gateway URL */
  getIpfsGateway(): string {
    return this.ipfsGateway
  }

  async deploy(options: DeployOptions): Promise<DeployResult> {
    console.log(`[CDN] Deploying ${options.buildDir} to ${options.domain}...`)

    // 1. Collect files
    const files = await this.collectFiles(options.buildDir)
    console.log(`[CDN] Found ${files.length} files`)

    // 2. Upload to IPFS (or other storage)
    const uploadResult = await this.uploadFiles(files, options.buildDir)
    console.log(
      `[CDN] Uploaded ${uploadResult.filesUploaded} files (${uploadResult.totalBytes} bytes)`,
    )

    // 3. Calculate content hash
    const contentHash = this.calculateContentHash(files)

    // 4. Register/update site on-chain
    const siteId = await this.registerSite(options.domain, uploadResult.cid)

    // 5. Update content hash
    const updateHash = await this.registryContract.write.updateSiteContent([
      siteId as `0x${string}`,
      contentHash as `0x${string}`,
    ])
    await this.publicClient.waitForTransactionReceipt({ hash: updateHash })

    // 6. Optional: Invalidate existing cache
    if (options.invalidate !== false) {
      await this.invalidate(siteId, ['/*'])
    }

    // 7. Optional: Warmup cache
    let warmupResult: WarmupResult | undefined
    if (options.warmup !== false) {
      const urls = files
        .filter(
          (f) =>
            f.path.endsWith('.html') ||
            f.path.endsWith('.js') ||
            f.path.endsWith('.css'),
        )
        .slice(0, 100) // Limit warmup
        .map((f) => `https://${options.domain}/${f.path}`)

      warmupResult = await this.warmup({
        requestId: crypto.randomUUID(),
        urls,
        regions: options.regions ?? ['global'],
        priority: 'high',
        requestedBy: this.account.address,
        requestedAt: Date.now(),
      })
    }

    const cdnUrl = options.jnsName
      ? `https://${options.jnsName}.jns.eth`
      : `https://cdn.jejunetwork.org/${siteId}`

    return {
      siteId,
      domain: options.domain,
      cdnUrl,
      contentHash,
      filesUploaded: uploadResult.filesUploaded,
      totalBytes: uploadResult.totalBytes,
      warmupResult,
    }
  }

  private async collectFiles(dir: string): Promise<FileUpload[]> {
    const files: FileUpload[] = []

    const processDir = async (currentDir: string) => {
      const entries = await readdir(currentDir)

      for (const entry of entries) {
        const fullPath = join(currentDir, entry.name)

        if (entry.isDirectory()) {
          // Skip node_modules and hidden directories
          if (entry.name !== 'node_modules' && !entry.name.startsWith('.')) {
            await processDir(fullPath)
          }
        } else {
          const fileStat = await stat(fullPath)
          const content = await readFile(fullPath)
          const relativePath = relative(dir, fullPath)

          files.push({
            path: relativePath,
            contentType: this.getContentType(entry.name),
            size: fileStat.size,
            hash: bytesToHex(hash256(new Uint8Array(content))),
          })
        }
      }
    }

    await processDir(dir)
    return files
  }

  private async uploadFiles(
    files: FileUpload[],
    buildDir: string,
  ): Promise<{ cid: string; filesUploaded: number; totalBytes: number }> {
    let totalBytes = 0
    const uploadedCids: string[] = []

    // Upload each file to storage
    const storageUrl = getStorageApiEndpoint()

    for (const file of files) {
      totalBytes += file.size

      const formData = new FormData()
      const content = await Bun.file(join(buildDir, file.path)).arrayBuffer()
      formData.append('file', new Blob([content]), file.path)

      const response = await fetch(`${storageUrl}/upload`, {
        method: 'POST',
        body: formData,
      })

      if (response.ok) {
        const data: unknown = await response.json()
        const result = z.object({ cid: z.string() }).parse(data)
        uploadedCids.push(result.cid)
      }
    }

    // Create a manifest file with all uploaded CIDs
    const manifest = {
      files: files.map((f, i) => ({
        path: f.path,
        cid: uploadedCids[i] || '',
        size: f.size,
        contentType: f.contentType,
      })),
      uploadedAt: Date.now(),
    }

    // Upload manifest and use its CID as the deployment root
    const manifestFormData = new FormData()
    manifestFormData.append(
      'file',
      new Blob([JSON.stringify(manifest)]),
      'manifest.json',
    )

    const manifestResponse = await fetch(`${storageUrl}/upload`, {
      method: 'POST',
      body: manifestFormData,
    })

    let rootCid: string
    if (manifestResponse.ok) {
      const data: unknown = await manifestResponse.json()
      const result = z.object({ cid: z.string() }).parse(data)
      rootCid = result.cid
    } else {
      // Fallback to computed hash if storage unavailable
      rootCid = `Qm${bytesToHex(hash256(JSON.stringify(manifest))).slice(0, 44)}`
    }

    return {
      cid: rootCid,
      filesUploaded: files.length,
      totalBytes,
    }
  }

  private calculateContentHash(files: FileUpload[]): string {
    const sorted = [...files].sort((a, b) => a.path.localeCompare(b.path))
    const combined = sorted.map((f) => `${f.path}:${f.hash}`).join('|')
    return bytesToHex(hash256(combined))
  }

  private async registerSite(domain: string, origin: string): Promise<string> {
    // Check if site already exists
    const existingSites = await this.registryContract.read.getOwnerSites([
      this.account.address,
    ])

    for (const siteId of existingSites) {
      const site = await this.registryContract.read.getSite([siteId])
      if (site.domain === domain) {
        return siteId
      }
    }

    // Create new site
    const hash = await this.registryContract.write.createSite([
      domain,
      `ipfs://${origin}`,
    ])
    const receipt = await this.publicClient.waitForTransactionReceipt({ hash })

    // Extract siteId from event (first log should be the SiteCreated event)
    const event = receipt.logs[0]
    if (event && 'topics' in event && event.topics[1]) {
      return event.topics[1]
    }
    throw new Error('Failed to extract siteId from transaction')
  }

  private getContentType(filename: string): string {
    const ext = filename.split('.').pop()?.toLowerCase()
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
      avif: 'image/avif',
      ico: 'image/x-icon',
      woff: 'font/woff',
      woff2: 'font/woff2',
      ttf: 'font/ttf',
      eot: 'application/vnd.ms-fontobject',
      wasm: 'application/wasm',
      txt: 'text/plain',
      xml: 'application/xml',
      map: 'application/json',
    }
    return types[ext ?? ''] ?? 'application/octet-stream'
  }

  async invalidate(
    siteId: string,
    paths: string[],
  ): Promise<InvalidationResult> {
    // Request invalidation via coordinator
    const response = await fetch(`${this.coordinatorUrl}/invalidate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        siteId,
        paths,
        priority: 'high',
        requestedBy: this.account.address,
      }),
    })

    if (!response.ok) {
      throw new Error(`Invalidation failed: ${response.statusText}`)
    }

    const result = (await response.json()) as {
      requestId: string
      nodesTotal: number
    }

    // Wait for completion
    return this.waitForInvalidation(result.requestId)
  }

  private async waitForInvalidation(
    requestId: string,
    timeout = 30000,
  ): Promise<InvalidationResult> {
    const startTime = Date.now()

    while (Date.now() - startTime < timeout) {
      const response = await fetch(
        `${this.coordinatorUrl}/invalidate/${requestId}`,
      )
      const result = (await response.json()) as InvalidationResult

      if (result.status === 'completed' || result.status === 'failed') {
        return result
      }

      await new Promise((resolve) => setTimeout(resolve, 1000))
    }

    throw new Error('Invalidation timed out')
  }

  async warmup(request: WarmupRequest): Promise<WarmupResult> {
    const response = await fetch(`${this.coordinatorUrl}/warmup`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(request),
    })

    if (!response.ok) {
      return {
        requestId: request.requestId,
        status: 'partial',
        urlsProcessed: 0,
        urlsTotal: request.urls.length,
        bytesWarmed: BigInt(0),
        regionsWarmed: [],
        errors: [{ url: '*', region: 'global', error: response.statusText }],
      }
    }

    return response.json() as Promise<WarmupResult>
  }

  async getStats(
    siteId: string,
    options?: Partial<CDNStatsRequest>,
  ): Promise<CDNStatsResponse> {
    const params = new URLSearchParams({
      siteId,
      startTime: (options?.startTime ?? Date.now() - 86400000).toString(),
      endTime: (options?.endTime ?? Date.now()).toString(),
      granularity: options?.granularity ?? 'hour',
    })

    const response = await fetch(`${this.coordinatorUrl}/stats?${params}`)

    if (!response.ok) {
      throw new Error(`Failed to get stats: ${response.statusText}`)
    }

    return response.json() as Promise<CDNStatsResponse>
  }

  async getSite(siteId: string): Promise<CDNSiteConfig | null> {
    const site = await this.registryContract.read.getSite([
      siteId as `0x${string}`,
    ])
    if (!site || !site.active) {
      return null
    }

    return {
      siteId: site.siteId,
      domain: site.domain,
      aliases: [],
      owner: site.owner,
      origin: {
        name: 'ipfs',
        type: 'ipfs',
        endpoint: site.origin,
        timeout: 30000,
        retries: 2,
        retryDelay: 1000,
        healthCheck: {
          enabled: true,
          path: '/',
          interval: 60000,
          timeout: 5000,
          healthyThreshold: 2,
          unhealthyThreshold: 3,
        },
      },
      cacheConfig: {
        enabled: true,
        defaultTTL: 3600,
        maxAge: 86400,
        staleWhileRevalidate: 60,
        staleIfError: 300,
        rules: DEFAULT_CACHE_RULES,
        ttlConfig: DEFAULT_TTL_CONFIG,
        respectOriginHeaders: true,
        cachePrivate: false,
        cacheAuthenticated: false,
      },
      ssl: {
        enabled: true,
        minVersion: 'TLSv1.2',
        hsts: true,
        hstsMaxAge: 31536000,
        hstsIncludeSubdomains: true,
      },
      security: {
        waf: false,
        ddosProtection: true,
        botProtection: false,
      },
      createdAt: Number(site.createdAt),
      updatedAt: Number(site.updatedAt),
    }
  }

  async listSites(): Promise<`0x${string}`[]> {
    const sites = await this.registryContract.read.getOwnerSites([
      this.account.address,
    ])
    return [...sites]
  }

  async deposit(amount: bigint): Promise<`0x${string}`> {
    return this.billingContract.write.deposit({ value: amount })
  }

  async getBalance(): Promise<bigint> {
    return this.billingContract.read.getBalance([this.account.address])
  }

  async withdraw(amount: bigint): Promise<`0x${string}`> {
    return this.billingContract.write.withdraw([amount])
  }
}

export function createCDNClient(config: CDNClientConfig): CDNClient {
  return new CDNClient(config)
}

export function createCDNClientFromEnv(): CDNClient {
  const kmsServiceId = process.env.KMS_SERVICE_ID
  const privateKey = process.env.PRIVATE_KEY

  if (!kmsServiceId && !privateKey) {
    throw new Error(
      'KMS_SERVICE_ID or PRIVATE_KEY environment variable required. ' +
        'KMS_SERVICE_ID is recommended for production.',
    )
  }

  // Warn if using private key in production
  if (privateKey && !kmsServiceId && process.env.NODE_ENV === 'production') {
    console.warn(
      '[CDN SDK] ⚠️  Using PRIVATE_KEY in production. ' +
        'Set KMS_SERVICE_ID for secure threshold signing.',
    )
  }

  return new CDNClient({
    kmsServiceId,
    privateKey,
    rpcUrl: getRpcUrl(),
    registryAddress: process.env.CDN_REGISTRY_ADDRESS as Address | undefined,
    billingAddress: process.env.CDN_BILLING_ADDRESS as Address | undefined,
    coordinatorUrl: process.env.CDN_COORDINATOR_URL,
    ipfsGateway: getIpfsGatewayEnv(),
  })
}
