/**
 * Updater Service Tests
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'

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
            channel: 'stable',
            changelog: 'New features',
            size: 50000000,
            signature: '0xsig',
            assets: [
              {
                platform: 'web',
                url: 'https://example.com/web.zip',
                cid: 'Qm123',
                hash: '0xhash',
                size: 50000000,
              },
            ],
          },
          {
            version: '1.5.0',
            releaseDate: '2024-01-01',
            channel: 'stable',
            changelog: 'Bug fixes',
            size: 45000000,
            signature: '0xsig2',
            assets: [],
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
  isDesktop: () => false,
}))

// Import after mocks are set
const { UpdateService, getUpdateService, resetUpdateService } = await import(
  './index'
)

describe('UpdateService', () => {
  let updater: InstanceType<typeof UpdateService>

  beforeEach(() => {
    resetUpdateService()
    updater = new UpdateService()
    mockFetch.mockClear()
  })

  afterEach(() => {
    updater.stop()
  })

  describe('configuration', () => {
    it('should get default config via getState', () => {
      const state = updater.getState()

      expect(state.checking).toBe(false)
      expect(state.available).toBe(false)
      expect(state.downloading).toBe(false)
      expect(state.currentVersion).toBeDefined()
    })

    it('should accept custom config', () => {
      const customUpdater = new UpdateService({
        checkInterval: 60000,
        autoDownload: false,
        channel: 'beta',
      })

      expect(customUpdater).toBeDefined()
      customUpdater.stop()
    })
  })

  describe('version checking', () => {
    it('should check for updates', async () => {
      const update = await updater.checkForUpdates()

      expect(update).not.toBeNull()
      expect(mockFetch).toHaveBeenCalled()
    })

    it('should detect available update', async () => {
      await updater.checkForUpdates()
      const state = updater.getState()

      expect(state.available).toBe(true)
      expect(state.latestVersion).toBe('2.0.0')
    })

    it('should report no update when current is latest', async () => {
      mockFetch.mockResolvedValueOnce({
        ok: true,
        json: () =>
          Promise.resolve({
            versions: [
              {
                version: '0.0.1',
                releaseDate: '2024-01-01',
                channel: 'stable',
                changelog: '',
                size: 0,
                signature: '',
                assets: [
                  {
                    platform: 'web',
                    url: 'https://example.com/web.zip',
                    cid: 'Qm123',
                    hash: '0x',
                    size: 1000,
                  },
                ],
              },
            ],
          }),
      })

      const update = await updater.checkForUpdates()

      expect(update).toBeNull()
    })
  })

  describe('lifecycle', () => {
    it('should start periodic checking', () => {
      const customUpdater = new UpdateService({ checkInterval: 100000 })
      customUpdater.start()

      const state = customUpdater.getState()
      expect(state).toBeDefined()
      customUpdater.stop()
    })

    it('should stop periodic checking', () => {
      updater.start()
      updater.stop()

      // No errors should be thrown
    })
  })

  describe('event handling', () => {
    it('should notify on check complete', async () => {
      let notified = false
      updater.addListener({
        onCheckComplete: () => {
          notified = true
        },
      })

      await updater.checkForUpdates()

      expect(notified).toBe(true)
    })

    it('should handle fetch failures gracefully', async () => {
      // Create a fresh updater instance
      const errorUpdater = new UpdateService()
      mockFetch.mockImplementation(() =>
        Promise.reject(new Error('Network error')),
      )

      // Should not throw, returns null instead
      const result = await errorUpdater.checkForUpdates()
      errorUpdater.stop()

      expect(result).toBeNull()

      // Restore mock for subsequent tests
      mockFetch.mockImplementation(() =>
        Promise.resolve({
          ok: true,
          json: () =>
            Promise.resolve({
              versions: [],
            }),
        }),
      )
    })
  })

  describe('singleton', () => {
    it('should return same instance', () => {
      const service1 = getUpdateService()
      const service2 = getUpdateService()

      expect(service1).toBe(service2)
    })

    it('should reset instance', () => {
      const service1 = getUpdateService()
      resetUpdateService()
      const service2 = getUpdateService()

      expect(service1).not.toBe(service2)
    })
  })
})
