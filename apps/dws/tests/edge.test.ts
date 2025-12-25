/**
 * Edge Coordination Tests
 * Tests for the wallet/node edge coordination service
 */

import { describe, expect, test } from 'bun:test'
import { app } from '../src/server'

// Test response types
interface EdgeNode {
  id: string
  nodeType: string
  platform: string
  operator?: string
  capabilities: Record<string, boolean | number>
  region: string
  status: string
}

interface EdgeHealthResponse {
  status: string
  service: string
  nodes: { total: number; online: number; offline: number }
  capacity: { totalCacheBytes: number; totalBandwidthMbps: number }
  regions: Record<string, number>
}

interface NodeIdResponse {
  nodeId: string
  status?: string
}

interface NodesListResponse {
  nodes: EdgeNode[]
}

interface NodesRegionResponse {
  nodes: Array<{ region: string }>
}

interface NodesTypeResponse {
  nodes: Array<{ nodeType: string }>
}

interface NodeDetailsResponse {
  id: string
  nodeType: string
  capabilities: { cdn: boolean }
}

interface CacheRequestResponse {
  cid: string
  targetNodes: number
}

interface CidResponse {
  cid: string
}

interface RouteResponse {
  cid: string
  endpoint: string
}

interface NodeEarnings {
  nodeId: string
  bytesServed: number
  estimatedEarnings: string
  period: string
}

interface SuccessResponse {
  success: boolean
}

describe('Edge Coordination', () => {
  let testNodeId: string

  describe('Health', () => {
    test('health endpoint returns stats', async () => {
      const response = await app.request('/edge/health')
      expect(response.ok).toBe(true)

      const data = (await response.json()) as EdgeHealthResponse
      expect(data.status).toBe('healthy')
      expect(data.service).toBe('dws-edge-coordinator')
      expect(data.nodes).toBeDefined()
      expect(data.capacity).toBeDefined()
      expect(data.regions).toBeDefined()
    })
  })

  describe('Node Registration', () => {
    test('register wallet edge node', async () => {
      const response = await app.request('/edge/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeType: 'wallet-edge',
          platform: 'tauri-macos',
          operator: '0x1234567890123456789012345678901234567890',
          capabilities: {
            proxy: true,
            torrent: true,
            cdn: true,
            rpc: true,
            storage: true,
            maxCacheBytes: 5 * 1024 * 1024 * 1024,
            maxBandwidthMbps: 50,
          },
          region: 'us-west',
        }),
      })
      expect(response.status).toBe(201)

      const data = (await response.json()) as NodeIdResponse
      expect(data.nodeId).toBeDefined()
      expect(data.status).toBe('registered')
      testNodeId = data.nodeId
    })

    test('register full node', async () => {
      const response = await app.request('/edge/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          nodeType: 'full-node',
          platform: 'tauri-linux',
          capabilities: {
            proxy: true,
            torrent: true,
            cdn: true,
            rpc: true,
            storage: true,
            maxCacheBytes: 50 * 1024 * 1024 * 1024,
            maxBandwidthMbps: 1000,
          },
          region: 'eu-west',
        }),
      })
      expect(response.status).toBe(201)

      const data = (await response.json()) as NodeIdResponse
      expect(data.nodeId).toBeDefined()
    })
  })

  describe('Node Management', () => {
    test('list all nodes', async () => {
      const response = await app.request('/edge/nodes')
      expect(response.ok).toBe(true)

      const data = (await response.json()) as NodesListResponse
      expect(data.nodes).toBeDefined()
      expect(data.nodes.length).toBeGreaterThan(0)
    })

    test('list nodes by region', async () => {
      const response = await app.request('/edge/nodes?region=us-west')
      expect(response.ok).toBe(true)

      const data = (await response.json()) as NodesRegionResponse
      for (const node of data.nodes) {
        expect(node.region).toBe('us-west')
      }
    })

    test('list nodes by type', async () => {
      const response = await app.request('/edge/nodes?type=wallet-edge')
      expect(response.ok).toBe(true)

      const data = (await response.json()) as NodesTypeResponse
      for (const node of data.nodes) {
        expect(node.nodeType).toBe('wallet-edge')
      }
    })

    test('get node details', async () => {
      const response = await app.request(`/edge/nodes/${testNodeId}`)
      expect(response.ok).toBe(true)

      const data = (await response.json()) as NodeDetailsResponse
      expect(data.id).toBe(testNodeId)
      expect(data.nodeType).toBe('wallet-edge')
      expect(data.capabilities.cdn).toBe(true)
    })
  })

  describe('Cache Management', () => {
    test('request content caching', async () => {
      const response = await app.request('/edge/cache', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cid: 'QmTestContent123',
          priority: 'high',
          regions: ['us-west', 'eu-west'],
          minReplicas: 2,
        }),
      })
      expect(response.status).toBe(202)

      const data = (await response.json()) as CacheRequestResponse
      expect(data.cid).toBe('QmTestContent123')
      expect(data.targetNodes).toBeGreaterThanOrEqual(0)
    })

    test('check cache status', async () => {
      const response = await app.request('/edge/cache/QmTestContent123')
      expect(response.ok).toBe(true)

      const data = (await response.json()) as CidResponse
      expect(data.cid).toBe('QmTestContent123')
    })
  })

  describe('Content Routing', () => {
    test('get route for content', async () => {
      const response = await app.request('/edge/route/QmTestContent123', {
        headers: { 'x-jeju-region': 'us-west' },
      })

      // May return 503 if no nodes online, which is acceptable
      if (response.ok) {
        const data = (await response.json()) as RouteResponse
        expect(data.cid).toBe('QmTestContent123')
        expect(data.endpoint).toBeDefined()
      }
    })
  })

  describe('Earnings', () => {
    test('get node earnings', async () => {
      const response = await app.request(`/edge/earnings/${testNodeId}`)
      expect(response.ok).toBe(true)

      const data = (await response.json()) as NodeEarnings
      expect(data.nodeId).toBe(testNodeId)
      expect(data.bytesServed).toBeDefined()
      expect(data.estimatedEarnings).toBeDefined()
    })

    test('earnings for non-existent node returns 404', async () => {
      // Use a valid UUID format that doesn't exist
      const response = await app.request(
        '/edge/earnings/00000000-0000-0000-0000-000000000000',
      )
      expect(response.status).toBe(404)
    })
  })

  describe('Node Cleanup', () => {
    test('unregister node', async () => {
      const response = await app.request(`/edge/nodes/${testNodeId}`, {
        method: 'DELETE',
      })
      expect(response.ok).toBe(true)

      const data = (await response.json()) as SuccessResponse
      expect(data.success).toBe(true)
    })

    test('get deleted node returns 404', async () => {
      const response = await app.request(`/edge/nodes/${testNodeId}`)
      expect(response.status).toBe(404)
    })
  })
})
