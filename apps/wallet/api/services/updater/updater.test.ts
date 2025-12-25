/**
 * Updater Service Tests
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { UpdaterService } from './index'

// Mock fetch
const mockFetch = mock(() =>
  Promise.resolve({
    ok: true,
    json: () =>
      Promise.resolve({
        versions: [
          {
            version: '2.0.0',
            releaseDate: '2024-01-15',
            notes: 'New features',
            downloads: {
              web: 'https://example.com/web.zip',
              desktop: 'https://example.com/desktop.zip',
              extension: 'https://example.com/extension.zip',
            },
          },
          {
            version: '1.5.0',
            releaseDate: '2024-01-01',
            notes: 'Bug fixes',
            downloads: {},
          },
        ],
      }),
  }),
)

globalThis.fetch = mockFetch as typeof fetch

// Mock platform detection
mock.module('../../../web/platform/detection', () => ({
  getPlatformInfo: () => ({
    type: 'web',
    category: 'web',
  }),
}))

describe('UpdaterService', () => {
  let updater: UpdaterService

  beforeEach(() => {
    updater = new UpdaterService('1.0.0')
    mockFetch.mockClear()
  })

  afterEach(() => {
    updater.stop()
  })

  describe('configuration', () => {
    it('should get default config', () => {
      const config = updater.getConfig()

      expect(config.enabled).toBe(true)
      expect(config.checkInterval).toBeGreaterThan(0)
      expect(config.autoDownload).toBe(true)
      expect(config.autoInstall).toBe(false)
    })

    it('should update config', () => {
      updater.updateConfig({ autoDownload: false })

      const config = updater.getConfig()
      expect(config.autoDownload).toBe(false)
    })
  })

  describe('version checking', () => {
    it('should check for updates', async () => {
      const hasUpdate = await updater.checkForUpdate()

      expect(hasUpdate).toBe(true)
      expect(mockFetch).toHaveBeenCalled()
    })

    it('should detect available update', async () => {
      await updater.checkForUpdate()
      const update = updater.getAvailableUpdate()

      expect(update).toBeDefined()
      expect(update?.version).toBe('2.0.0')
    })

    it('should report no update when current is latest', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            versions: [
              { version: '1.0.0', releaseDate: '2024-01-01', downloads: {} },
            ],
          }),
      })

      const hasUpdate = await updater.checkForUpdate()

      expect(hasUpdate).toBe(false)
    })

    it('should include pre-releases when configured', async () => {
      updater.updateConfig({ preRelease: true })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            versions: [
              {
                version: '2.1.0-beta.1',
                releaseDate: '2024-01-20',
                preRelease: true,
                downloads: {},
              },
              { version: '2.0.0', releaseDate: '2024-01-15', downloads: {} },
            ],
          }),
      })

      await updater.checkForUpdate()
      const update = updater.getAvailableUpdate()

      expect(update?.version).toBe('2.1.0-beta.1')
    })
  })

  describe('update lifecycle', () => {
    it('should download update', async () => {
      await updater.checkForUpdate()

      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1000)),
      })

      await updater.downloadUpdate()
      const status = updater.getStatus()

      expect(status.downloadProgress).toBe(100)
    })

    it('should report download progress', async () => {
      await updater.checkForUpdate()

      const progressUpdates: number[] = []
      updater.on('onDownloadProgress', (progress) => {
        progressUpdates.push(progress)
      })

      mockFetch.mockResolvedValueOnce({
        ok: true,
        arrayBuffer: () => Promise.resolve(new ArrayBuffer(1000)),
      })

      await updater.downloadUpdate()

      expect(progressUpdates.length).toBeGreaterThan(0)
    })

    it('should report status', () => {
      const status = updater.getStatus()

      expect(status.currentVersion).toBe('1.0.0')
      expect(status.lastCheck).toBeNull()
    })
  })

  describe('event handling', () => {
    it('should notify on update available', async () => {
      let notified = false
      updater.on('onUpdateAvailable', () => {
        notified = true
      })

      await updater.checkForUpdate()

      expect(notified).toBe(true)
    })

    it('should notify on check complete', async () => {
      let notified = false
      updater.on('onCheckComplete', () => {
        notified = true
      })

      await updater.checkForUpdate()

      expect(notified).toBe(true)
    })
  })

  describe('auto-update', () => {
    it('should start periodic checking', () => {
      updater.updateConfig({ checkInterval: 1000 })
      updater.start()

      // Service should be running
      expect(updater.getStatus().currentVersion).toBe('1.0.0')
    })

    it('should stop periodic checking', () => {
      updater.start()
      updater.stop()

      // No errors should be thrown
    })
  })

  describe('version comparison', () => {
    it('should correctly compare versions', () => {
      expect(updater.isNewerVersion('2.0.0', '1.0.0')).toBe(true)
      expect(updater.isNewerVersion('1.0.0', '2.0.0')).toBe(false)
      expect(updater.isNewerVersion('1.0.1', '1.0.0')).toBe(true)
      expect(updater.isNewerVersion('1.1.0', '1.0.9')).toBe(true)
      expect(updater.isNewerVersion('1.0.0', '1.0.0')).toBe(false)
    })
  })
})
