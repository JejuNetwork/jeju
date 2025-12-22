/**
 * Auto-Update Service
 *
 * Handles automatic updates for the wallet app.
 * Pulls from the Jeju package registry and DWS for decentralized updates.
 */

import { getPlatformInfo, isDesktop } from '../../platform/detection'
import type { PlatformType } from '../../platform/types'

// ============================================================================
// Types
// ============================================================================

export interface UpdateConfig {
  enabled: boolean
  checkInterval: number // ms between checks
  autoDownload: boolean // Download updates automatically
  autoInstall: boolean // Install without prompting (desktop only)
  preRelease: boolean // Include pre-release versions
  channel: 'stable' | 'beta' | 'nightly'
  dwsEndpoint: string // DWS endpoint for update manifests
  pkgRegistry: string // Package registry address
}

export interface UpdateInfo {
  version: string
  releaseDate: string
  channel: 'stable' | 'beta' | 'nightly'
  changelog: string
  size: number
  signature: string
  assets: {
    platform: PlatformType
    url: string
    cid: string
    hash: string
    size: number
  }[]
  requiredVersion?: string // Minimum version to update from
  breaking?: boolean // Breaking changes requiring migration
}

export interface UpdateState {
  checking: boolean
  available: boolean
  downloading: boolean
  downloaded: boolean
  installing: boolean
  error: string | null
  currentVersion: string
  latestVersion: string | null
  updateInfo: UpdateInfo | null
  downloadProgress: number
}

export interface UpdateListener {
  onCheckStart?: () => void
  onCheckComplete?: (available: boolean, info: UpdateInfo | null) => void
  onDownloadStart?: () => void
  onDownloadProgress?: (progress: number) => void
  onDownloadComplete?: () => void
  onInstallStart?: () => void
  onInstallComplete?: () => void
  onError?: (error: Error) => void
}

// Event arguments mapped by event name
type UpdateEventArgs = {
  onCheckStart: []
  onCheckComplete: [available: boolean, info: UpdateInfo | null]
  onDownloadStart: []
  onDownloadProgress: [progress: number]
  onDownloadComplete: []
  onInstallStart: []
  onInstallComplete: []
  onError: [error: Error]
}

// ============================================================================
// Default Config
// ============================================================================

const DEFAULT_CONFIG: UpdateConfig = {
  enabled: true,
  checkInterval: 3600000, // 1 hour
  autoDownload: true,
  autoInstall: false, // Require user confirmation
  preRelease: false,
  channel: 'stable',
  dwsEndpoint: 'https://dws.jejunetwork.org',
  pkgRegistry: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512',
}

const CURRENT_VERSION = '0.1.0'

// ============================================================================
// Update Service
// ============================================================================

export class UpdateService {
  private config: UpdateConfig
  private state: UpdateState
  private checkInterval: ReturnType<typeof setInterval> | null = null
  private listeners: Set<UpdateListener> = new Set()
  private downloadController: AbortController | null = null

  constructor(config: Partial<UpdateConfig> = {}) {
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

  // ============================================================================
  // Lifecycle
  // ============================================================================

  start(): void {
    if (!this.config.enabled) return

    // Check immediately
    this.checkForUpdates()

    // Schedule periodic checks
    this.checkInterval = setInterval(() => {
      this.checkForUpdates()
    }, this.config.checkInterval)
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
  }

  // ============================================================================
  // Update Check
  // ============================================================================

  async checkForUpdates(): Promise<UpdateInfo | null> {
    if (this.state.checking) return null

    this.state.checking = true
    this.state.error = null
    this.notify('onCheckStart')

    try {
      // Fetch update manifest from DWS
      const manifest = await this.fetchManifest()

      if (!manifest) {
        this.state.checking = false
        this.notify('onCheckComplete', false, null)
        return null
      }

      // Find latest version for current channel
      const update = this.findLatestUpdate(manifest)

      if (!update) {
        this.state.available = false
        this.state.latestVersion = this.state.currentVersion
        this.state.checking = false
        this.notify('onCheckComplete', false, null)
        return null
      }

      // Check if update is needed
      if (!this.isNewerVersion(update.version)) {
        this.state.available = false
        this.state.latestVersion = update.version
        this.state.checking = false
        this.notify('onCheckComplete', false, null)
        return null
      }

      // Verify we can update from current version
      if (
        update.requiredVersion &&
        !this.meetsRequirement(update.requiredVersion)
      ) {
        this.state.error = `Update requires version ${update.requiredVersion} or higher`
        this.state.checking = false
        this.notify('onError', new Error(this.state.error))
        return null
      }

      // Update available
      this.state.available = true
      this.state.latestVersion = update.version
      this.state.updateInfo = update
      this.state.checking = false

      this.notify('onCheckComplete', true, update)

      // Auto-download if enabled
      if (this.config.autoDownload) {
        this.downloadUpdate()
      }

      return update
    } catch (error) {
      this.state.error = error instanceof Error ? error.message : 'Check failed'
      this.state.checking = false
      this.notify(
        'onError',
        error instanceof Error ? error : new Error(this.state.error),
      )
      return null
    }
  }

  private async fetchManifest(): Promise<{ versions: UpdateInfo[] } | null> {
    const platform = getPlatformInfo()
    const url = `${this.config.dwsEndpoint}/pkg/wallet/updates.json`

    const response = await fetch(url, {
      headers: {
        'X-Platform': platform.type,
        'X-Version': this.state.currentVersion,
        'X-Channel': this.config.channel,
      },
    }).catch(() => null)

    if (!response?.ok) {
      // Fallback to on-chain registry
      return this.fetchFromRegistry()
    }

    return response.json()
  }

  private async fetchFromRegistry(): Promise<{
    versions: UpdateInfo[]
  } | null> {
    // In production, this would query the PackageRegistry contract
    // For now, return null to indicate no updates
    return null
  }

  private findLatestUpdate(manifest: {
    versions: UpdateInfo[]
  }): UpdateInfo | null {
    const platform = getPlatformInfo()

    const applicable = manifest.versions.filter((v) => {
      // Filter by channel
      if (!this.config.preRelease && v.channel !== 'stable') return false
      if (this.config.channel === 'stable' && v.channel !== 'stable')
        return false
      if (this.config.channel === 'beta' && v.channel === 'nightly')
        return false

      // Filter by platform
      return v.assets.some((a) => a.platform === platform.type)
    })

    if (applicable.length === 0) return null

    // Sort by version (semver)
    applicable.sort((a, b) => this.compareVersions(b.version, a.version))

    return applicable[0]
  }

  private isNewerVersion(version: string): boolean {
    return this.compareVersions(version, this.state.currentVersion) > 0
  }

  private meetsRequirement(required: string): boolean {
    return this.compareVersions(this.state.currentVersion, required) >= 0
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

  // ============================================================================
  // Download
  // ============================================================================

  async downloadUpdate(): Promise<boolean> {
    if (!this.state.updateInfo) return false
    if (this.state.downloading) return false
    if (this.state.downloaded) return true

    const platform = getPlatformInfo()
    const asset = this.state.updateInfo.assets.find(
      (a) => a.platform === platform.type,
    )

    if (!asset) {
      this.state.error = 'No update available for this platform'
      return false
    }

    this.state.downloading = true
    this.state.downloadProgress = 0
    this.state.error = null
    this.notify('onDownloadStart')

    try {
      this.downloadController = new AbortController()

      // Try DWS first (via CID)
      let response = await fetch(
        `${this.config.dwsEndpoint}/storage/download/${asset.cid}`,
        {
          signal: this.downloadController.signal,
        },
      ).catch(() => null)

      // Fallback to direct URL
      if (!response?.ok) {
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
          this.notify('onDownloadProgress', this.state.downloadProgress)
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
        throw new Error('Update verification failed')
      }

      // Save to platform storage
      await this.saveUpdate(data)

      this.state.downloading = false
      this.state.downloaded = true
      this.state.downloadProgress = 100
      this.downloadController = null

      this.notify('onDownloadComplete')

      // Auto-install if enabled (desktop only)
      if (this.config.autoInstall && isDesktop()) {
        this.installUpdate()
      }

      return true
    } catch (error) {
      this.state.downloading = false
      this.state.error =
        error instanceof Error ? error.message : 'Download failed'
      this.downloadController = null
      this.notify(
        'onError',
        error instanceof Error ? error : new Error(this.state.error),
      )
      return false
    }
  }

  cancelDownload(): void {
    if (this.downloadController) {
      this.downloadController.abort()
      this.downloadController = null
      this.state.downloading = false
      this.state.downloadProgress = 0
    }
  }

  private async computeHash(data: Uint8Array): Promise<string> {
    const hashBuffer = await crypto.subtle.digest(
      'SHA-256',
      data.buffer as ArrayBuffer,
    )
    const hashArray = new Uint8Array(hashBuffer)
    return Array.from(hashArray)
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
  }

  private async saveUpdate(data: Uint8Array): Promise<void> {
    const platform = getPlatformInfo()

    if (platform.category === 'desktop' && '__TAURI__' in globalThis) {
      // Tauri v2: Use invoke to call a custom command that handles file writing
      // BaseDirectory.AppData = 14 in Tauri v2
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('save_pending_update', { data: Array.from(data) })
    } else if (typeof indexedDB !== 'undefined') {
      const db = await this.getIndexedDB()
      const tx = db.transaction('updates', 'readwrite')
      tx.objectStore('updates').put({ key: 'pending', data })
    }
  }

  // ============================================================================
  // Install
  // ============================================================================

  async installUpdate(): Promise<boolean> {
    if (!this.state.downloaded) return false
    if (this.state.installing) return false

    const platform = getPlatformInfo()

    // Desktop: Use Tauri's updater
    if (platform.category === 'desktop' && '__TAURI__' in globalThis) {
      return this.installDesktopUpdate()
    }

    // Extension: Prompt browser to update
    if (platform.category === 'extension') {
      return this.installExtensionUpdate()
    }

    // Mobile: Redirect to app store
    if (platform.category === 'mobile') {
      return this.installMobileUpdate()
    }

    // Web: Just refresh
    if (platform.category === 'web') {
      window.location.reload()
      return true
    }

    return false
  }

  private async installDesktopUpdate(): Promise<boolean> {
    this.state.installing = true
    this.notify('onInstallStart')

    try {
      // Tauri v2: invoke is in @tauri-apps/api/core
      const { invoke } = await import('@tauri-apps/api/core')
      await invoke('install_update')

      this.state.installing = false
      this.notify('onInstallComplete')
      return true
    } catch (error) {
      this.state.installing = false
      this.state.error =
        error instanceof Error ? error.message : 'Install failed'
      this.notify(
        'onError',
        error instanceof Error ? error : new Error(this.state.error),
      )
      return false
    }
  }

  private async installExtensionUpdate(): Promise<boolean> {
    // Extensions auto-update via browser - just notify user
    const platform = getPlatformInfo()

    if (platform.type === 'chrome-extension') {
      // Chrome extension
      chrome.runtime.reload()
    } else if (platform.type === 'firefox-extension') {
      // Firefox extension - browser global available in Firefox extension context
      const firefoxBrowser = globalThis as typeof globalThis & {
        browser: { runtime: { reload: () => void } }
      }
      firefoxBrowser.browser.runtime.reload()
    }

    return true
  }

  private async installMobileUpdate(): Promise<boolean> {
    const platform = getPlatformInfo()

    // Open app store page
    if (platform.type === 'capacitor-ios') {
      window.open(
        'https://apps.apple.com/app/jeju-wallet/id123456789',
        '_blank',
      )
    } else if (platform.type === 'capacitor-android') {
      window.open(
        'https://play.google.com/store/apps/details?id=org.jejunetwork.wallet',
        '_blank',
      )
    }

    return true
  }

  // ============================================================================
  // State & Listeners
  // ============================================================================

  getState(): UpdateState {
    return { ...this.state }
  }

  getConfig(): UpdateConfig {
    return { ...this.config }
  }

  updateConfig(updates: Partial<UpdateConfig>): void {
    this.config = { ...this.config, ...updates }

    // Restart check interval if changed
    if (updates.checkInterval && this.checkInterval) {
      clearInterval(this.checkInterval)
      this.checkInterval = setInterval(() => {
        this.checkForUpdates()
      }, this.config.checkInterval)
    }
  }

  addListener(listener: UpdateListener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify<E extends keyof UpdateEventArgs>(
    event: E,
    ...args: UpdateEventArgs[E]
  ): void {
    for (const listener of this.listeners) {
      const handler = listener[event]
      if (handler) {
        ;(handler as (...args: UpdateEventArgs[E]) => void)(...args)
      }
    }
  }

  private async getIndexedDB(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open('jeju_updates', 1)
      request.onerror = () => reject(request.error)
      request.onsuccess = () => resolve(request.result)
      request.onupgradeneeded = () => {
        const db = request.result
        if (!db.objectStoreNames.contains('updates')) {
          db.createObjectStore('updates', { keyPath: 'key' })
        }
      }
    })
  }
}

// ============================================================================
// Singleton
// ============================================================================

let updateService: UpdateService | null = null

export function getUpdateService(
  config?: Partial<UpdateConfig>,
): UpdateService {
  if (!updateService) {
    updateService = new UpdateService(config)
  }
  return updateService
}

export function resetUpdateService(): void {
  if (updateService) {
    updateService.stop()
    updateService = null
  }
}
