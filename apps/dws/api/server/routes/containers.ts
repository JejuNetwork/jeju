/**
 * Container Execution HTTP Routes
 * REST API for serverless and dedicated container execution
 */

import { expectValid } from '@jejunetwork/types'
import { Elysia } from 'elysia'
import type { Address } from 'viem'
import { verifyMessage } from 'viem'
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
  ContainerDeployConfigSchema,
  getContainerProvisioner,
} from '../../containers/provisioner'
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

      .get('/health', async () => {
        const stats = await getSystemStats()
        return {
          status: 'healthy',
          service: 'container-execution',
          pendingExecutions: stats.executor.pendingExecutions,
          completedExecutions: stats.executor.completedExecutions,
          cacheUtilization: `${stats.cache.cacheUtilization}%`,
          coldStartRate: `${stats.executor.coldStartRate}%`,
        }
      })

      .get('/stats', async () => {
        return await getSystemStats()
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

      .get('/cache/deduplication', async () => {
        const analysis = await analyzeDeduplication()
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

      // ==========================================================================
      // Container Provisioning (Heroku-like deployment)
      // ==========================================================================

      .post('/provision', async ({ body, request, set }) => {
        const headers = extractHeaders(request)
        const signature = headers['x-signature']
        const timestamp = headers['x-timestamp']
        const address = headers['x-address'] as Address

        if (!signature || !timestamp || !address) {
          set.status = 401
          return { error: 'Missing authentication headers' }
        }

        // Verify signature
        const timestampNum = parseInt(timestamp, 10)
        if (Date.now() - timestampNum > 300000) {
          set.status = 401
          return { error: 'Request expired' }
        }

        const rawBody = body as {
          config: unknown
          owner: string
          machineType?: string
        }
        const message = JSON.stringify({
          containerConfig: rawBody.config,
          timestamp: timestampNum,
        })

        const isValid = await verifyMessage({
          address,
          message,
          signature: signature as `0x${string}`,
        })

        if (!isValid) {
          set.status = 401
          return { error: 'Invalid signature' }
        }

        const provisioner = getContainerProvisioner()
        const validConfig = ContainerDeployConfigSchema.parse(rawBody.config)

        // If machineType is provided, use it
        if (rawBody.machineType) {
          const machineType = provisioner.getMachineType(rawBody.machineType)
          if (machineType) {
            validConfig.hardware = machineType.hardware
          }
        }

        const container = await provisioner.provision(address, validConfig)

        set.status = 201
        return {
          containerId: container.id,
          status: container.status,
          endpoints: {
            rpc: container.externalEndpoint ?? container.internalEndpoint ?? '',
            ws: container.endpoints.find((e) => e.includes('ws')) ?? '',
          },
        }
      })

      .get('/provision/:id', async ({ params }) => {
        const containerId = params.id
        const provisioner = getContainerProvisioner()
        const container = provisioner.getContainer(containerId)

        if (!container) {
          throw new Error('Container not found')
        }

        return {
          containerId: container.id,
          status: container.status,
          replicas: container.currentReplicas,
          endpoints: container.endpoints,
          externalEndpoint: container.externalEndpoint,
          internalEndpoint: container.internalEndpoint,
          metrics: container.metrics,
          createdAt: container.createdAt,
          startedAt: container.startedAt,
        }
      })

      .post('/provision/:id/scale', async ({ params, body, request, set }) => {
        const headers = extractHeaders(request)
        const address = headers['x-address'] as Address

        if (!address) {
          set.status = 401
          return { error: 'Missing x-address header' }
        }

        const containerId = params.id
        const { replicas } = body as { replicas: number }

        const provisioner = getContainerProvisioner()
        await provisioner.scale(containerId, address, replicas)

        const container = provisioner.getContainer(containerId)
        return {
          containerId,
          status: container?.status ?? 'unknown',
          replicas: container?.currentReplicas ?? 0,
        }
      })

      .post('/provision/:id/stop', async ({ params, request, set }) => {
        const headers = extractHeaders(request)
        const address = headers['x-address'] as Address

        if (!address) {
          set.status = 401
          return { error: 'Missing x-address header' }
        }

        const containerId = params.id
        const provisioner = getContainerProvisioner()
        await provisioner.stop(containerId, address)

        return { containerId, status: 'stopped' }
      })

      .post('/provision/:id/start', async ({ params, request, set }) => {
        const headers = extractHeaders(request)
        const address = headers['x-address'] as Address

        if (!address) {
          set.status = 401
          return { error: 'Missing x-address header' }
        }

        const containerId = params.id
        const provisioner = getContainerProvisioner()
        await provisioner.start(containerId, address)

        const container = provisioner.getContainer(containerId)
        return {
          containerId,
          status: container?.status ?? 'unknown',
          endpoints: container?.endpoints ?? [],
        }
      })

      .delete('/provision/:id', async ({ params, request, set }) => {
        const headers = extractHeaders(request)
        const address = headers['x-address'] as Address

        if (!address) {
          set.status = 401
          return { error: 'Missing x-address header' }
        }

        const containerId = params.id
        const provisioner = getContainerProvisioner()
        await provisioner.terminate(containerId, address)

        return { containerId, status: 'terminated' }
      })

      .get('/provision', ({ request }) => {
        const headers = extractHeaders(request)
        const address = headers['x-address'] as Address | undefined

        const provisioner = getContainerProvisioner()
        const containers = address
          ? provisioner.getContainersByOwner(address)
          : provisioner.listContainers()

        return {
          containers: containers.map((c) => ({
            containerId: c.id,
            status: c.status,
            replicas: c.currentReplicas,
            image: `${c.config.image}:${c.config.tag}`,
            createdAt: c.createdAt,
          })),
          total: containers.length,
        }
      })

      .get('/provision/stats', () => {
        const provisioner = getContainerProvisioner()
        return provisioner.getStats()
      })

      .get('/machine-types', () => {
        const provisioner = getContainerProvisioner()
        const types = provisioner.getMachineTypes()
        return {
          machineTypes: types.map((mt) => ({
            id: mt.id,
            name: mt.name,
            description: mt.description,
            pricePerHour: mt.pricePerHourWei.toString(),
            pricePerHourEth: (Number(mt.pricePerHourWei) / 1e18).toFixed(6),
            hardware: {
              cpu: mt.hardware.cpuCores,
              memory: `${Math.round(mt.hardware.memoryMb / 1024)}GB`,
              storage: `${Math.round(mt.hardware.storageMb / 1024)}GB`,
              gpu:
                mt.hardware.gpuType !== 'none'
                  ? `${mt.hardware.gpuCount}x ${mt.hardware.gpuType}`
                  : 'None',
              tee:
                mt.hardware.teePlatform !== 'none'
                  ? mt.hardware.teePlatform
                  : 'None',
            },
            available: mt.available,
          })),
          total: types.length,
        }
      })
  )
}

export type ContainerRoutes = ReturnType<typeof createContainerRouter>
