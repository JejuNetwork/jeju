/**
 * Edge Service Tests
 */

import { afterEach, beforeEach, describe, expect, it, mock } from 'bun:test'
import { WalletEdgeService } from './index'

// Mock platform detection
mock.module('../../../web/platform/detection', () => ({
  getPlatformInfo: () => ({
    type: 'web',
    category: 'extension',
  }),
}))

// Mock eden
mock.module('../../../lib/eden', () => ({
  API_URLS: { dws: 'https://mock-dws.test' },
  fetchApi: mock(() =>
    Promise.resolve({
      assets: [
        { cid: 'Qm123', name: 'test.js', mimeType: 'application/javascript' },
      ],
    }),
  ),
}))

// Mock secure storage
mock.module('../../../web/platform/secure-storage', () => ({
  secureStorage: {
    get: mock(() => Promise.resolve(null)),
    set: mock(() => Promise.resolve()),
  },
}))

// Mock WebSocket
class MockWebSocket {
  static OPEN = 1
  readyState = MockWebSocket.OPEN
  onopen: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onclose: (() => void) | null = null
  onerror: (() => void) | null = null
  send = mock(() => {})
  close = mock(() => {
    this.onclose?.()
  })
}

globalThis.WebSocket = MockWebSocket as unknown as typeof WebSocket

// Mock fetch
const mockFetch = mock(() =>
  Promise.resolve({
    ok: true,
    arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)),
  }),
)

globalThis.fetch = mockFetch as typeof fetch

// Mock indexedDB
const mockStore = new Map<string, { key: string; data: Uint8Array }>()
const mockTransaction = {
  objectStore: () => ({
    put: (data: { key: string; data: Uint8Array }) => {
      mockStore.set(data.key, data)
      return { onsuccess: null, onerror: null }
    },
    get: (key: string) => {
      const result = mockStore.get(key)
      const request = {
        result,
        onsuccess: null as (() => void) | null,
        onerror: null,
      }
      setTimeout(() => request.onsuccess?.(), 0)
      return request
    },
    delete: (key: string) => {
      mockStore.delete(key)
      return { onsuccess: null, onerror: null }
    },
  }),
}

const mockDB = {
  transaction: () => mockTransaction,
  objectStoreNames: { contains: () => true },
  createObjectStore: mock(() => {}),
}

globalThis.indexedDB = {
  open: () => {
    const request = {
      result: mockDB,
      onsuccess: null as (() => void) | null,
      onerror: null,
      onupgradeneeded: null,
    }
    setTimeout(() => request.onsuccess?.(), 0)
    return request
  },
} as IDBFactory

describe('WalletEdgeService', () => {
  let edge: WalletEdgeService

  beforeEach(() => {
    edge = new WalletEdgeService('https://mock-dws.test')
    mockStore.clear()
  })

  afterEach(async () => {
    await edge.stop()
  })

  describe('configuration', () => {
    it('should get default config based on platform', () => {
      const config = edge.getConfig()

      expect(config.enabled).toBe(true)
      expect(config.maxCacheSizeBytes).toBeGreaterThan(0)
      expect(config.maxBandwidthMbps).toBeGreaterThan(0)
    })

    it('should update config', async () => {
      await edge.updateConfig({ maxCacheSizeBytes: 100 * 1024 * 1024 })

      const config = edge.getConfig()
      expect(config.maxCacheSizeBytes).toBe(100 * 1024 * 1024)
    })

    it('should disable edge service', async () => {
      await edge.updateConfig({ enabled: false })

      const config = edge.getConfig()
      expect(config.enabled).toBe(false)
    })
  })

  describe('lifecycle', () => {
    it('should start and report running status', async () => {
      await edge.start()

      const stats = edge.getStats()
      expect(stats.status).toBe('running')
    })

    it('should stop and report stopped status', async () => {
      await edge.start()
      await edge.stop()

      const stats = edge.getStats()
      expect(stats.status).toBe('stopped')
    })

    it('should pause and resume', async () => {
      await edge.start()

      edge.pause()
      expect(edge.getStats().status).toBe('paused')

      edge.resume()
      expect(edge.getStats().status).toBe('running')
    })

    it('should not start if disabled', async () => {
      await edge.updateConfig({ enabled: false })
      await edge.start()

      const stats = edge.getStats()
      expect(stats.status).toBe('stopped')
    })
  })

  describe('caching', () => {
    it('should cache asset', async () => {
      const data = new Uint8Array([1, 2, 3, 4, 5])
      await edge.cacheAsset('Qmtest123', data, {
        name: 'test',
        mimeType: 'text/plain',
      })

      const cached = await edge.getCachedAsset('Qmtest123')
      expect(cached).toBeDefined()
    })

    it('should return null for non-cached asset', async () => {
      const cached = await edge.getCachedAsset('Qmnotexist')
      expect(cached).toBeNull()
    })

    it('should get cache info', async () => {
      const data = new Uint8Array([1, 2, 3])
      await edge.cacheAsset('Qmtest123', data, { name: 'test' })

      const info = edge.getCacheInfo()
      expect(info.length).toBeGreaterThan(0)
      expect(info[0].cid).toBe('Qmtest123')
    })

    it('should clear cache', async () => {
      const data = new Uint8Array([1, 2, 3])
      await edge.cacheAsset('Qmtest123', data)

      await edge.clearCache()

      const info = edge.getCacheInfo()
      expect(info.length).toBe(0)
    })

    it('should increment access count on get', async () => {
      const data = new Uint8Array([1, 2, 3])
      await edge.cacheAsset('Qmtest123', data)

      await edge.getCachedAsset('Qmtest123')
      await edge.getCachedAsset('Qmtest123')

      const info = edge.getCacheInfo()
      const asset = info.find((a) => a.cid === 'Qmtest123')
      expect(asset?.accessCount).toBe(2)
    })
  })

  describe('stats', () => {
    it('should track uptime while running', async () => {
      await edge.start()
      await new Promise((r) => setTimeout(r, 100))

      const stats = edge.getStats()
      expect(stats.uptime).toBeGreaterThan(0)
    })

    it('should track bytes served', async () => {
      await edge.start()
      const data = new Uint8Array([1, 2, 3, 4, 5])
      await edge.cacheAsset('Qmtest', data)
      await edge.getCachedAsset('Qmtest')

      const stats = edge.getStats()
      expect(stats.requestsServed).toBe(1)
    })

    it('should report zero uptime when stopped', () => {
      const stats = edge.getStats()
      expect(stats.uptime).toBe(0)
    })
  })
})
