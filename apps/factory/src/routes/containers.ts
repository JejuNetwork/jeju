/**
 * Container Registry Routes
 */

import { Elysia } from 'elysia'
import {
  ContainersQuerySchema,
  CreateContainerBodySchema,
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
        {
          id: '2',
          name: 'jeju/gateway',
          tag: 'v1.2.0',
          digest:
            'sha256:def456abc1237890123456789012345678901234567890123456789012345678',
          size: 89000000,
          platform: 'linux/arm64',
          downloads: 3210,
          createdAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
          updatedAt: Date.now() - 3 * 24 * 60 * 60 * 1000,
        },
      ]

      return { containers, total: containers.length }
    },
    {
      detail: {
        tags: ['containers'],
        summary: 'List containers',
        description: 'Get a list of container images',
      },
    },
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
        id: `container-${Date.now()}`,
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
    {
      detail: {
        tags: ['containers'],
        summary: 'Push container',
        description: 'Push a new container image to the registry',
      },
    },
  )
