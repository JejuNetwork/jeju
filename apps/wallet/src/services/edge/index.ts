/**
 * Wallet Edge Service
 *
 * Makes the wallet act as a micro edge node for the Jeju network.
 * Desktop and extension platforms run full capabilities,
 * mobile platforms run lightweight versions.
 */

import { expectJson } from '../../lib/validation'
import { getPlatformInfo } from '../../platform/detection'
import {
  CoordinatorMessageSchema,
  EdgeConfigSchema,
} from '../../plugin/schemas'
import { AppManifestResponseSchema } from '../../schemas/api-responses'

// ============================================================================
// WebTorrent Types (dynamic import - package may not be installed)
// ============================================================================

interface WebTorrentTorrent {
  infoHash: string
  uploadSpeed: number
  downloadSpeed: number
  numPeers: number
  on(event: 'ready', callback: () => void): void
  on(event: 'error', callback: (err: Error) => void): void
  destroy(): void
}

interface WebTorrentInstance {
  seed(
    input: Buffer | Uint8Array,
    opts?: { name?: string },
    callback?: (torrent: WebTorrentTorrent) => void,
  ): WebTorrentTorrent
  add(
    torrentId: string,
    callback?: (torrent: WebTorrentTorrent) => void,
  ): WebTorrentTorrent
  get(torrentId: string): WebTorrentTorrent | null
  destroy(callback?: () => void): void
  torrents: WebTorrentTorrent[]
}

interface WebTorrentConstructor {
  new (opts?: {
    dht?: boolean
    tracker?: { announce?: string[] }
  }): WebTorrentInstance
}

// ============================================================================
// Types
// ============================================================================

export interface EdgeConfig {
  enabled: boolean
  maxCacheSizeBytes: number // Max storage for cached assets
  maxBandwidthMbps: number // Max bandwidth to contribute
  enableProxy: boolean // Enable residential proxy
  enableTorrent: boolean // Enable WebTorrent seeding
  enableCDN: boolean // Enable CDN edge caching
  enableRPC: boolean // Enable RPC proxying
  enableStorage: boolean // Enable storage services
  autoStart: boolean // Start on wallet open
  earnWhileIdle: boolean // Continue when app is backgrounded
  preferredRegion: string // Geographic region
}

export interface EdgeStats {
  status: 'stopped' | 'starting' | 'running' | 'paused'
  uptime: number
  bytesServed: number
  requestsServed: number
  earnings: bigint
  peersConnected: number
  torrentsSeeding: number
  cacheUsedBytes: number
  bandwidthUsedMbps: number
}

export interface CachedAsset {
  cid: string
  name: string
  size: number
  mimeType: string
  accessCount: number
  lastAccessed: number
  priority: 'high' | 'normal' | 'low'
}

type TorrentClient = {
  start: () => Promise<void>
  stop: () => Promise<void>
  seed: (
    data: Buffer | Uint8Array,
    opts?: { name?: string },
  ) => Promise<{ infoHash: string }>
  addTorrent: (magnetOrHash: string) => Promise<{ infoHash: string }>
  removeTorrent: (infoHash: string) => void
  getStats: () => {
    uploadSpeed: number
    downloadSpeed: number
    peers: number
    torrents: number
  }
}

type ProxyService = {
  start: () => Promise<void>
  stop: () => Promise<void>
  getMetrics: () => { activeConnections: number; bytesTransferred: number }
}

// Coordinator message types
type CoordinatorMessage =
  | { type: 'cache_request'; cid: string; metadata?: Partial<CachedAsset> }
  | { type: 'seed_request'; magnetUri: string }
  | { type: 'stats_request' }
  | { type: 'earnings_update'; earnings: string }

// ============================================================================
// Default Configuration
// ============================================================================

function getDefaultConfig(): EdgeConfig {
  const platform = getPlatformInfo()

  // Desktop: Full capabilities
  if (platform.category === 'desktop') {
    return {
      enabled: true,
      maxCacheSizeBytes: 5 * 1024 * 1024 * 1024, // 5GB
      maxBandwidthMbps: 50,
      enableProxy: true,
      enableTorrent: true,
      enableCDN: true,
      enableRPC: true,
      enableStorage: true,
      autoStart: true,
      earnWhileIdle: true,
      preferredRegion: 'auto',
    }
  }

  // Extension: Medium capabilities
  if (platform.category === 'extension') {
    return {
      enabled: true,
      maxCacheSizeBytes: 500 * 1024 * 1024, // 500MB
      maxBandwidthMbps: 10,
      enableProxy: false, // Extensions can't do raw sockets
      enableTorrent: true, // WebRTC only
      enableCDN: true,
      enableRPC: true,
      enableStorage: false,
      autoStart: true,
      earnWhileIdle: true,
      preferredRegion: 'auto',
    }
  }

  // Mobile: Lightweight
  if (platform.category === 'mobile') {
    return {
      enabled: false, // Opt-in on mobile
      maxCacheSizeBytes: 100 * 1024 * 1024, // 100MB
      maxBandwidthMbps: 5,
      enableProxy: false,
      enableTorrent: false, // Battery drain
      enableCDN: true, // Just caching
      enableRPC: false,
      enableStorage: false,
      autoStart: false,
      earnWhileIdle: false, // iOS doesn't allow this
      preferredRegion: 'auto',
    }
  }

  // Web: Minimal
  return {
    enabled: false,
    maxCacheSizeBytes: 50 * 1024 * 1024, // 50MB
    maxBandwidthMbps: 5,
    enableProxy: false,
    enableTorrent: true, // WebRTC only
    enableCDN: true,
    enableRPC: false,
    enableStorage: false,
    autoStart: false,
    earnWhileIdle: false,
    preferredRegion: 'auto',
  }
}

// ============================================================================
// Wallet Edge Service
// ============================================================================

export class WalletEdgeService {
  private config: EdgeConfig
  private stats: EdgeStats
  private cache = new Map<string, CachedAsset>()
  private torrentClient: TorrentClient | null = null
  private proxyService: ProxyService | null = null
  private dwsEndpoint: string
  private coordinatorWs: WebSocket | null = null
  private startTime = 0
  private statsReportInterval: ReturnType<typeof setInterval> | null = null
  private cacheCleanupInterval: ReturnType<typeof setInterval> | null = null

  constructor(dwsEndpoint = 'https://dws.jejunetwork.org') {
    this.config = getDefaultConfig()
    this.dwsEndpoint = dwsEndpoint
    this.stats = {
      status: 'stopped',
      uptime: 0,
      bytesServed: 0,
      requestsServed: 0,
      earnings: BigInt(0),
      peersConnected: 0,
      torrentsSeeding: 0,
      cacheUsedBytes: 0,
      bandwidthUsedMbps: 0,
    }
  }

  // ============================================================================
  // Lifecycle
  // ============================================================================

  async start(): Promise<void> {
    if (this.stats.status === 'running') return
    if (!this.config.enabled) {
      return
    }

    this.stats.status = 'starting'
    this.startTime = Date.now()

    // Platform-specific initialization
    if (this.config.enableTorrent && this.canUseTorrent()) {
      await this.initTorrent()
    }

    if (this.config.enableProxy && this.canUseProxy()) {
      await this.initProxy()
    }

    if (this.config.enableCDN) {
      await this.initCDNCache()
    }

    // Connect to DWS coordinator
    await this.connectToCoordinator()

    // Start periodic tasks
    this.statsReportInterval = setInterval(() => {
      this.reportStats()
    }, 60000) // Every minute

    this.cacheCleanupInterval = setInterval(() => {
      this.cleanupCache()
    }, 300000) // Every 5 minutes

    // Seed Jeju static assets by default
    await this.seedDefaultAssets()

    this.stats.status = 'running'
  }

  async stop(): Promise<void> {
    if (this.stats.status === 'stopped') return

    this.stats.status = 'stopped'

    if (this.statsReportInterval) {
      clearInterval(this.statsReportInterval)
    }
    if (this.cacheCleanupInterval) {
      clearInterval(this.cacheCleanupInterval)
    }

    if (this.coordinatorWs) {
      this.coordinatorWs.close()
      this.coordinatorWs = null
    }

    if (this.torrentClient) {
      await this.torrentClient.stop()
      this.torrentClient = null
    }

    if (this.proxyService) {
      await this.proxyService.stop()
      this.proxyService = null
    }

    // Final stats report
    await this.reportStats()
  }

  pause(): void {
    this.stats.status = 'paused'
  }

  resume(): void {
    if (this.stats.status === 'paused') {
      this.stats.status = 'running'
    }
  }

  // ============================================================================
  // Configuration
  // ============================================================================

  getConfig(): EdgeConfig {
    return { ...this.config }
  }

  async updateConfig(updates: Partial<EdgeConfig>): Promise<void> {
    const wasEnabled = this.config.enabled
    const wasRunning = this.stats.status === 'running'

    this.config = { ...this.config, ...updates }

    // Handle enable/disable
    if (!wasEnabled && this.config.enabled && !wasRunning) {
      await this.start()
    } else if (wasEnabled && !this.config.enabled && wasRunning) {
      await this.stop()
    }

    // Persist config
    await this.saveConfig()
  }

  private async saveConfig(): Promise<void> {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem('jeju_edge_config', JSON.stringify(this.config))
    }
  }

  private async loadConfig(): Promise<void> {
    if (typeof localStorage !== 'undefined') {
      const saved = localStorage.getItem('jeju_edge_config')
      if (saved) {
        this.config = {
          ...this.config,
          ...expectJson(saved, EdgeConfigSchema.partial(), 'edge config'),
        }
      }
    }
  }

  // ============================================================================
  // Stats
  // ============================================================================

  getStats(): EdgeStats {
    return {
      ...this.stats,
      uptime: this.stats.status === 'running' ? Date.now() - this.startTime : 0,
    }
  }

  // ============================================================================
  // Cache Management
  // ============================================================================

  async cacheAsset(
    cid: string,
    data: Buffer | Uint8Array,
    metadata?: Partial<CachedAsset>,
  ): Promise<void> {
    // Check cache limits
    const currentSize = this.stats.cacheUsedBytes
    if (currentSize + data.length > this.config.maxCacheSizeBytes) {
      await this.evictLeastUsed(data.length)
    }

    const asset: CachedAsset = {
      cid,
      name: metadata?.name ?? cid.slice(0, 12),
      size: data.length,
      mimeType: metadata?.mimeType ?? 'application/octet-stream',
      accessCount: 0,
      lastAccessed: Date.now(),
      priority: metadata?.priority ?? 'normal',
    }

    this.cache.set(cid, asset)
    this.stats.cacheUsedBytes += data.length

    // Store in platform storage
    await this.storeData(cid, data)

    // Start seeding via torrent if enabled
    if (this.torrentClient && this.config.enableTorrent) {
      await this.torrentClient.seed(
        data instanceof Buffer ? data : Buffer.from(data),
        {
          name: asset.name,
        },
      )
      this.stats.torrentsSeeding++
    }
  }

  async getCachedAsset(cid: string): Promise<Uint8Array | null> {
    const asset = this.cache.get(cid)
    if (!asset) return null

    asset.accessCount++
    asset.lastAccessed = Date.now()
    this.stats.requestsServed++

    return this.retrieveData(cid)
  }

  getCacheInfo(): CachedAsset[] {
    return Array.from(this.cache.values())
  }

  async clearCache(): Promise<void> {
    for (const [cid] of this.cache) {
      await this.removeData(cid)
    }
    this.cache.clear()
    this.stats.cacheUsedBytes = 0
    this.stats.torrentsSeeding = 0
  }

  private async evictLeastUsed(needed: number): Promise<void> {
    const assets = Array.from(this.cache.entries())
      .filter(([, a]) => a.priority !== 'high')
      .sort((a, b) => {
        // Sort by access count, then by last accessed
        if (a[1].accessCount !== b[1].accessCount) {
          return a[1].accessCount - b[1].accessCount
        }
        return a[1].lastAccessed - b[1].lastAccessed
      })

    let freed = 0
    for (const [cid, asset] of assets) {
      if (freed >= needed) break

      this.cache.delete(cid)
      await this.removeData(cid)
      freed += asset.size
      this.stats.cacheUsedBytes -= asset.size

      if (this.torrentClient) {
        this.torrentClient.removeTorrent(cid)
        this.stats.torrentsSeeding--
      }
    }
  }

  private async cleanupCache(): Promise<void> {
    const now = Date.now()
    const staleThreshold = 7 * 24 * 60 * 60 * 1000 // 7 days

    for (const [cid, asset] of this.cache) {
      if (asset.priority === 'high') continue
      if (now - asset.lastAccessed > staleThreshold && asset.accessCount < 5) {
        this.cache.delete(cid)
        await this.removeData(cid)
        this.stats.cacheUsedBytes -= asset.size
      }
    }
  }

  // ============================================================================
  // Default Assets (Jeju Apps)
  // ============================================================================

  private async seedDefaultAssets(): Promise<void> {
    // Seed static assets for Jeju apps
    const defaultAssets = [
      { name: 'gateway', priority: 'high' as const },
      { name: 'wallet', priority: 'high' as const },
      { name: 'node', priority: 'high' as const },
      { name: 'bazaar', priority: 'normal' as const },
      { name: 'indexer', priority: 'low' as const },
    ]

    for (const app of defaultAssets) {
      const manifest = await this.fetchManifest(app.name)
      if (manifest?.assets) {
        for (const asset of manifest.assets) {
          if (!this.cache.has(asset.cid)) {
            const data = await this.fetchFromDWS(asset.cid)
            if (data) {
              await this.cacheAsset(asset.cid, data, {
                name: asset.name,
                mimeType: asset.mimeType,
                priority: app.priority,
              })
            }
          }
        }
      }
    }
  }

  private async fetchManifest(appName: string): Promise<{
    assets: Array<{ cid: string; name: string; mimeType: string }>
  } | null> {
    const response = await fetch(
      `${this.dwsEndpoint}/cdn/manifest/${appName}`,
    ).catch(() => null)
    if (!response?.ok) return null
    const result = AppManifestResponseSchema.safeParse(await response.json())
    if (!result.success) return null
    return result.data
  }

  private async fetchFromDWS(cid: string): Promise<Uint8Array | null> {
    const response = await fetch(
      `${this.dwsEndpoint}/storage/download/${cid}`,
    ).catch(() => null)
    if (!response?.ok) return null
    return new Uint8Array(await response.arrayBuffer())
  }

  // ============================================================================
  // Platform-Specific Storage
  // ============================================================================

  private async storeData(
    key: string,
    data: Buffer | Uint8Array,
  ): Promise<void> {
    const platform = getPlatformInfo()

    if (platform.category === 'desktop' && '__TAURI__' in globalThis) {
      // Use Tauri invoke command for file storage
      // Dynamic import: Conditional - only loaded on Tauri desktop platform
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('edge_cache_write', {
        key,
        data: Array.from(data instanceof Buffer ? new Uint8Array(data) : data),
      })
    } else if (typeof indexedDB !== 'undefined') {
      // Use IndexedDB
      const db = await this.getIndexedDB()
      const tx = db.transaction('cache', 'readwrite')
      tx.objectStore('cache').put({ key, data: new Uint8Array(data) })
    }
  }

  private async retrieveData(key: string): Promise<Uint8Array | null> {
    const platform = getPlatformInfo()

    if (platform.category === 'desktop' && '__TAURI__' in globalThis) {
      // Dynamic import: Conditional - only loaded on Tauri desktop platform
      const { invoke } = await import('@tauri-apps/api/core')
      const data = await invoke<number[] | null>('edge_cache_read', {
        key,
      }).catch(() => null)
      return data ? new Uint8Array(data) : null
    } else if (typeof indexedDB !== 'undefined') {
      const db = await this.getIndexedDB()
      const tx = db.transaction('cache', 'readonly')
      const result = await new Promise<
        { key: string; data: Uint8Array } | undefined
      >((resolve) => {
        const request = tx.objectStore('cache').get(key)
        request.onsuccess = () =>
          resolve(
            request.result as { key: string; data: Uint8Array } | undefined,
          )
        request.onerror = () => resolve(undefined)
      })
      return result?.data ?? null
    }

    return null
  }

  private async removeData(key: string): Promise<void> {
    const platform = getPlatformInfo()

    if (platform.category === 'desktop' && '__TAURI__' in globalThis) {
      // Dynamic import: Conditional - only loaded on Tauri desktop platform
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('edge_cache_delete', { key }).catch(() => {
        /* Error handled silently */
      })
    } else if (typeof indexedDB !== 'undefined') {
      const db = await this.getIndexedDB()
      const tx = db.transaction('cache', 'readwrite')
      tx.objectStore('cache').delete(key)
    }
  }

  private async getIndexedDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('jeju_edge_cache', 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains('cache')) {
          db.createObjectStore('cache', { keyPath: 'key' })
        }
      }
    })
  }

  // ============================================================================
  // Service Initialization
  // ============================================================================

  private canUseTorrent(): boolean {
    const platform = getPlatformInfo()
    // No torrent on iOS due to App Store restrictions
    if (platform.type === 'capacitor-ios') return false
    return true
  }

  private canUseProxy(): boolean {
    const platform = getPlatformInfo()
    // Desktop only - requires raw socket access
    return platform.category === 'desktop'
  }

  private async initTorrent(): Promise<void> {
    // Dynamically import WebTorrent for platforms that support it
    // Dynamic import: Conditional - only loaded when torrent is enabled and platform supports it
    // Using Function constructor to prevent TypeScript from analyzing the import path
    const importFn = new Function('specifier', 'return import(specifier)') as (
      specifier: string,
    ) => Promise<{ default: WebTorrentConstructor }>
    const WebTorrentModule = await importFn('webtorrent')
    const WebTorrent = WebTorrentModule.default
    const client: WebTorrentInstance = new WebTorrent({
      dht: true,
      tracker: {
        announce: [
          'wss://tracker.openwebtorrent.com',
          'wss://tracker.btorrent.xyz',
        ],
      },
    })

    this.torrentClient = {
      start: async () => {
        /* WebTorrent client is already started */
      },
      stop: async () =>
        new Promise<void>((resolve) => client.destroy(() => resolve())),
      seed: async (data, opts) =>
        new Promise((resolve, reject) => {
          const torrent = client.seed(data, opts)
          torrent.on('ready', () => resolve({ infoHash: torrent.infoHash }))
          torrent.on('error', reject)
        }),
      addTorrent: async (magnetOrHash) =>
        new Promise((resolve, reject) => {
          const torrent = client.add(magnetOrHash)
          torrent.on('ready', () => resolve({ infoHash: torrent.infoHash }))
          torrent.on('error', reject)
        }),
      removeTorrent: (infoHash) => {
        const torrent = client.get(infoHash)
        if (torrent) torrent.destroy()
      },
      getStats: () => ({
        uploadSpeed: client.torrents.reduce((sum, t) => sum + t.uploadSpeed, 0),
        downloadSpeed: client.torrents.reduce(
          (sum, t) => sum + t.downloadSpeed,
          0,
        ),
        peers: client.torrents.reduce((sum, t) => sum + t.numPeers, 0),
        torrents: client.torrents.length,
      }),
    }
  }

  private async initProxy(): Promise<void> {
    // Only on desktop via Tauri
    if (!('__TAURI__' in globalThis)) return

    // Proxy runs in Rust backend, we just control it
    // Dynamic import: Conditional - only loaded on Tauri desktop platform
    const { invoke } = await import('@tauri-apps/api/core')

    this.proxyService = {
      start: async () => {
        await invoke('start_proxy_service')
      },
      stop: async () => {
        await invoke('stop_proxy_service')
      },
      getMetrics: () => ({ activeConnections: 0, bytesTransferred: 0 }),
    }

    await this.proxyService.start()
  }

  private async initCDNCache(): Promise<void> {
    // Initialize cache from stored data
    await this.loadConfig()
  }

  // ============================================================================
  // Coordinator Connection
  // ============================================================================

  private async connectToCoordinator(): Promise<void> {
    const wsUrl = this.dwsEndpoint
      .replace('https://', 'wss://')
      .replace('http://', 'ws://')

    this.coordinatorWs = new WebSocket(`${wsUrl}/edge/coordinate`)

    this.coordinatorWs.onopen = () => {
      this.registerWithCoordinator()
    }

    this.coordinatorWs.onmessage = (event) => {
      const msg = expectJson(
        event.data as string,
        CoordinatorMessageSchema,
        'coordinator message',
      ) as CoordinatorMessage
      this.handleCoordinatorMessage(msg)
    }

    this.coordinatorWs.onerror = () => {
      // WebSocket error handled silently
    }

    this.coordinatorWs.onclose = () => {
      // Reconnect after 10 seconds
      if (this.stats.status === 'running') {
        setTimeout(() => this.connectToCoordinator(), 10000)
      }
    }
  }

  private registerWithCoordinator(): void {
    const platform = getPlatformInfo()

    this.coordinatorWs?.send(
      JSON.stringify({
        type: 'register',
        nodeType: 'wallet-edge',
        platform: platform.type,
        capabilities: {
          proxy: this.config.enableProxy && this.canUseProxy(),
          torrent: this.config.enableTorrent && this.canUseTorrent(),
          cdn: this.config.enableCDN,
          rpc: this.config.enableRPC,
          storage: this.config.enableStorage,
          maxCacheBytes: this.config.maxCacheSizeBytes,
          maxBandwidthMbps: this.config.maxBandwidthMbps,
        },
        region: this.config.preferredRegion,
      }),
    )
  }

  private handleCoordinatorMessage(message: CoordinatorMessage): void {
    switch (message.type) {
      case 'cache_request': {
        // Request to cache specific content
        const { cid, metadata } = message
        this.fetchFromDWS(cid).then((data) => {
          if (data) {
            this.cacheAsset(cid, data, metadata)
          }
        })
        break
      }

      case 'seed_request':
        // Request to seed specific torrent
        if (this.torrentClient) {
          this.torrentClient.addTorrent(message.magnetUri)
        }
        break

      case 'stats_request':
        // Report current stats
        this.reportStats()
        break

      case 'earnings_update':
        // Update earnings from coordinator
        this.stats.earnings = BigInt(message.earnings)
        break
    }
  }

  private async reportStats(): Promise<void> {
    if (!this.coordinatorWs || this.coordinatorWs.readyState !== WebSocket.OPEN)
      return

    const torrentStats = this.torrentClient?.getStats()

    this.coordinatorWs.send(
      JSON.stringify({
        type: 'stats',
        stats: {
          ...this.stats,
          earnings: this.stats.earnings.toString(),
          torrents: torrentStats ?? null,
          proxy: this.proxyService?.getMetrics() ?? null,
          timestamp: Date.now(),
        },
      }),
    )
  }
}

// ============================================================================
// Singleton
// ============================================================================

let edgeService: WalletEdgeService | null = null

export function getEdgeService(dwsEndpoint?: string): WalletEdgeService {
  if (!edgeService) {
    edgeService = new WalletEdgeService(dwsEndpoint)
  }
  return edgeService
}

export function resetEdgeService(): void {
  if (edgeService) {
    edgeService.stop()
    edgeService = null
  }
}
