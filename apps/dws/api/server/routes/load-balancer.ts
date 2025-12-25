/**
 * Load Balancer Routes
 * Expose load balancer metrics and management endpoints
 */

import { Elysia, t } from 'elysia'
import {
  LoadBalancer,
  LocalInstanceFactory,
  type ServiceDefinition,
} from '../../../src/load-balancer'

let loadBalancer: LoadBalancer | null = null

function getLoadBalancer(): LoadBalancer {
  if (!loadBalancer) {
    loadBalancer = new LoadBalancer(
      {
        minInstances: parseInt(process.env.LB_MIN_INSTANCES ?? '0', 10),
        maxInstances: parseInt(process.env.LB_MAX_INSTANCES ?? '10', 10),
        targetConcurrency: parseInt(
          process.env.LB_TARGET_CONCURRENCY ?? '10',
          10,
        ),
        scaleUpThreshold: parseInt(
          process.env.LB_SCALE_UP_THRESHOLD ?? '5',
          10,
        ),
        scaleDownThreshold: parseInt(
          process.env.LB_SCALE_DOWN_THRESHOLD ?? '300000',
          10,
        ),
        scaleUpCooldown: parseInt(
          process.env.LB_SCALE_UP_COOLDOWN ?? '30000',
          10,
        ),
        scaleDownCooldown: parseInt(
          process.env.LB_SCALE_DOWN_COOLDOWN ?? '300000',
          10,
        ),
        requestTimeout: parseInt(process.env.LB_REQUEST_TIMEOUT ?? '30000', 10),
        connectionDrainTimeout: parseInt(
          process.env.LB_DRAIN_TIMEOUT ?? '30000',
          10,
        ),
        maxQueueSize: parseInt(process.env.LB_MAX_QUEUE_SIZE ?? '1000', 10),
      },
      new LocalInstanceFactory(),
    )
    loadBalancer.start()
  }
  return loadBalancer
}

export function createLoadBalancerRouter() {
  const lb = getLoadBalancer()

  return new Elysia({ prefix: '/lb' })
    .get('/health', () => {
      const stats = lb.getStats()
      return {
        status: 'healthy' as const,
        service: 'dws-load-balancer',
        activeInstances: stats.activeInstances,
        totalInstances: stats.totalInstances,
        queuedRequests: stats.queuedRequests,
        requestsPerSecond: stats.requestsPerSecond,
      }
    })

    .get('/stats', () => {
      const stats = lb.getStats()
      const circuits = lb.getCircuitStats()

      return {
        ...stats,
        circuits,
      }
    })

    .get('/services/:serviceId/instances', ({ params }) => {
      const instances = lb.getInstances(params.serviceId)
      return {
        serviceId: params.serviceId,
        instances: instances.map((i) => ({
          id: i.id,
          endpoint: i.endpoint,
          status: i.status,
          region: i.region,
          currentConnections: i.currentConnections,
          totalRequests: i.totalRequests,
          avgLatencyMs: i.avgLatencyMs,
          startedAt: i.startedAt,
          lastActivityAt: i.lastActivityAt,
        })),
      }
    })

    .post(
      '/services',
      ({ body }) => {
        const service: ServiceDefinition = {
          id: body.id,
          name: body.name,
          type: body.type ?? 'worker',
          entrypoint: body.entrypoint,
          env: body.env ?? {},
          ports: body.ports ?? [3000],
          resources: {
            cpuCores: body.cpuCores ?? 1,
            memoryMb: body.memoryMb ?? 512,
          },
          scaling: {
            minInstances: body.minInstances ?? 0,
            maxInstances: body.maxInstances ?? 10,
            targetConcurrency: body.targetConcurrency ?? 10,
            scaleUpThreshold: body.scaleUpThreshold ?? 5,
            scaleDownDelay: body.scaleDownDelay ?? 60000,
          },
          healthCheck: {
            path: body.healthCheckPath ?? '/health',
            port: body.healthCheckPort ?? 3000,
            interval: body.healthCheckInterval ?? 10000,
            timeout: body.healthCheckTimeout ?? 30000,
            healthyThreshold: body.healthyThreshold ?? 2,
            unhealthyThreshold: body.unhealthyThreshold ?? 3,
          },
        }

        lb.registerService(service)

        return {
          success: true,
          service: { id: service.id, name: service.name },
        }
      },
      {
        body: t.Object({
          id: t.String(),
          name: t.String(),
          type: t.Optional(
            t.Union([
              t.Literal('worker'),
              t.Literal('api'),
              t.Literal('proxy'),
              t.Literal('scraper'),
              t.Literal('rpc'),
              t.Literal('vpn'),
            ]),
          ),
          entrypoint: t.Optional(t.String()),
          env: t.Optional(t.Record(t.String(), t.String())),
          ports: t.Optional(t.Array(t.Number())),
          minInstances: t.Optional(t.Number()),
          maxInstances: t.Optional(t.Number()),
          targetConcurrency: t.Optional(t.Number()),
          scaleUpThreshold: t.Optional(t.Number()),
          scaleDownDelay: t.Optional(t.Number()),
          healthCheckPath: t.Optional(t.String()),
          healthCheckPort: t.Optional(t.Number()),
          healthCheckInterval: t.Optional(t.Number()),
          healthCheckTimeout: t.Optional(t.Number()),
          healthyThreshold: t.Optional(t.Number()),
          unhealthyThreshold: t.Optional(t.Number()),
          cpuCores: t.Optional(t.Number()),
          memoryMb: t.Optional(t.Number()),
        }),
      },
    )

    .delete('/services/:serviceId', ({ params }) => {
      lb.unregisterService(params.serviceId)
      return { success: true }
    })

    .post('/route/:serviceId', async ({ params, request, set }) => {
      const response = await lb.route(params.serviceId, request)
      set.status = response.status
      return response
    })

    .get('/events', () => {
      const stats = lb.getStats()
      return {
        events: stats.scalingEvents,
      }
    })
}

export function shutdownLoadBalancer(): void {
  if (loadBalancer) {
    loadBalancer.stop()
    loadBalancer = null
  }
}
