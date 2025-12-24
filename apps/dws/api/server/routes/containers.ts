/**
 * Container Execution HTTP Routes
 * REST API for serverless and dedicated container execution
 */

import { expectValid } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import {
  analyzeDeduplication,
  type ComputeNode,
  cancelExecution,
  type ExecutionRequest,
  estimateCost,
  getAllNodes,
  getAllPoolStats,
  getCacheStats,
  getExecution,
  getExecutionResult,
  getSchedulerStats,
  getSystemStats,
  listExecutions,
  registerNode,
  runContainer,
  warmContainers,
} from '../../containers'
import {
  containerCostEstimateSchema,
  containerExecutionRequestSchema,
  type JSONValue,
  jejuAddressHeaderSchema,
  nodeRegistrationSchema,
  warmContainersRequestSchema,
} from '../../shared'

function extractHeaders(request: Request): Record<string, string> {
  const headers: Record<string, string> = {}
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value
  })
  return headers
}

export function createContainerRouter() {
  return (
    new Elysia({ prefix: '/containers' })
      // Health & Status

      .get('/health', () => {
        const stats = getSystemStats()
        return {
          status: 'healthy',
          service: 'container-execution',
          pendingExecutions: stats.executor.pendingExecutions,
          completedExecutions: stats.executor.completedExecutions,
          cacheUtilization: `${stats.cache.cacheUtilization}%`,
          coldStartRate: `${stats.executor.coldStartRate}%`,
        }
      })

      .get('/stats', () => {
        return getSystemStats()
      })

      // Container Execution

      .post('/execute', async ({ body, request }) => {
        const headers = extractHeaders(request)
        const { 'x-jeju-address': userAddress } = expectValid(
          jejuAddressHeaderSchema,
          headers,
        )
        const validBody = expectValid(containerExecutionRequestSchema, body)

        const execRequest: ExecutionRequest = {
          imageRef: validBody.image,
          command: validBody.command,
          env: validBody.env,
          resources: {
            cpuCores: validBody.resources?.cpuCores ?? 1,
            memoryMb: validBody.resources?.memoryMb ?? 512,
            storageMb: validBody.resources?.storageMb ?? 1024,
            gpuType: validBody.resources?.gpuType,
            gpuCount: validBody.resources?.gpuCount,
          },
          mode: validBody.mode,
          timeout: validBody.timeout,
          input: validBody.input as JSONValue | undefined,
          webhook: validBody.webhook,
        }

        const result = await runContainer(execRequest, userAddress)

        return {
          executionId: result.executionId,
          instanceId: result.instanceId,
          status: result.status,
          output: result.output,
          exitCode: result.exitCode,
          metrics: {
            ...result.metrics,
            wasColdStart: result.metrics.wasColdStart,
          },
        }
      })

      .get('/executions', ({ request }) => {
        const headers = extractHeaders(request)
        const { 'x-jeju-address': userAddress } = expectValid(
          jejuAddressHeaderSchema,
          headers,
        )
        const executions = listExecutions(userAddress)

        return {
          executions: executions.map((e) => ({
            executionId: e.executionId,
            image: e.request.imageRef,
            status: e.status,
            submittedAt: e.submittedAt,
            startedAt: e.startedAt,
          })),
          total: executions.length,
        }
      })

      .get('/executions/:id', ({ params }) => {
        const executionId = params.id

        // Check pending first
        const pending = getExecution(executionId)
        if (pending) {
          return {
            executionId: pending.executionId,
            image: pending.request.imageRef,
            status: pending.status,
            submittedAt: pending.submittedAt,
            startedAt: pending.startedAt,
            instanceId: pending.instanceId,
          }
        }

        // Check completed
        const result = getExecutionResult(executionId)
        if (result) {
          return result
        }

        throw new Error('Execution not found')
      })

      .post('/executions/:id/cancel', ({ params }) => {
        const executionId = params.id
        const cancelled = cancelExecution(executionId)

        if (!cancelled) {
          throw new Error('Execution not found or cannot be cancelled')
        }

        return { executionId, status: 'cancelled' }
      })

      // Cost Estimation

      .post('/estimate', async ({ body }) => {
        const validBody = expectValid(containerCostEstimateSchema, body)

        const cost = estimateCost(
          validBody.resources,
          validBody.durationMs,
          validBody.expectColdStart,
        )

        return {
          estimatedCost: cost.toString(),
          estimatedCostEth: (Number(cost) / 1e18).toFixed(18),
          breakdown: {
            durationMs: validBody.durationMs,
            resources: validBody.resources,
            coldStartPenalty: validBody.expectColdStart,
          },
        }
      })

      // Warm Pool Management

      .get('/pools', () => {
        const pools = getAllPoolStats()
        return { pools, total: pools.length }
      })

      .post('/warm', async ({ body, request }) => {
        const headers = extractHeaders(request)
        const { 'x-jeju-address': userAddress } = expectValid(
          jejuAddressHeaderSchema,
          headers,
        )
        const validBody = expectValid(warmContainersRequestSchema, body)

        await warmContainers(
          validBody.image,
          validBody.count,
          {
            cpuCores: validBody.resources?.cpuCores ?? 1,
            memoryMb: validBody.resources?.memoryMb ?? 512,
            storageMb: validBody.resources?.storageMb ?? 1024,
          },
          userAddress,
        )

        return {
          message: 'Warming request queued',
          image: validBody.image,
          count: validBody.count,
        }
      })

      // Cache Management

      .get('/cache', () => {
        const stats = getCacheStats()
        return stats
      })

      .get('/cache/deduplication', () => {
        const analysis = analyzeDeduplication()
        return {
          ...analysis,
          savedBytes: analysis.savedBytes,
          savedMb: Math.round(analysis.savedBytes / (1024 * 1024)),
        }
      })

      // Node Management

      .get('/nodes', () => {
        const nodes = getAllNodes()
        return {
          nodes: nodes.map((n) => ({
            nodeId: n.nodeId,
            region: n.region,
            zone: n.zone,
            status: n.status,
            resources: {
              totalCpu: n.resources.totalCpu,
              availableCpu: n.resources.availableCpu,
              totalMemoryMb: n.resources.totalMemoryMb,
              availableMemoryMb: n.resources.availableMemoryMb,
            },
            containers: n.containers.size,
            cachedImages: n.cachedImages.size,
            lastHeartbeat: n.lastHeartbeat,
            reputation: n.reputation,
          })),
          total: nodes.length,
        }
      })

      .post('/nodes', async ({ body, set }) => {
        const validBody = expectValid(nodeRegistrationSchema, body)

        const node: ComputeNode = {
          nodeId: validBody.nodeId,
          address: validBody.address,
          endpoint: validBody.endpoint,
          region: validBody.region,
          zone: validBody.zone,
          resources: {
            totalCpu: validBody.totalCpu,
            totalMemoryMb: validBody.totalMemoryMb,
            totalStorageMb: validBody.totalStorageMb,
            availableCpu: validBody.totalCpu,
            availableMemoryMb: validBody.totalMemoryMb,
            availableStorageMb: validBody.totalStorageMb,
            gpuTypes: validBody.gpuTypes ?? [],
          },
          capabilities: validBody.capabilities ?? [],
          containers: new Map(),
          cachedImages: new Set(),
          lastHeartbeat: Date.now(),
          status: 'online',
          reputation: 100,
        }

        registerNode(node)

        set.status = 201
        return { nodeId: node.nodeId, status: 'registered' }
      })

      .get('/scheduler', () => {
        return getSchedulerStats()
      })
  )
}

export type ContainerRoutes = ReturnType<typeof createContainerRouter>
