/**
 * Geo Router
 *
 * Routes CDN requests to the best edge node based on:
 * - Geographic proximity
 * - Node health and load
 * - Provider preferences
 * - Cost optimization
 */

import type { CDNRegion } from '@jejunetwork/types'
import type {
  ConnectedEdgeNode,
  EdgeNodeMetrics,
  RouteRequest,
  RoutingDecision,
} from '../types'

// ============================================================================
// Region Mapping
// ============================================================================

const REGION_COORDINATES: Record<CDNRegion, { lat: number; lon: number }> = {
  'us-east-1': { lat: 39.0, lon: -77.0 }, // Virginia
  'us-east-2': { lat: 40.0, lon: -83.0 }, // Ohio
  'us-west-1': { lat: 37.3, lon: -121.9 }, // California
  'us-west-2': { lat: 46.2, lon: -123.0 }, // Oregon
  'eu-west-1': { lat: 53.3, lon: -6.3 }, // Ireland
  'eu-west-2': { lat: 51.5, lon: -0.1 }, // London
  'eu-central-1': { lat: 50.1, lon: 8.7 }, // Frankfurt
  'ap-northeast-1': { lat: 35.7, lon: 139.7 }, // Tokyo
  'ap-northeast-2': { lat: 37.5, lon: 127.0 }, // Seoul
  'ap-southeast-1': { lat: 1.3, lon: 103.8 }, // Singapore
  'ap-southeast-2': { lat: -33.9, lon: 151.2 }, // Sydney
  'ap-south-1': { lat: 19.1, lon: 72.9 }, // Mumbai
  'sa-east-1': { lat: -23.5, lon: -46.6 }, // São Paulo
  'af-south-1': { lat: -33.9, lon: 18.4 }, // Cape Town
  'me-south-1': { lat: 26.1, lon: 50.6 }, // Bahrain
  global: { lat: 0, lon: 0 }, // Anycast
}

const COUNTRY_TO_REGION: Record<string, CDNRegion> = {
  // North America
  US: 'us-east-1',
  CA: 'us-east-1',
  MX: 'us-west-2',

  // Europe
  GB: 'eu-west-2',
  IE: 'eu-west-1',
  DE: 'eu-central-1',
  FR: 'eu-west-1',
  NL: 'eu-central-1',
  BE: 'eu-central-1',
  IT: 'eu-central-1',
  ES: 'eu-west-1',
  PT: 'eu-west-1',
  CH: 'eu-central-1',
  AT: 'eu-central-1',
  PL: 'eu-central-1',
  SE: 'eu-west-1',
  NO: 'eu-west-1',
  DK: 'eu-west-1',
  FI: 'eu-west-1',

  // Asia Pacific
  JP: 'ap-northeast-1',
  KR: 'ap-northeast-2',
  CN: 'ap-northeast-1',
  HK: 'ap-southeast-1',
  TW: 'ap-northeast-1',
  SG: 'ap-southeast-1',
  MY: 'ap-southeast-1',
  TH: 'ap-southeast-1',
  VN: 'ap-southeast-1',
  ID: 'ap-southeast-1',
  PH: 'ap-southeast-1',
  AU: 'ap-southeast-2',
  NZ: 'ap-southeast-2',
  IN: 'ap-south-1',

  // South America
  BR: 'sa-east-1',
  AR: 'sa-east-1',
  CL: 'sa-east-1',
  CO: 'us-east-1',

  // Middle East
  AE: 'me-south-1',
  SA: 'me-south-1',
  IL: 'eu-central-1',

  // Africa
  ZA: 'af-south-1',
  EG: 'eu-central-1',
  NG: 'af-south-1',
  KE: 'af-south-1',
}

// ============================================================================
// Geo Router
// ============================================================================

export class GeoRouter {
  private nodes: Map<string, ConnectedEdgeNode> = new Map()
  private regionNodes: Map<CDNRegion, Set<string>> = new Map()
  private nodeScores: Map<string, number> = new Map()

  constructor() {
    // Initialize region sets
    for (const region of Object.keys(REGION_COORDINATES) as CDNRegion[]) {
      this.regionNodes.set(region, new Set())
    }
  }

  /**
   * Register an edge node
   */
  registerNode(node: ConnectedEdgeNode): void {
    this.nodes.set(node.nodeId, node)

    const regionSet = this.regionNodes.get(node.region)
    if (regionSet) {
      regionSet.add(node.nodeId)
    }

    this.updateNodeScore(node.nodeId)
  }

  /**
   * Unregister an edge node
   */
  unregisterNode(nodeId: string): void {
    const node = this.nodes.get(nodeId)
    if (node) {
      const regionSet = this.regionNodes.get(node.region)
      if (regionSet) {
        regionSet.delete(nodeId)
      }
    }
    this.nodes.delete(nodeId)
    this.nodeScores.delete(nodeId)
  }

  /**
   * Update node metrics
   */
  updateNodeMetrics(nodeId: string, metrics: EdgeNodeMetrics): void {
    const node = this.nodes.get(nodeId)
    if (node) {
      node.metrics = metrics
      node.lastSeen = Date.now()
      this.updateNodeScore(nodeId)
    }
  }

  /**
   * Find best node for request
   */
  route(request: RouteRequest): RoutingDecision | null {
    const clientRegion = this.getClientRegion(request)

    // If exact region is required, only check that specific region
    if (request.requireExactRegion && request.preferredRegion) {
      const exactRegionNodes = this.regionNodes.get(request.preferredRegion)
      if (!exactRegionNodes || exactRegionNodes.size === 0) {
        throw new Error(
          `No nodes available in required region: ${request.preferredRegion}`,
        )
      }
    }

    // Get candidate nodes
    const candidates = this.getCandidateNodes(
      clientRegion,
      request.preferredRegion,
    )

    if (candidates.length === 0) {
      return null
    }

    // Score and rank candidates
    const scored = candidates
      .map((nodeId) => {
        const node = this.nodes.get(nodeId)
        return node
          ? { nodeId, score: this.nodeScores.get(nodeId) ?? 0, node }
          : null
      })
      .filter(
        (c): c is { nodeId: string; score: number; node: ConnectedEdgeNode } =>
          c !== null && c.node.metrics.status === 'healthy',
      )
      .sort((a, b) => b.score - a.score)

    if (scored.length === 0) {
      return null
    }

    const best = scored[0]

    return {
      nodeId: best.nodeId,
      endpoint: best.node.endpoint,
      region: best.node.region,
      score: best.score,
      latencyEstimate: this.estimateLatency(clientRegion, best.node.region),
      loadScore: 100 - best.node.metrics.currentLoad,
      healthScore: best.node.metrics.cacheHitRate,
    }
  }

  /**
   * Get multiple candidate nodes for load balancing
   */
  routeMultiple(request: RouteRequest, count: number = 3): RoutingDecision[] {
    const clientRegion = this.getClientRegion(request)
    const candidates = this.getCandidateNodes(
      clientRegion,
      request.preferredRegion,
    )

    return candidates
      .map((nodeId) => {
        const node = this.nodes.get(nodeId)
        return node
          ? { nodeId, score: this.nodeScores.get(nodeId) ?? 0, node }
          : null
      })
      .filter(
        (c): c is { nodeId: string; score: number; node: ConnectedEdgeNode } =>
          c !== null && c.node.metrics.status === 'healthy',
      )
      .sort((a, b) => b.score - a.score)
      .slice(0, count)
      .map((c) => ({
        nodeId: c.nodeId,
        endpoint: c.node.endpoint,
        region: c.node.region,
        score: c.score,
        latencyEstimate: this.estimateLatency(clientRegion, c.node.region),
        loadScore: 100 - c.node.metrics.currentLoad,
        healthScore: c.node.metrics.cacheHitRate,
      }))
  }

  /**
   * Get client's region from geo info or IP
   */
  private getClientRegion(request: RouteRequest): CDNRegion {
    // Use preferred region if specified
    if (request.preferredRegion) {
      return request.preferredRegion
    }

    // Use geo location if available
    if (request.clientGeo?.countryCode) {
      const region = COUNTRY_TO_REGION[request.clientGeo.countryCode]
      if (region) {
        return region
      }
    }

    // Try to geolocate from IP
    if (request.clientIp) {
      const region = this.geolocateIP(request.clientIp)
      if (region) {
        return region
      }
    }

    // Default to global/anycast
    return 'global'
  }

  /**
   * Get candidate nodes for region
   */
  private getCandidateNodes(
    clientRegion: CDNRegion,
    preferredRegion?: CDNRegion,
  ): string[] {
    const candidates: string[] = []

    // First priority: preferred region
    if (preferredRegion) {
      const preferredNodes = this.regionNodes.get(preferredRegion)
      if (preferredNodes) {
        candidates.push(...preferredNodes)
      }
    }

    // Second priority: client's region
    const regionNodes = this.regionNodes.get(clientRegion)
    if (regionNodes) {
      for (const nodeId of regionNodes) {
        if (!candidates.includes(nodeId)) {
          candidates.push(nodeId)
        }
      }
    }

    // Third priority: nearby regions
    const nearbyRegions = this.getNearbyRegions(clientRegion)
    for (const region of nearbyRegions) {
      const nearby = this.regionNodes.get(region)
      if (nearby) {
        for (const nodeId of nearby) {
          if (!candidates.includes(nodeId)) {
            candidates.push(nodeId)
          }
        }
      }
    }

    // Fourth priority: global nodes
    const globalNodes = this.regionNodes.get('global')
    if (globalNodes) {
      for (const nodeId of globalNodes) {
        if (!candidates.includes(nodeId)) {
          candidates.push(nodeId)
        }
      }
    }

    // If still empty, add all nodes
    if (candidates.length === 0) {
      candidates.push(...this.nodes.keys())
    }

    return candidates
  }

  /**
   * Get nearby regions based on distance
   */
  private getNearbyRegions(region: CDNRegion, limit: number = 3): CDNRegion[] {
    const coords = REGION_COORDINATES[region]
    if (!coords) return []

    const distances = (
      Object.entries(REGION_COORDINATES) as [
        CDNRegion,
        { lat: number; lon: number },
      ][]
    )
      .filter(([r]) => r !== region && r !== 'global')
      .map(([r, c]) => ({
        region: r,
        distance: this.haversineDistance(coords.lat, coords.lon, c.lat, c.lon),
      }))
      .sort((a, b) => a.distance - b.distance)

    return distances.slice(0, limit).map((d) => d.region)
  }

  /**
   * Calculate haversine distance between two points
   */
  private haversineDistance(
    lat1: number,
    lon1: number,
    lat2: number,
    lon2: number,
  ): number {
    const R = 6371 // Earth's radius in km
    const dLat = this.toRad(lat2 - lat1)
    const dLon = this.toRad(lon2 - lon1)
    const a =
      Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(this.toRad(lat1)) *
        Math.cos(this.toRad(lat2)) *
        Math.sin(dLon / 2) *
        Math.sin(dLon / 2)
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
    return R * c
  }

  private toRad(deg: number): number {
    return deg * (Math.PI / 180)
  }

  /**
   * Estimate latency between regions
   */
  private estimateLatency(from: CDNRegion, to: CDNRegion): number {
    if (from === to) return 10 // Same region

    const fromCoords = REGION_COORDINATES[from]
    const toCoords = REGION_COORDINATES[to]

    if (!fromCoords || !toCoords) return 100

    // Rough estimate: 1ms per 100km + 10ms base
    const distance = this.haversineDistance(
      fromCoords.lat,
      fromCoords.lon,
      toCoords.lat,
      toCoords.lon,
    )

    return Math.round(10 + distance / 100)
  }

  /**
   * Update node score based on metrics
   */
  private updateNodeScore(nodeId: string): void {
    const node = this.nodes.get(nodeId)
    if (!node) return

    const metrics = node.metrics

    // Scoring factors:
    // - Cache hit rate (0-100): higher is better
    // - Load (0-100): lower is better
    // - Error rate (0-100): lower is better
    // - Latency: lower is better

    const cacheScore = metrics.cacheHitRate * 0.3
    const loadScore = (100 - metrics.currentLoad) * 0.25
    const errorScore = (100 - metrics.errorRate) * 0.25
    const latencyScore = Math.max(0, 100 - metrics.avgLatencyMs) * 0.2

    const totalScore = cacheScore + loadScore + errorScore + latencyScore
    this.nodeScores.set(nodeId, totalScore)
  }

  /**
   * IP geolocation based on IP ranges and optional GeoIP service
   */
  private geolocateIP(ip: string): CDNRegion | null {
    // Handle private IPs
    if (
      ip.startsWith('10.') ||
      ip.startsWith('192.168.') ||
      ip.startsWith('172.16.') ||
      ip.startsWith('172.17.') ||
      ip.startsWith('172.18.') ||
      ip.startsWith('172.19.') ||
      ip.startsWith('172.20.') ||
      ip.startsWith('172.21.') ||
      ip.startsWith('172.22.') ||
      ip.startsWith('172.23.') ||
      ip.startsWith('172.24.') ||
      ip.startsWith('172.25.') ||
      ip.startsWith('172.26.') ||
      ip.startsWith('172.27.') ||
      ip.startsWith('172.28.') ||
      ip.startsWith('172.29.') ||
      ip.startsWith('172.30.') ||
      ip.startsWith('172.31.') ||
      ip === '127.0.0.1' ||
      ip === '::1'
    ) {
      return null
    }

    // Parse IP to integer for range comparison
    const parts = ip.split('.').map(Number)
    if (parts.length !== 4 || parts.some(Number.isNaN)) {
      return null
    }

    const ipNum =
      (parts[0] << 24) + (parts[1] << 16) + (parts[2] << 8) + parts[3]

    // IP range to region mapping (simplified - based on major allocations)
    // Format: [startIP, endIP, region]
    const ipRanges: Array<[number, number, CDNRegion]> = [
      // North America (US)
      [0x01000000, 0x3dffffff, 'us-east-1'], // 1.0.0.0 - 61.255.255.255 (partial)
      [0x40000000, 0x4fffffff, 'us-west-1'], // 64.0.0.0 - 79.255.255.255

      // Europe
      [0x50000000, 0x5fffffff, 'eu-west-1'], // 80.0.0.0 - 95.255.255.255
      [0xb8000000, 0xbfffffff, 'eu-central-1'], // 184.0.0.0 - 191.255.255.255

      // Asia Pacific
      [0xa0000000, 0xa7ffffff, 'ap-northeast-1'], // 160.0.0.0 - 167.255.255.255 (Japan)
      [0x6a000000, 0x6fffffff, 'ap-southeast-1'], // 106.0.0.0 - 111.255.255.255 (China/SEA)
      [0x74000000, 0x77ffffff, 'ap-south-1'], // 116.0.0.0 - 119.255.255.255 (India)

      // South America
      [0xb4000000, 0xb7ffffff, 'sa-east-1'], // 180.0.0.0 - 183.255.255.255

      // Africa/Middle East
      [0xc0000000, 0xc7ffffff, 'me-south-1'], // 192.0.0.0 - 199.255.255.255
      [0xc8000000, 0xcfffffff, 'af-south-1'], // 200.0.0.0 - 207.255.255.255
    ]

    for (const [start, end, region] of ipRanges) {
      if (ipNum >= start && ipNum <= end) {
        return region
      }
    }

    // Default based on common cloud provider ranges
    const firstOctet = parts[0]
    if (firstOctet >= 34 && firstOctet <= 35) return 'us-east-1' // Google Cloud US
    if (firstOctet >= 52 && firstOctet <= 54) return 'us-west-1' // AWS US
    if (firstOctet >= 13 && firstOctet <= 15) return 'us-east-1' // Azure US
    if (firstOctet >= 102) return 'af-south-1' // Africa
    if (firstOctet >= 200 && firstOctet <= 223) return 'sa-east-1' // South America

    return null
  }

  // ============================================================================
  // Stats and Info
  // ============================================================================

  /**
   * Get all nodes
   */
  getAllNodes(): ConnectedEdgeNode[] {
    return [...this.nodes.values()]
  }

  /**
   * Get nodes by region
   */
  getNodesByRegion(region: CDNRegion): ConnectedEdgeNode[] {
    const nodeIds = this.regionNodes.get(region)
    if (!nodeIds) return []
    return [...nodeIds]
      .map((id) => this.nodes.get(id))
      .filter((n): n is ConnectedEdgeNode => n !== undefined)
  }

  /**
   * Get region stats
   */
  getRegionStats(): Record<
    CDNRegion,
    { nodes: number; avgLoad: number; avgLatency: number }
  > {
    const stats: Record<
      string,
      { nodes: number; avgLoad: number; avgLatency: number }
    > = {}

    for (const [region, nodeIds] of this.regionNodes) {
      const nodes = [...nodeIds]
        .map((id) => this.nodes.get(id))
        .filter(Boolean) as ConnectedEdgeNode[]

      if (nodes.length === 0) {
        stats[region] = { nodes: 0, avgLoad: 0, avgLatency: 0 }
        continue
      }

      const avgLoad =
        nodes.reduce((sum, n) => sum + n.metrics.currentLoad, 0) / nodes.length
      const avgLatency =
        nodes.reduce((sum, n) => sum + n.metrics.avgLatencyMs, 0) / nodes.length

      stats[region] = {
        nodes: nodes.length,
        avgLoad: Math.round(avgLoad),
        avgLatency: Math.round(avgLatency),
      }
    }

    return stats as Record<
      CDNRegion,
      { nodes: number; avgLoad: number; avgLatency: number }
    >
  }

  /**
   * Get total node count
   */
  getNodeCount(): number {
    return this.nodes.size
  }
}

// ============================================================================
// Factory
// ============================================================================

let globalRouter: GeoRouter | null = null

export function getGeoRouter(): GeoRouter {
  if (!globalRouter) {
    globalRouter = new GeoRouter()
  }
  return globalRouter
}

export function resetGeoRouter(): void {
  globalRouter = null
}
