import { Elysia } from 'elysia'
import { z } from 'zod'
import {
  type ContainerInstanceRow,
  type ContainerRow,
  createContainer as dbCreateContainer,
  createContainerInstance as dbCreateInstance,
  getContainerInstance,
  listContainers as dbListContainers,
  listContainerInstances,
  updateContainerInstanceStatus,
} from '../db/client'
import {
  ContainersQuerySchema,
  CreateContainerBodySchema,
  CreateContainerInstanceBodySchema,
  expectValid,
} from '../schemas'

// Schema for container labels
const LabelsRecordSchema = z.record(z.string(), z.string())

import { requireAuth } from '../validation/access-control'

export interface ContainerImage {
  id: string
  name: string
  tag: string
  digest: string
  size: number
  platform: string
  labels?: Record<string, string>
  downloads: number
  createdAt: number
  updatedAt: number
}

export interface ContainerInstance {
  id: string
  name: string
  image: string
  status: 'running' | 'stopped' | 'building' | 'failed'
  cpu: string
  memory: string
  gpu?: string
  port?: number
  endpoint?: string
  createdAt: number
  startedAt?: number
}

function transformContainer(row: ContainerRow): ContainerImage {
  return {
    id: row.id,
    name: row.name,
    tag: row.tag,
    digest: row.digest,
    size: row.size,
    platform: row.platform,
    labels: row.labels
      ? LabelsRecordSchema.parse(JSON.parse(row.labels))
      : undefined,
    downloads: row.downloads,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

function transformInstance(row: ContainerInstanceRow): ContainerInstance {
  return {
    id: row.id,
    name: row.name,
    image: row.container_id,
    status: row.status,
    cpu: row.cpu,
    memory: row.memory,
    gpu: row.gpu ?? undefined,
    port: row.port ?? undefined,
    endpoint: row.endpoint ?? undefined,
    createdAt: row.created_at,
    startedAt: row.started_at ?? undefined,
  }
}

export const containersRoutes = new Elysia({ prefix: '/api/containers' })
  .get(
    '/',
    async ({ query }) => {
      const validated = expectValid(
        ContainersQuerySchema,
        query,
        'query params',
      )
      const containerRows = dbListContainers({
        org: validated.org,
        name: validated.q,
      })
      const containers = containerRows.map(transformContainer)
      return { containers, total: containers.length }
    },
    { detail: { tags: ['containers'], summary: 'List containers' } },
  )
  .post(
    '/',
    async ({ body, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }
      const validated = expectValid(
        CreateContainerBodySchema,
        body,
        'request body',
      )

      const row = dbCreateContainer({
        name: validated.name,
        tag: validated.tag,
        digest: validated.digest,
        size: validated.size,
        platform: validated.platform,
        labels: validated.labels,
        owner: authResult.address,
      })

      set.status = 201
      return transformContainer(row)
    },
    { detail: { tags: ['containers'], summary: 'Push container' } },
  )
  .get(
    '/instances',
    async ({ headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }
      const instanceRows = listContainerInstances({ owner: authResult.address })
      const instances = instanceRows.map(transformInstance)
      return { instances, total: instances.length }
    },
    { detail: { tags: ['containers'], summary: 'List running instances' } },
  )
  .post(
    '/instances',
    async ({ body, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }
      const validated = expectValid(
        CreateContainerInstanceBodySchema,
        body,
        'request body',
      )

      const row = dbCreateInstance({
        containerId: validated.imageId,
        name: validated.name,
        cpu: validated.cpu,
        memory: validated.memory,
        gpu: validated.gpu,
        owner: authResult.address,
      })

      // Simulate endpoint assignment on creation
      const endpoint = `https://${validated.name}.containers.jejunetwork.org`
      updateContainerInstanceStatus(row.id, 'running', endpoint)

      set.status = 201
      return {
        ...transformInstance(row),
        status: 'running' as const,
        endpoint,
        port: 8080,
        startedAt: Date.now(),
      }
    },
    { detail: { tags: ['containers'], summary: 'Start container instance' } },
  )
  .post(
    '/instances/:instanceId/stop',
    async ({ params, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }

      // Verify ownership before stopping
      const instance = getContainerInstance(params.instanceId)
      if (!instance) {
        set.status = 404
        return {
          error: {
            code: 'NOT_FOUND',
            message: `Instance ${params.instanceId} not found`,
          },
        }
      }

      if (instance.owner.toLowerCase() !== authResult.address.toLowerCase()) {
        set.status = 403
        return {
          error: {
            code: 'FORBIDDEN',
            message: 'You do not own this container instance',
          },
        }
      }

      updateContainerInstanceStatus(params.instanceId, 'stopped')

      return { success: true, instanceId: params.instanceId, status: 'stopped' }
    },
    { detail: { tags: ['containers'], summary: 'Stop container instance' } },
  )
  .delete(
    '/instances/:instanceId',
    async ({ params, headers, set }) => {
      const authResult = await requireAuth(headers)
      if (!authResult.success) {
        set.status = 401
        return { error: { code: 'UNAUTHORIZED', message: authResult.error } }
      }

      // Verify ownership before deleting
      const instance = getContainerInstance(params.instanceId)
      if (!instance) {
        set.status = 404
        return {
          error: {
            code: 'NOT_FOUND',
            message: `Instance ${params.instanceId} not found`,
          },
        }
      }

      if (instance.owner.toLowerCase() !== authResult.address.toLowerCase()) {
        set.status = 403
        return {
          error: {
            code: 'FORBIDDEN',
            message: 'You do not own this container instance',
          },
        }
      }

      // Mark as stopped/deleted (we don't hard delete)
      updateContainerInstanceStatus(params.instanceId, 'stopped')

      return { success: true, instanceId: params.instanceId }
    },
    { detail: { tags: ['containers'], summary: 'Delete container instance' } },
  )
