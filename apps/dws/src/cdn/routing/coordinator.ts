/**
 * CDN Coordinator Server
 */

import { cors } from '@elysiajs/cors'
import { getRpcUrl, isProductionEnv } from '@jejunetwork/config'
import { Elysia } from 'elysia'
import {
  type Address,
  createPublicClient,
  createWalletClient,
  http,
  type PublicClient,
  parseAbi,
  type WalletClient,
} from 'viem'
import { type PrivateKeyAccount, privateKeyToAccount } from 'viem/accounts'
import { base, baseSepolia, localhost } from 'viem/chains'
import { z } from 'zod'
import { type GeoRouter, getGeoRouter } from './geo-router'

function inferChainFromRpcUrl(rpcUrl: string) {
  if (rpcUrl.includes('base-sepolia') || rpcUrl.includes('84532')) {
    return baseSepolia
  }
  if (rpcUrl.includes('base') && !rpcUrl.includes('localhost')) {
    return base
  }
  return localhost
}

import type { CDNRegion } from '@jejunetwork/types'
import type {
  ConnectedEdgeNode,
  CoordinatorConfig,
  EdgeNodeMetrics,
  InvalidationProgress,
  InvalidationRequest,
  RouteRequest,
} from '../types'

const CDN_REGISTRY_ABI = parseAbi([
  'function getEdgeNode(bytes32 nodeId) view returns ((bytes32 nodeId, address operator, string endpoint, uint8 region, uint8 providerType, uint8 status, uint256 stake, uint256 registeredAt, uint256 lastSeen, uint256 agentId))',
  'function getActiveNodesInRegion(uint8 region) view returns (bytes32[])',
  'function completeInvalidation(bytes32 requestId, uint256 nodesProcessed) external',
])

const InvalidationResultSchema = z.object({
  pathsInvalidated: z.number().optional(),
  success: z.boolean().optional(),
  error: z.string().optional(),
})

export class CDNCoordinator {
  private config: CoordinatorConfig
  private router: GeoRouter
  private account: PrivateKeyAccount
  private registryAddress: Address
  private chain: typeof base | typeof baseSepolia | typeof localhost
  private publicClient: PublicClient
  private walletClient: WalletClient
  private invalidations = new Map<string, InvalidationProgress>()
  private usageByProvider = new Map<
    string,
    { bytesEgress: number; requests: number; lastReported: number }
  >()
  private elysiaApp: ReturnType<typeof Elysia.prototype.use>

  constructor(config: CoordinatorConfig) {
    this.config = config
    this.router = getGeoRouter()
    this.elysiaApp = new Elysia() as ReturnType<typeof Elysia.prototype.use>

    const privateKey = process.env.PRIVATE_KEY
    if (!privateKey) throw new Error('PRIVATE_KEY required')
    if (!privateKey.startsWith('0x')) throw new Error('PRIVATE_KEY must start with 0x')
    this.account = privateKeyToAccount(privateKey as `0x${string}`)
    this.chain = inferChainFromRpcUrl(config.rpcUrl)
    this.registryAddress = config.registryAddress

    this.publicClient = createPublicClient({
      chain: this.chain,
      transport: http(config.rpcUrl),
    }) as PublicClient
    this.walletClient = createWalletClient({
      account: this.account,
      chain: this.chain,
      transport: http(config.rpcUrl),
    }) as WalletClient

    this.setupRoutes()
    this.startHealthChecker()
    this.startSettlementLoop()
  }

  private setupRoutes(): void {
    const CORS_ORIGINS = process.env.CORS_ORIGINS?.split(',').filter(Boolean)
    const isProduction = isProductionEnv()

    this.elysiaApp.use(
      cors({
        origin: isProduction && CORS_ORIGINS?.length ? CORS_ORIGINS : true,
        credentials: true,
      }),
    )

    this.elysiaApp.get('/health', () => ({
      status: 'healthy',
      service: 'cdn-coordinator',
      nodeCount: this.router.getNodeCount(),
      regionStats: this.router.getRegionStats(),
    }))

    this.elysiaApp.post('/nodes/register', async ({ body }) => {
      const b = body as {
        nodeId: string
        address: string
        endpoint: string
        region: CDNRegion
        providerType: string
      }
      const nodeIdBytes = b.nodeId.startsWith('0x')
        ? b.nodeId
        : `0x${b.nodeId.padStart(64, '0')}`

      const onChainNode = await this.publicClient.readContract({
        address: this.registryAddress,
        abi: CDN_REGISTRY_ABI,
        functionName: 'getEdgeNode',
        args: [nodeIdBytes as `0x${string}`],
      })

      // Result is a tuple: [nodeId, operator, endpoint, region, providerType, status, stake, registeredAt, lastSeen, agentId]
      const nodeData = onChainNode as readonly [string, Address, string, number, number, number, bigint, bigint, bigint, bigint]
      const operator = nodeData[1]

      if (
        !onChainNode ||
        operator === '0x0000000000000000000000000000000000000000'
      ) {
        return { success: false, error: 'Node not registered on-chain' }
      }

      const node: ConnectedEdgeNode = {
        nodeId: b.nodeId,
        address: b.address as Address,
        endpoint: b.endpoint,
        region: b.region,
        metrics: {
          nodeId: b.nodeId,
          region: b.region,
          uptime: 0,
          requestsTotal: 0,
          requestsPerSecond: 0,
          bytesServedTotal: 0,
          bandwidthMbps: 0,
          cacheHits: 0,
          cacheMisses: 0,
          cacheHitRate: 0,
          cacheSizeBytes: 0,
          cacheEntries: 0,
          avgLatencyMs: 0,
          p50LatencyMs: 0,
          p95LatencyMs: 0,
          p99LatencyMs: 0,
          errorCount: 0,
          errorRate: 0,
          currentLoad: 0,
          cpuUsage: 0,
          memoryUsage: 0,
          activeConnections: 0,
          status: 'healthy',
          lastUpdated: Date.now(),
        },
        lastSeen: Date.now(),
        connectionId: crypto.randomUUID(),
      }

      this.router.registerNode(node)
      return { success: true, connectionId: node.connectionId }
    })

    this.elysiaApp.post(
      '/nodes/:nodeId/heartbeat',
      async ({ params, body }) => {
        this.router.updateNodeMetrics(params.nodeId, body as EdgeNodeMetrics)
        return { success: true }
      },
    )

    this.elysiaApp.post('/route', async ({ body, set }) => {
      const decision = this.router.route(body as RouteRequest)
      if (!decision) {
        set.status = 503
        return { error: 'No available nodes' }
      }
      return decision
    })

    this.elysiaApp.post('/route/multi', async ({ body, set }) => {
      const b = body as RouteRequest & { count?: number }
      const decisions = this.router.routeMultiple(b, b.count ?? 3)
      if (decisions.length === 0) {
        set.status = 503
        return { error: 'No available nodes' }
      }
      return { routes: decisions }
    })

    this.elysiaApp.post('/invalidate', async ({ body }) => {
      const request = body as InvalidationRequest
      const requestId = request.requestId ?? crypto.randomUUID()
      const targetNodes = request.regions
        ? request.regions.flatMap((r) => this.router.getNodesByRegion(r))
        : this.router.getAllNodes()

      const progress: InvalidationProgress = {
        requestId,
        status: 'processing',
        nodesTotal: targetNodes.length,
        nodesProcessed: 0,
        pathsInvalidated: 0,
        startedAt: Date.now(),
        errors: [],
      }

      this.invalidations.set(requestId, progress)
      this.broadcastInvalidation(request, targetNodes, progress)

      return { requestId, status: 'processing', nodesTotal: targetNodes.length }
    })

    this.elysiaApp.get('/invalidate/:requestId', async ({ params, set }) => {
      const progress = this.invalidations.get(params.requestId)
      if (!progress) {
        set.status = 404
        return { error: 'Invalidation request not found' }
      }
      return progress
    })

    this.elysiaApp.get('/nodes', ({ query }) => {
      const region = query.region as CDNRegion | undefined
      const nodes = region
        ? this.router.getNodesByRegion(region)
        : this.router.getAllNodes()
      return { nodes, count: nodes.length }
    })

    this.elysiaApp.get('/nodes/:nodeId', ({ params, set }) => {
      const nodes = this.router.getAllNodes()
      const node = nodes.find((n) => n.nodeId === params.nodeId)
      if (!node) {
        set.status = 404
        return { error: 'Node not found' }
      }
      return node
    })

    this.elysiaApp.get('/regions', () => this.router.getRegionStats())

    this.elysiaApp.get('/metrics', () => this.getMetrics())

    this.elysiaApp.get('/metrics/prometheus', () => {
      const stats = this.router.getRegionStats()
      const lines: string[] = [
        '# HELP cdn_coordinator_nodes_total Total connected nodes',
        '# TYPE cdn_coordinator_nodes_total gauge',
        `cdn_coordinator_nodes_total ${this.router.getNodeCount()}`,
      ]

      for (const [region, s] of Object.entries(stats)) {
        lines.push(
          `cdn_coordinator_nodes_region{region="${region}"} ${s.nodes}`,
        )
        lines.push(
          `cdn_coordinator_load_region{region="${region}"} ${s.avgLoad}`,
        )
        lines.push(
          `cdn_coordinator_latency_region{region="${region}"} ${s.avgLatency}`,
        )
      }

      return new Response(lines.join('\n'), {
        headers: { 'Content-Type': 'text/plain; version=0.0.4' },
      })
    })
  }

  private async broadcastInvalidation(
    request: InvalidationRequest,
    nodes: ConnectedEdgeNode[],
    progress: InvalidationProgress,
  ): Promise<void> {
    await Promise.allSettled(
      nodes.map(async (node) => {
        try {
          const response = await fetch(`${node.endpoint}/invalidate`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ paths: request.paths }),
            signal: AbortSignal.timeout(10000),
          })

          if (!response.ok) throw new Error(`HTTP ${response.status}`)

          const parseResult = InvalidationResultSchema.safeParse(
            await response.json(),
          )
          progress.nodesProcessed++
          progress.pathsInvalidated += parseResult.success
            ? (parseResult.data.pathsInvalidated ?? request.paths.length)
            : request.paths.length
        } catch (e) {
          progress.errors.push({
            nodeId: node.nodeId,
            error: e instanceof Error ? e.message : 'Unknown error',
          })
          progress.nodesProcessed++
        }
      }),
    )

    progress.status = 'completed'
    progress.completedAt = Date.now()

    const requestIdBytes = request.requestId.startsWith('0x')
      ? request.requestId
      : `0x${request.requestId.padStart(64, '0')}`

    await this.walletClient.writeContract({
      address: this.registryAddress,
      abi: CDN_REGISTRY_ABI,
      functionName: 'completeInvalidation',
      args: [requestIdBytes as `0x${string}`, BigInt(progress.nodesProcessed)],
      chain: this.chain,
      account: this.account,
    })
  }

  private startHealthChecker(): void {
    setInterval(() => {
      const nodes = this.router.getAllNodes()
      const staleThreshold = Date.now() - this.config.healthCheckInterval * 3

      for (const node of nodes) {
        if (node.lastSeen < staleThreshold) {
          node.metrics.status = 'unhealthy'
          this.router.updateNodeMetrics(node.nodeId, node.metrics)
        }
      }
    }, this.config.healthCheckInterval)
  }

  private startSettlementLoop(): void {
    setInterval(() => {
      for (const [_provider, usage] of this.usageByProvider) {
        if (usage.bytesEgress >= this.config.minSettlementAmount) {
          usage.bytesEgress = 0
          usage.requests = 0
          usage.lastReported = Date.now()
        }
      }
    }, this.config.settlementInterval)
  }

  private getMetrics(): Record<string, number | Record<string, number>> {
    const regionStats = this.router.getRegionStats()
    const totalNodes = this.router.getNodeCount()
    const healthyNodes = this.router
      .getAllNodes()
      .filter((n) => n.metrics.status === 'healthy').length

    return {
      totalNodes,
      healthyNodes,
      unhealthyNodes: totalNodes - healthyNodes,
      pendingInvalidations: this.invalidations.size,
      nodesByRegion: Object.fromEntries(
        Object.entries(regionStats).map(([r, s]) => [r, s.nodes]),
      ),
    }
  }

  start(): void {
    this.elysiaApp.listen(this.config.port)
  }

  getApp() {
    return this.elysiaApp
  }
}

export async function startCoordinator(): Promise<CDNCoordinator> {
  const config: CoordinatorConfig = {
    port: parseInt(process.env.CDN_COORDINATOR_PORT ?? '4021', 10),
    registryAddress: (process.env.CDN_REGISTRY_ADDRESS ??
      '0x0000000000000000000000000000000000000000') as Address,
    billingAddress: (process.env.CDN_BILLING_ADDRESS ??
      '0x0000000000000000000000000000000000000000') as Address,
    rpcUrl: process.env.RPC_URL ?? getRpcUrl(),
    healthCheckInterval: parseInt(
      process.env.CDN_HEALTH_CHECK_INTERVAL ?? '60000',
      10,
    ),
    maxNodesPerRegion: parseInt(
      process.env.CDN_MAX_NODES_PER_REGION ?? '100',
      10,
    ),
    settlementInterval: parseInt(
      process.env.CDN_SETTLEMENT_INTERVAL ?? '3600000',
      10,
    ),
    minSettlementAmount: parseInt(
      process.env.CDN_MIN_SETTLEMENT_AMOUNT ?? '1000000',
      10,
    ),
  }

  const coordinator = new CDNCoordinator(config)
  coordinator.start()
  return coordinator
}

if (import.meta.main) {
  startCoordinator().catch(console.error)
}
