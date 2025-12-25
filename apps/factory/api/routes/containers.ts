/** Containers Routes */

import { Elysia } from 'elysia'
import {
  ContainersQuerySchema,
  CreateContainerBodySchema,
  CreateContainerInstanceBodySchema,
  expectValid,
} from '../schemas'
import { requireAuth } from '../validation/access-control'

interface ContainerImage {
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

interface ContainerInstance {
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

export const containersRoutes = new Elysia({ prefix: '/api/containers' })
  .get(
    '/',
    async ({ query }) => {
      expectValid(ContainersQuerySchema, query, 'query params')
      const containers: ContainerImage[] = [
        {
          id: '1',
          name: 'jeju/protocol',
          tag: 'latest',
          digest:
            'sha256:abc123def4567890123456789012345678901234567890123456789012345678',
          size: 156000000,
          platform: 'linux/amd64',
          downloads: 8420,
          createdAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
          updatedAt: Date.now() - 7 * 24 * 60 * 60 * 1000,
        },
      ]
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
      const container: ContainerImage = {
        id: `container-\${Date.now()}`,
        name: validated.name,
        tag: validated.tag,
        digest: validated.digest,
        size: validated.size,
        platform: validated.platform,
        labels: validated.labels,
        downloads: 0,
        createdAt: Date.now(),
        updatedAt: Date.now(),
      }
      set.status = 201
      return container
    },
    { detail: { tags: ['containers'], summary: 'Push container' } },
  )
  .get(
    '/instances',
    async () => {
      const instances: ContainerInstance[] = []
      return { instances, total: 0 }
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
      const instance: ContainerInstance = {
        id: `instance-\${Date.now()}`,
        name: validated.name,
        image: validated.imageId,
        status: 'running',
        cpu: validated.cpu,
        memory: validated.memory,
        gpu: validated.gpu,
        port: 8080,
        endpoint: `https://\${validated.name}.containers.jeju.local`,
        createdAt: Date.now(),
        startedAt: Date.now(),
      }
      set.status = 201
      return instance
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
      return { success: true, instanceId: params.instanceId }
    },
    { detail: { tags: ['containers'], summary: 'Delete container instance' } },
  )
