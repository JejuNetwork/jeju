import type { Address } from 'viem'

// Types

export interface NodeUpdateConfig {
  enabled: boolean
  checkInterval: number // ms between checks
  autoDownload: boolean // Download updates automatically
  autoInstall: boolean // Install and restart automatically
  channel: 'stable' | 'beta' | 'nightly'
  dwsEndpoint: string // DWS endpoint for update manifests
  pkgRegistryAddress?: Address // On-chain package registry
}

export interface NodeUpdateInfo {
  version: string
  releaseDate: string
  channel: 'stable' | 'beta' | 'nightly'
  changelog: string
  size: number
  signature: string
  platforms: {
    platform: 'tauri-macos' | 'tauri-windows' | 'tauri-linux'
    url: string
    cid: string
    hash: string
    size: number
  }[]
  minVersion?: string
  breaking?: boolean
  migrations?: string[]
}

export interface NodeUpdateState {
  checking: boolean
  available: boolean
  downloading: boolean
  downloaded: boolean
  installing: boolean
  error: string | null
  currentVersion: string
  latestVersion: string | null
  updateInfo: NodeUpdateInfo | null
  downloadProgress: number
}

// Default Config

const DEFAULT_CONFIG: NodeUpdateConfig = {
  enabled: true,
  checkInterval: 1800000, // 30 minutes (nodes should update faster)
  autoDownload: true,
  autoInstall: true, // Nodes can auto-install
  channel: 'stable',
  dwsEndpoint: 'https://dws.jejunetwork.org',
}

const CURRENT_VERSION = '0.1.0'

// Node Update Service

export class NodeUpdateService {
  private config: NodeUpdateConfig
  private state: NodeUpdateState
  private checkInterval: ReturnType<typeof setInterval> | null = null
  private downloadController: AbortController | null = null

  constructor(config: Partial<NodeUpdateConfig> = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config }
    this.state = {
      checking: false,
      available: false,
      downloading: false,
      downloaded: false,
      installing: false,
      error: null,
      currentVersion: CURRENT_VERSION,
      latestVersion: null,
      updateInfo: null,
      downloadProgress: 0,
    }
  }

  // Lifecycle

  start(): void {
    if (!this.config.enabled) return

    // Check immediately
    this.checkForUpdates()

    // Schedule periodic checks
    this.checkInterval = setInterval(() => {
      this.checkForUpdates()
    }, this.config.checkInterval)

    console.log('[NodeUpdater] Started')
  }

  stop(): void {
    if (this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = null
    }

    if (this.downloadController) {
      this.downloadController.abort()
      this.downloadController = null
    }

    console.log('[NodeUpdater] Stopped')
  }

  // Update Check

  async checkForUpdates(): Promise<NodeUpdateInfo | null> {
    if (this.state.checking) return null

    this.state.checking = true
    this.state.error = null

    try {
      // Fetch update manifest from DWS
      const manifest = await this.fetchManifest()

      if (!manifest) {
        this.state.checking = false
        return null
      }

      // Find latest version for current channel
      const update = this.findLatestUpdate(manifest)

      if (!update || !this.isNewerVersion(update.version)) {
        this.state.available = false
        this.state.latestVersion = update?.version ?? this.state.currentVersion
        this.state.checking = false
        return null
      }

      // Check minimum version requirement
      if (update.minVersion && !this.meetsMinVersion(update.minVersion)) {
        this.state.error = `Update requires version ${update.minVersion}+. Manual update needed.`
        this.state.checking = false
        return null
      }

      // Update available
      this.state.available = true
      this.state.latestVersion = update.version
      this.state.updateInfo = update
      this.state.checking = false

      console.log(`[NodeUpdater] Update available: ${update.version}`)

      // Auto-download if enabled
      if (this.config.autoDownload) {
        await this.downloadUpdate()
      }

      return update
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : 'Check failed'
      this.state.checking = false
      return null
    }
  }

  private async fetchManifest(): Promise<{
    versions: NodeUpdateInfo[]
  } | null> {
    const platform = this.detectPlatform()
    const url = `${this.config.dwsEndpoint}/pkg/node/updates.json`

    const response = await fetch(url, {
      headers: {
        'X-Platform': platform,
        'X-Version': this.state.currentVersion,
        'X-Channel': this.config.channel,
      },
    })

    if (!response.ok) return null

    return response.json()
  }

  private findLatestUpdate(manifest: {
    versions: NodeUpdateInfo[]
  }): NodeUpdateInfo | null {
    const platform = this.detectPlatform()

    const applicable = manifest.versions.filter((v) => {
      if (this.config.channel === 'stable' && v.channel !== 'stable')
        return false
      if (this.config.channel === 'beta' && v.channel === 'nightly')
        return false
      return v.platforms.some((p) => p.platform === platform)
    })

    if (applicable.length === 0) return null

    // Sort by version descending
    applicable.sort((a, b) => this.compareVersions(b.version, a.version))

    return applicable[0]
  }

  private isNewerVersion(version: string): boolean {
    return this.compareVersions(version, this.state.currentVersion) > 0
  }

  private meetsMinVersion(min: string): boolean {
    return this.compareVersions(this.state.currentVersion, min) >= 0
  }

  private compareVersions(a: string, b: string): number {
    const partsA = a.split('.').map(Number)
    const partsB = b.split('.').map(Number)

    for (let i = 0; i < Math.max(partsA.length, partsB.length); i++) {
      const partA = partsA[i] ?? 0
      const partB = partsB[i] ?? 0
      if (partA > partB) return 1
      if (partA < partB) return -1
    }

    return 0
  }

  private detectPlatform(): 'tauri-macos' | 'tauri-windows' | 'tauri-linux' {
    if (typeof navigator === 'undefined') return 'tauri-linux'

    const ua = navigator.userAgent.toLowerCase()
    if (ua.includes('mac')) return 'tauri-macos'
    if (ua.includes('win')) return 'tauri-windows'
    return 'tauri-linux'
  }

  // Download

  async downloadUpdate(): Promise<boolean> {
    if (!this.state.updateInfo) return false
    if (this.state.downloading) return false
    if (this.state.downloaded) return true

    const platform = this.detectPlatform()
    const asset = this.state.updateInfo.platforms.find(
      (p) => p.platform === platform,
    )

    if (!asset) {
      this.state.error = 'No update available for this platform'
      return false
    }

    this.state.downloading = true
    this.state.downloadProgress = 0
    this.state.error = null

    try {
      this.downloadController = new AbortController()

      // Download from DWS via CID first
      let response = await fetch(
        `${this.config.dwsEndpoint}/storage/download/${asset.cid}`,
        {
          signal: this.downloadController.signal,
        },
      )

      if (!response.ok) {
        response = await fetch(asset.url, {
          signal: this.downloadController.signal,
        })
      }

      if (!response.ok) {
        throw new Error('Download failed')
      }

      const contentLength = parseInt(
        response.headers.get('content-length') ?? '0',
        10,
      )
      const reader = response.body?.getReader()

      if (!reader) {
        throw new Error('Cannot read response')
      }

      const chunks: Uint8Array[] = []
      let receivedLength = 0

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        chunks.push(value)
        receivedLength += value.length

        if (contentLength > 0) {
          this.state.downloadProgress = (receivedLength / contentLength) * 100
        }
      }

      const data = new Uint8Array(receivedLength)
      let position = 0
      for (const chunk of chunks) {
        data.set(chunk, position)
        position += chunk.length
      }

      // Verify hash
      const hash = await this.computeHash(data)
      if (hash !== asset.hash) {
        throw new Error('Update verification failed: hash mismatch')
      }

      // Save update
      await this.saveUpdate(data)

      this.state.downloading = false
      this.state.downloaded = true
      this.state.downloadProgress = 100
      this.downloadController = null

      console.log('[NodeUpdater] Update downloaded and verified')

      // Auto-install if enabled
      if (this.config.autoInstall) {
        await this.installUpdate()
      }

      return true
    } catch (error) {
      this.state.downloading = false
      this.state.error =
        error instanceof Error ? error.message : 'Download failed'
      this.downloadController = null
      return false
    }
  }

  private async computeHash(data: Uint8Array): Promise<string> {
    // Create a new ArrayBuffer-backed Uint8Array for crypto.subtle compatibility
    const buffer = new ArrayBuffer(data.length)
    const view = new Uint8Array(buffer)
    view.set(data)
    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer)
    const hashArray = new Uint8Array(hashBuffer)
    return Array.from(hashArray)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  private async saveUpdate(data: Uint8Array): Promise<void> {
    if ('__TAURI__' in globalThis) {
      // Dynamic import: Tauri FS plugin only available in Tauri runtime
      const { writeFile, BaseDirectory } = await import('@tauri-apps/plugin-fs')
      await writeFile('pending_update', data, {
        baseDir: BaseDirectory.AppData,
      })
    }
  }

  // Install

  async installUpdate(): Promise<boolean> {
    if (!this.state.downloaded) return false
    if (this.state.installing) return false

    this.state.installing = true

    try {
      if ('__TAURI__' in globalThis) {
        // Dynamic import: Tauri API only available in Tauri runtime
        const { invoke } = await import('@tauri-apps/api/core')

        // Run migrations if any
        if (this.state.updateInfo?.migrations?.length) {
          for (const migration of this.state.updateInfo.migrations) {
            await invoke('run_migration', { migration })
          }
        }

        // Install update
        await invoke('install_update')

        // App will restart, so we won't reach here
      }

      this.state.installing = false
      return true
    } catch (error) {
      this.state.installing = false
      this.state.error =
        error instanceof Error ? error.message : 'Install failed'
      return false
    }
  }

  // State

  getState(): NodeUpdateState {
    return { ...this.state }
  }

  getConfig(): NodeUpdateConfig {
    return { ...this.config }
  }

  updateConfig(updates: Partial<NodeUpdateConfig>): void {
    this.config = { ...this.config, ...updates }

    if (updates.checkInterval && this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = setInterval(() => {
        this.checkForUpdates()
      }, this.config.checkInterval)
    }
  }
}

// Singleton

let updateService: NodeUpdateService | null = null

export function getNodeUpdateService(
  config?: Partial<NodeUpdateConfig>,
): NodeUpdateService {
  if (!updateService) {
    updateService = new NodeUpdateService(config)
  }
  return updateService
}

export function resetNodeUpdateService(): void {
  if (updateService) {
    updateService.stop()
    updateService = null
  }
}
